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
await db.query("select set_config('test.uid',$1,false)",[sender]);await db.exec('set role authenticated')
const selected=[{userId:recipient,pseudonym:'Mia'}]
const publish=async(body,mentions=selected,operation='publish_dispatch',extra={})=>(await db.query('select public.publish_with_mentions($1,$2,$3) as result',[operation,{p_body:body,...extra},mentions])).rows[0].result
const first=await publish('Hello @Mia.',selected,'publish_dispatch',{p_topics:['one','two'],p_postcard:null,p_warning_acknowledged:false})
assert.ok(first.id)
await db.query('select public.sync_public_mentions($1,$2,$3)',['dispatch',first.id,selected])
await assert.rejects(publish('Hello @Mia.',[{userId:recipient,pseudonym:'Not Mia'}]))
await assert.rejects(publish('Hello @Sender.',[{userId:sender,pseudonym:'Sender'}]))
await assert.rejects(publish('unsafe'))
await assert.rejects(publish('Hello @Mia.',selected,'publish_official_dispatch'))
await assert.rejects(publish('Hello',[],'write_letter'))
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int as n from public.dispatches')).rows[0].n,1,'failed mentions must roll back writing')
assert.equal((await db.query('select count(*)::int as n from public.public_mentions')).rows[0].n,1,'idempotent mention')
await db.query("select set_config('test.uid',$1,false)",[recipient]);await db.exec('set role authenticated')
let rows=(await db.query('select * from public.get_public_mentions()')).rows
assert.equal(rows.length,1);assert.equal(rows[0].read_at,null)
const event=rows[0].id
assert.equal((await db.query('select public.open_public_mention($1) as href',[event])).rows[0].href,`/board/${first.id}`)
assert.ok((await db.query('select * from public.get_public_mentions()')).rows[0].read_at)
await assert.rejects(db.query('insert into public.public_mentions(kind,source_id,sender_id,recipient_id,selected_name) values($1,$2,$3,$4,$5)',['dispatch',first.id,sender,recipient,'Mia']))
await assert.rejects(db.query('select * from public.public_mentions'))
await db.exec('reset role');await db.query("update public.dispatches set body='Mention removed' where id=$1",[first.id]);await db.exec('set role authenticated')
assert.equal((await db.query('select * from public.get_public_mentions()')).rows.length,0)
assert.equal((await db.query('select public.open_public_mention($1) as href',[event])).rows[0].href,null)
await db.exec('reset role');await db.query("update public.dispatches set body='Hello @Mia.' where id=$1",[first.id]);await db.query('insert into public.test_blocks values($1,$2)',[sender,recipient]);await db.exec('set role authenticated')
assert.equal((await db.query('select * from public.get_public_mentions()')).rows.length,0)
await db.exec('reset role');await db.exec('delete from public.test_blocks')
await db.query("select set_config('test.uid',$1,false)",[stranger]);await db.exec('set role authenticated')
assert.equal((await db.query('select * from public.get_public_mentions()')).rows.length,0)
assert.equal((await db.query('select public.open_public_mention($1) as href',[event])).rows[0].href,null)
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(db.query('select * from public.get_public_mentions()'));await db.exec('reset role')
await db.query("select set_config('test.uid',$1,false)",[sender]);await db.exec('set role authenticated')
await publish('Hello @Miami.',selected)
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int as n from public.public_mentions')).rows[0].n,1,'name prefixes must not notify')
// Replies and answers land on their precise reading destinations.
const question='00000000-0000-4000-8000-000000000010'
await db.query('insert into public.questions values($1,false,true,2)',[question])
await db.exec('set role authenticated')
const reply=await publish('Reply @Mia.',selected,'create_reply',{p_dispatch_id:first.id})
const answer=await publish('Answer @Mia.',selected,'publish_question_answer',{p_question_id:question})
await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[recipient]);await db.exec('set role authenticated')
const received=(await db.query('select * from public.get_public_mentions()')).rows
for (const kind of ['reply','answer']) {
 const mention=received.find(row=>row.kind===kind)
 assert.ok(mention)
 const href=(await db.query('select public.open_public_mention($1) as href',[mention.id])).rows[0].href
 assert.equal(href,kind==='reply'?`/board/${first.id}#reply-${reply.id}`:`/room/${sender}?answer=${answer.id}&returnTo=%2Fhome`)
}
await db.exec('reset role');await db.query('update public.dispatch_replies set deleted_at=now() where id=$1',[reply.id]);await db.exec('set role authenticated')
assert.equal((await db.query('select * from public.get_public_mentions()')).rows.some(row=>row.kind==='reply'),false)
await db.exec('reset role')
await db.query("select set_config('test.uid',$1,false)",[sender]);await db.exec('set role authenticated')
assert.deepEqual((await db.query("select pseudonym from public.mention_picker_page('')")).rows.map(r=>r.pseudonym),['Mia'])
assert.deepEqual((await db.query("select pseudonym from public.mention_picker_page('Mi')")).rows.map(r=>r.pseudonym),['Mia','Mina'])
assert.equal((await db.query("select * from public.mention_picker_page('ina')")).rows.length,0,'prefix only')
const globalPost=await publish('Hello @Mina.',[{userId:stranger,pseudonym:'Mina'}])
await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[stranger]);await db.exec('set role authenticated')
assert.equal((await db.query('select * from public.get_public_mentions()')).rows.length,1,'non-correspondents receive mentions')
await db.exec('reset role');await db.query("update public.dispatches set published_as='tempa' where id=$1",[globalPost.id]);await db.exec('set role authenticated')
assert.equal((await db.query('select * from public.get_public_mentions()')).rows[0].pseudonym,'Tempa','official posts do not expose admin pseudonym')
await db.exec('reset role')
await db.query("select set_config('test.uid',$1,false)",[sender]);await db.exec('set role authenticated')
for(let i=1;i<10;i++) await publish('Hello @Mina.',[{userId:stranger,pseudonym:'Mina'}])
await assert.rejects(publish('Hello @Mina.',[{userId:stranger,pseudonym:'Mina'}]),/limit reached/)
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int as n from public.public_mentions where recipient_id=$1',[stranger])).rows[0].n,10)
const verified=(await db.query(await readFile(new URL('../docs/sql/2026-10-03-public-mentions-verify.sql',import.meta.url),'utf8'))).rows[0]
assert.equal(verified.result,'PUBLIC_MENTIONS_READY')
console.log('PASS: atomic rollback, existing Safety/admin gates, JSON/array args, identity checks, dedupe, removal, blocks, own-only notification reads and anonymous/direct-write denial.')
await db.close()
