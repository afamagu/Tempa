import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
await db.exec("set timezone='UTC'")
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
create schema auth;create schema private;create schema tempa_private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
create table auth.users(id uuid primary key);
create table profiles(id uuid primary key,pseudonym text,mark_id uuid,country text default 'Nigeria',gender text default 'Woman',gender_custom text,age_range text default '25–34');
create view public_profiles as select * from profiles where id<>coalesce(nullif(current_setting('test.blocked',true),'')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff');
create table account_enforcement_state(user_id uuid,status text);
create table account_deactivations(user_id uuid,reactivated_at timestamptz);
create function tempa_private.account_is_banned(uuid) returns boolean language sql stable as $$select exists(select 1 from public.account_enforcement_state where user_id=$1 and status='banned')$$;
create function public.is_staff(text) returns boolean language sql stable as $$select current_setting('test.admin',true)='yes'$$;
create table questions(id uuid primary key default gen_random_uuid(),prompt text,family text,is_active boolean default false,is_flagship boolean default false,current_position smallint);
create unique index question_slots on questions(current_position) where current_position is not null;
create table admin_audit_log(actor_id uuid,actor_identifier_snapshot text,action text,target_type text,target_id uuid,target_identifier_snapshot text,metadata jsonb,created_at timestamptz default now());
create table correspondences(id uuid primary key,participant_low uuid,participant_high uuid);
create table letters(id uuid primary key default gen_random_uuid(),correspondence_id uuid,sender_id uuid,recipient_id uuid,body text);
create view letters_for_participant as select * from letters where sender_id=auth.uid() or (recipient_id=auth.uid() and current_setting('test.delivered',true)='yes');
create table letter_submissions(sender_id uuid,client_submission_id uuid,letter_id uuid,primary key(sender_id,client_submission_id));
create function public.current_account_status() returns text language sql as $$select coalesce(nullif(current_setting('test.status',true),''),'active')::text$$;
grant usage on schema auth to authenticated,anon,service_role;
grant select on public_profiles,letters_for_participant to authenticated;
create function public.send_first_letter(uuid,uuid,text,uuid,boolean) returns letters_for_participant language plpgsql security definer set search_path=public,pg_catalog as $$declare r letters_for_participant;begin
 if $4 is null then raise exception 'Safety evaluation required';end if;
 insert into letters(correspondence_id,sender_id,recipient_id,body) values('${id(100)}',auth.uid(),$1,$3) returning * into r;return r;end;$$;
create function public.write_letter_once(uuid,uuid,text,uuid,uuid,jsonb,jsonb,boolean) returns letters_for_participant language plpgsql security definer set search_path=public,pg_catalog as $$declare r letters_for_participant;begin
 if $4 is null then raise exception 'Safety evaluation required';end if;
 insert into letters(correspondence_id,sender_id,recipient_id,body) select $2,auth.uid(),case when participant_low=auth.uid() then participant_high else participant_low end,$3 from correspondences where id=$2 returning * into r;
 insert into letter_submissions values(auth.uid(),$1,r.id);return r;end;$$;`)
// Reuse actual deployed admin functions; base letter senders above are delegation
// stubs. These tests exercise the new wrappers' validation/atomicity, not Safety's classifier.
const old = await readFile(new URL('../docs/sql/2026-09-30-room-question-suggestions.sql',import.meta.url),'utf8')
await db.exec(old.slice(0, old.indexOf('create or replace function public.admin_update_room_question_suggestion')) + '\ncommit;')
await db.exec(await readFile(new URL('./fixtures/member-question-admin-functions.sql',import.meta.url),'utf8'))
for (let n=1;n<=4;n++) { await db.query('insert into auth.users values($1)',[id(n)]);await db.query('insert into profiles(id,pseudonym,mark_id) values($1,$2,null)',[id(n),`Member ${n}`]) }
await db.query('insert into correspondences values($1,$2,$3)',[id(100),id(1),id(2)])
await db.query("insert into questions(id,prompt,is_active,is_flagship,current_position) values($1,'Flagship',true,true,1)",[id(90)])
const sql=await readFile(new URL('../docs/sql/2026-10-01-member-question-profiles.sql',import.meta.url),'utf8')
await db.exec(sql);await db.exec(sql)
await db.exec('create table private.room_invitation_email_config(singleton boolean,sending_enabled boolean);insert into private.room_invitation_email_config values(true,false);')
const verified=await db.query(await readFile(new URL('../docs/sql/2026-10-01-member-question-profiles-verify.sql',import.meta.url),'utf8'));assert.equal(verified.rows[0].result,'MEMBER_QUESTIONS_READY')
async function user(n,role='authenticated',admin=false) { await db.exec(`reset role; select set_config('test.uid','${id(n)}',false);select set_config('test.role','${role}',false);select set_config('test.admin','${admin?'yes':'no'}',false);set role ${role};`) }
const allow={mutationDisposition:'allow',escalateCase:false}
async function publish(n,body,classification=allow,ack=false,legacy=null) { await user(n,'service_role');return (await db.query('select publish_member_question_trusted($1,$2,true,$3,$4,$5) id',[id(n),body,classification,ack,legacy])).rows[0].id }

await db.exec(`
create table question_answers(id uuid primary key,question_id uuid references questions(id),user_id uuid,body text,created_at timestamptz,moderation_status text default 'visible');
alter table question_answers enable row level security;
grant select on question_answers,questions to authenticated;
create function tempa_private.is_blocked_pair(uuid,uuid) returns boolean language sql stable as $$select $2::text=coalesce(current_setting('test.blocked',true),'')$$;
create function tempa_private.hidden_from_discovery(uuid,uuid) returns boolean language sql stable as $$select $2::text=coalesce(current_setting('test.hidden',true),'')$$;
grant usage on schema tempa_private to authenticated;
`)
const migration=await readFile(new URL('../docs/sql/2026-10-02-profile-questions-room-reading.sql',import.meta.url),'utf8')
await db.exec(migration);await db.exec(migration)
// Actual trusted publication and owner RPCs exercise the new trigger.
const questions=[]
for(let n=0;n<4;n++) { await db.exec("reset role;update room_question_suggestions set created_at=now()-interval '2 days'"); questions.push(await publish(2,`What memory would you like to share number ${n}?`)) }
await user(1)
assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,3)
await db.exec('reset role')
assert.equal((await db.query('select * from member_questions where author_id=$1',[id(2)])).rows.length,4)
await user(2)
await db.query("select manage_member_question($1,'visibility',true)",[questions[0]])
await user(1)
const displayed=(await db.query('select * from profile_member_questions($1)',[id(2)])).rows
assert.equal(displayed.length,3);assert.ok(displayed.some(q=>q.id===questions[0]))
const pending=await publish(2,'What would you tell a younger version of yourself?',{...allow,escalateCase:true})
await user(1);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,3)
await db.exec('reset role');await db.query("update member_questions set moderation_status='visible' where id=$1",[pending])
await user(1);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,3)
// Three chronological answers plus a lookahead; archives require publication proof.
await db.exec('reset role')
await db.query("insert into questions(id,prompt,is_active,current_position) values($1,'The current weekly question',true,2),($2,'A former weekly question',false,null),($3,'An unpublished draft',false,null)",[id(91),id(92),id(93)])
await db.query("insert into admin_audit_log(action,target_type,target_id,created_at) values('room_question_made_current','question',$1,'2026-09-01'),('room_question_made_current','question',$1,'2026-09-08')",[id(92)])
for(let n=0;n<8;n++) await db.query('insert into question_answers(id,question_id,user_id,body,created_at) values($1,$2,$3,$4,$5)',[id(300+n),id(91),id(n%3+1),`Answer ${n}`,`2026-10-01T00:00:0${n}Z`])
await db.query("insert into question_answers values($1,$2,$3,'Archive answer','2026-09-02','visible'),($4,$5,$3,'Draft answer','2026-09-02','visible')",[id(400),id(92),id(2),id(401),id(93)])
await user(1)
const first=(await db.query('select * from room_read_question_answers($1)',[id(91)])).rows
assert.deepEqual(first.map(r=>r.answer_id),[300,301,302,303].map(id))
const next=(await db.query('select * from room_read_question_answers($1,$2,$3,3)',[id(91),first[2].created_at,first[2].answer_id])).rows
assert.deepEqual(next.map(r=>r.answer_id),[303,304,305,306].map(id))
assert.equal((await db.query('select * from room_read_question_answers($1)',[id(92)])).rows.length,1)
assert.equal((await db.query('select * from room_read_question_answers($1)',[id(93)])).rows.length,0)
const library=(await db.query('select * from room_question_library()')).rows
assert.ok(!library.some(q=>q.id===id(93)))
assert.equal(new Date(library.find(q=>q.id===id(92)).published_at).toISOString(),'2026-09-01T00:00:00.000Z')
assert.equal((await db.query("select * from room_question_library('former')")).rows.length,1)
assert.equal((await db.query("select * from room_question_library('',0,6,'2026-09-01','2026-09-01')")).rows.length,1)
assert.equal((await db.query("select * from room_question_library('',0,6,'2026-09-02','2026-09-30')")).rows.length,0)
assert.equal((await db.query("select * from room_read_question_answers($1,null,null,3,'France')",[id(91)])).rows.length,0)
await db.exec(`select set_config('test.blocked','${id(2)}',false)`)
assert.equal((await db.query('select * from room_read_question_answers($1)',[id(92)])).rows.length,0)
await db.exec("select set_config('test.blocked','',false);select set_config('test.hidden','"+id(2)+"',false)")
assert.equal((await db.query('select * from room_read_question_answers($1)',[id(92)])).rows.length,0)
await db.exec("select set_config('test.hidden','',false);select set_config('test.status','banned',false)")
assert.equal((await db.query('select * from room_question_library()')).rows.length,0)
await db.exec("select set_config('test.status','active',false)")
await db.exec('reset role');await db.query('insert into account_deactivations values($1,null)',[id(2)]);await user(1)
assert.equal((await db.query('select * from room_read_question_answers($1)',[id(92)])).rows.length,0)
await db.exec('reset role;set role anon')
for(const call of ['room_reading_allowed()','room_question_published(\''+id(91)+'\')','room_read_question_answers(\''+id(91)+'\')','room_question_library()']) await assert.rejects(db.query('select * from '+call))
await db.exec('reset role')
const releaseVerified=await db.query(await readFile(new URL('../docs/sql/2026-10-02-profile-questions-room-reading-verify.sql',import.meta.url),'utf8'))
assert.equal(releaseVerified.rows[0].result,'PROFILE_QUESTIONS_ROOM_READY')
await db.close()
console.log('Profile/Room SQL passed: repeatable migration, three visible with preserved history, owner replacement, pending moderation, exact-question chronological cursor, archive publication proof/date, search/filter, blocked/hidden/deactivated authors, banned viewer and anonymous denial.')
