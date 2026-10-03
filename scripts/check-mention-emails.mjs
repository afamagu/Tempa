import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
const sender='00000000-0000-4000-8000-000000000001', recipient='00000000-0000-4000-8000-000000000002', stranger='00000000-0000-4000-8000-000000000003'
await db.exec(`
 create role anon;create role authenticated;create schema auth;create schema tempa_private;
 create table auth.users(id uuid primary key);insert into auth.users values('${sender}'),('${recipient}'),('${stranger}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 create table public.profiles(id uuid primary key,pseudonym text,mark_id uuid);
 insert into public.profiles values('${sender}','Sender',null),('${recipient}','Mia',null),('${stranger}','Mina',null);
 create view public.public_profiles as select * from public.profiles;
 grant select on public.public_profiles to authenticated;
 create function public.current_account_status() returns text language sql as $$select 'active'::text$$;
 create table public.correspondences(id uuid,participant_low uuid,participant_high uuid,status text,established_at timestamptz);
 create table public.correspondence_hidden_for_user(user_id uuid,correspondence_id uuid);
 create table public.letters_for_participant(id uuid,correspondence_id uuid,created_at timestamptz);
 grant select on public.correspondences,public.correspondence_hidden_for_user,public.letters_for_participant to authenticated;
 insert into public.correspondences values('${sender}','${sender}','${recipient}','active',now());
 insert into public.letters_for_participant values('${recipient}','${sender}',now());
 create table public.dispatches(id uuid primary key default gen_random_uuid(),author_id uuid,body text,status text default 'published',moderation_status text default 'visible',published_as text default 'member',sponsor_name text);
 create table public.dispatch_replies(id uuid primary key default gen_random_uuid(),dispatch_id uuid,author_id uuid,body text,deleted_at timestamptz,moderation_status text default 'visible');
 create table public.questions(id uuid primary key,is_flagship boolean,is_active boolean,current_position integer);
 create table public.question_answers(id uuid primary key default gen_random_uuid(),question_id uuid,user_id uuid,body text,moderation_status text default 'visible');
 create table public.admin_audit_log(target_type text,target_id uuid,action text);
 create table public.test_blocks(a uuid,b uuid);
 create function tempa_private.author_content_publicly_visible(uuid) returns boolean language sql as $$select true$$;
 create function tempa_private.is_blocked_pair(uuid,uuid) returns boolean language sql as $$select exists(select 1 from public.test_blocks where a=$1 and b=$2 or a=$2 and b=$1)$$;
 create function tempa_private.is_correspondence_blocked_pair(uuid,uuid) returns boolean language sql as $$select tempa_private.is_blocked_pair($1,$2)$$;
 create function tempa_private.hidden_from_discovery(uuid,uuid) returns boolean language sql as $$select false$$;
 create function public.can_pick_correspondent(uuid) returns boolean language sql security definer as $$select $1='${recipient}' and not tempa_private.is_blocked_pair(auth.uid(),$1)$$;
 create function public.publish_dispatch(p_body text,p_topics text[] default '{}',p_postcard jsonb default null,p_warning_acknowledged boolean default false)
 returns public.dispatches language plpgsql security definer as $$declare r public.dispatches;begin
 if p_postcard='null'::jsonb then raise exception 'JSON null was not SQL null'; end if;
 if p_body='unsafe' then raise exception 'Existing Safety rejection'; end if;
 insert into public.dispatches(author_id,body) values(auth.uid(),p_body) returning * into r; return r; end$$;
 create function public.publish_official_dispatch(p_body text) returns public.dispatches language plpgsql security definer as $$begin raise exception 'Admin required'; end$$;
 create function public.create_reply(p_dispatch_id uuid,p_body text) returns public.dispatch_replies language plpgsql security definer as $$declare r public.dispatch_replies;begin insert into public.dispatch_replies(dispatch_id,author_id,body) values(p_dispatch_id,auth.uid(),p_body) returning * into r;return r;end$$;
 create function public.publish_question_answer(p_question_id uuid,p_body text) returns public.question_answers language plpgsql security definer as $$declare r public.question_answers;begin insert into public.question_answers(question_id,user_id,body) values(p_question_id,auth.uid(),p_body) returning * into r;return r;end$$;
`)
for (const name of ['update_dispatch','update_official_dispatch','publish_dispatch_with_web_visibility','update_dispatch_with_web_visibility','publish_official_dispatch_with_web_visibility','update_official_dispatch_with_web_visibility']) {
 await db.exec(`create function public.${name}(p_body text) returns public.dispatches language sql as $$select public.publish_dispatch(p_body)$$`)
}
await db.exec(await readFile(new URL('../docs/sql/2026-10-03-public-mentions.sql',import.meta.url),'utf8'))
await db.exec(`
 create role service_role;create schema private;
 create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
 grant usage on schema auth to service_role;
 alter table auth.users add column email text,add column email_confirmed_at timestamptz;
 update auth.users set email=id::text||'@example.test',email_confirmed_at=now();
 create table public.account_enforcement_state(user_id uuid,status text);
 create table public.account_deactivations(user_id uuid,reactivated_at timestamptz);
 alter table public.admin_audit_log add column actor_id uuid,add column actor_identifier_snapshot text,add column target_identifier_snapshot text,add column metadata jsonb;
 create function public.is_staff(text) returns boolean language sql as $$select auth.uid()='${sender}'::uuid$$;
`)
await db.exec(await readFile(new URL('../docs/sql/2026-10-03-mention-emails.sql',import.meta.url),'utf8'))
assert.equal((await db.query(await readFile(new URL('../docs/sql/2026-10-03-mention-emails-verify.sql',import.meta.url),'utf8'))).rows[0].result,'MENTION_EMAILS_READY')
async function role(name,uid=sender) {
 await db.exec('reset role');await db.query("select set_config('test.role',$1,false),set_config('test.uid',$2,false)",[name,uid]);await db.exec(`set role ${name}`)
}
async function makeMention(to=recipient) {
 await db.exec('reset role')
 const name=(await db.query('select pseudonym from public.profiles where id=$1',[to])).rows[0].pseudonym
 const writing=(await db.query("insert into public.dispatches(author_id,body) values($1,$2) returning id",[sender,'Hello @'+name+'.'])).rows[0].id
 return (await db.query("insert into public.public_mentions(kind,source_id,sender_id,recipient_id,selected_name) values('dispatch',$1,$2,$3,$4) returning id",[writing,sender,to,name])).rows[0].id
}
const disabledMention=await makeMention()
assert.equal((await db.query('select count(*)::int n from private.mention_email_jobs')).rows[0].n,0,'disabled means no backlog')
await role('authenticated',stranger)
await assert.rejects(db.query('select public.set_mention_email_sending_enabled(true)'))
await assert.rejects(db.query('select public.admin_get_mention_email_status()'))
await assert.rejects(db.query('select * from public.claim_mention_emails()'))
await assert.rejects(db.query('select * from private.mention_email_jobs'))
await role('anon','')
await assert.rejects(db.query("select public.set_mention_email_preference('off')"))
await role('authenticated',sender)
await db.query('select public.set_mention_email_sending_enabled(true)')
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int n from private.mention_email_jobs')).rows[0].n,0,'activation never backfills old mentions')
const mention=await makeMention()
assert.equal((await db.query('select count(*)::int n from private.mention_email_jobs')).rows[0].n,1,'new eligible mention queued')
await role('service_role')
assert.equal((await db.query('select * from public.claim_mention_emails()')).rows.length,0,'two minute grace')
async function due() {await db.exec('reset role');await db.exec("update private.mention_email_jobs set next_attempt_at=now()-interval '1 second' where status='pending'");await role('service_role')}
await due()
let claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
assert.equal(claim.mention_id,mention)
assert.equal((await db.query('select * from public.claim_mention_emails()')).rows.length,0,'leased jobs not reclaimed immediately')
const prepare=async(c)=>(await db.query('select public.prepare_mention_email($1,$2,$3,$4) result',[c.mention_id,c.claim_token,'https://jointempa.com','Tempa <hello@example.test>'])).rows[0].result
const freeze=async(c,p)=>(await db.query('select public.freeze_mention_email($1,$2,$3) result',[c.mention_id,c.claim_token,p])).rows[0].result
let snapshot=await prepare(claim)
assert.equal(snapshot.pseudonym,'Sender');assert.equal(snapshot.mentionId,mention)
assert.equal(snapshot.body,undefined,'no writing excerpt in email snapshot')
const request={from:snapshot.from,to:snapshot.to,idempotencyKey:snapshot.idempotencyKey,subject:'Mention',html:'<p>Read in Tempa</p>',text:'Read in Tempa'}
await assert.rejects(freeze(claim,{...request,to:'wrong@example.test'}))
assert.deepEqual(await freeze(claim,request),request)
assert.deepEqual(await freeze(claim,{...request,html:'changed rendering'}),request,'payload immutable across retry/deploy')
assert.equal((await db.query('select public.complete_mention_email($1,$2,false,true,null) ok',[mention,stranger])).rows[0].ok,false,'stale claim cannot complete')
await db.query('select public.complete_mention_email($1,$2,false,true,null)',[mention,claim.claim_token])
await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
assert.deepEqual((await prepare(claim)).providerRequest,request)
await db.query("select public.complete_mention_email($1,$2,true,false,'provider-accepted')",[mention,claim.claim_token])
await db.exec('reset role')
let job=(await db.query('select * from private.mention_email_jobs where mention_id=$1',[mention])).rows[0]
assert.equal(job.status,'sent');assert.equal(job.provider_message_id,'provider-accepted');assert.equal(job.snapshot,null,'successful jobs discard email payload')
const burst=await makeMention();await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
snapshot=await prepare(claim)
assert.equal(await freeze(claim,{...request,to:snapshot.to,idempotencyKey:snapshot.idempotencyKey}),null,'burst suppressed before provider call')
await db.exec('reset role')
assert.equal((await db.query('select status from private.mention_email_jobs where mention_id=$1',[burst])).rows[0].status,'skipped')
// Preference is self-scoped and applied both at enqueue and just before send.
await role('authenticated',stranger);await db.query("select public.set_mention_email_preference('correspondents')")
assert.deepEqual((await db.query('select user_id from public.mention_email_preferences')).rows.map(r=>r.user_id),[stranger])
const filtered=await makeMention(stranger)
assert.equal((await db.query('select count(*)::int n from private.mention_email_jobs where mention_id=$1',[filtered])).rows[0].n,0)
await role('authenticated',stranger);await db.query("select public.set_mention_email_preference('everyone')")
const optedOut=await makeMention(stranger);await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
await prepare(claim)
await role('authenticated',stranger);await db.query("select public.set_mention_email_preference('off')")
await role('service_role');assert.equal(await freeze(claim,request),null,'opt-out between prepare and send suppresses email')
await role('authenticated',stranger);await db.query("select public.set_mention_email_preference('everyone')")
const read=await makeMention(stranger);await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
await db.exec('reset role');await db.query('update public.public_mentions set read_at=now() where id=$1',[read]);await role('service_role')
assert.equal(await prepare(claim),null,'read during grace/lease suppresses email')
const blocked=await makeMention(stranger);await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
await db.exec('reset role');await db.query('insert into public.test_blocks values($1,$2)',[sender,stranger]);await role('service_role')
assert.equal(await prepare(claim),null,'new block suppresses queued email')
await db.exec('reset role');await db.exec('delete from public.test_blocks')
const removed=await makeMention(stranger);await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
await db.exec('reset role');await db.query("update public.dispatches set body='No mention now' where id=(select source_id from public.public_mentions where id=$1)",[removed]);await role('service_role')
assert.equal(await prepare(claim),null,'removed token suppresses email')
const deactivated=await makeMention(stranger);await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
await db.exec('reset role');await db.query('insert into public.account_deactivations values($1,null)',[stranger]);await role('service_role')
assert.equal(await prepare(claim),null,'deactivated recipient suppresses email')
await db.exec('reset role');await db.exec('delete from public.account_deactivations')
const expired=await makeMention(stranger);await due();claim=(await db.query('select * from public.claim_mention_emails()')).rows[0]
snapshot=await prepare(claim);await freeze(claim,{...request,to:snapshot.to,idempotencyKey:snapshot.idempotencyKey})
await db.exec('reset role');await db.query("update private.mention_email_jobs set claimed_at=now()-interval '16 minutes',first_provider_at=now()-interval '24 hours' where mention_id=$1",[expired]);await role('service_role')
assert.equal((await db.query('select * from public.claim_mention_emails()')).rows.length,0)
await db.exec('reset role');assert.equal((await db.query('select status from private.mention_email_jobs where mention_id=$1',[expired])).rows[0].status,'manual_review')
await role('authenticated',sender)
const admin=(await db.query('select public.admin_get_mention_email_status() result')).rows[0].result
assert.equal(admin.counts.sent,1);assert.ok(admin.recent.every(row=>!('email' in row)))
console.log('PASS: disabled/no-backfill, grace period, service/admin boundaries, RLS preferences, claim fencing, frozen retries, read/block/opt-out revalidation, burst suppression, provider ID and expiry.')
await db.close()
