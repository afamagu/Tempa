import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create role authenticated; create role anon; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function public.is_staff(text) returns boolean language sql stable as $$select current_setting('test.admin',true)='yes'$$;
create function public.room_reading_allowed() returns boolean language sql stable as $$select auth.uid() is not null$$;
create table profiles(id uuid primary key,pseudonym text);
create table questions(id uuid primary key default gen_random_uuid(),prompt text,family text,is_active boolean default false,is_flagship boolean default false,current_position smallint);
create unique index slots on questions(current_position) where current_position is not null;
create unique index flagship on questions(is_flagship) where is_flagship;
create table question_answers(id uuid primary key,question_id uuid references questions(id),user_id uuid,body text);
create table admin_audit_log(actor_id uuid,actor_identifier_snapshot text,action text,target_type text,target_id uuid,target_identifier_snapshot text,metadata jsonb,created_at timestamptz default now());
grant usage on schema auth to authenticated,anon;
insert into profiles values('${id(1)}','Evening Quill');
insert into questions(id,prompt,is_active,is_flagship,current_position) values('${id(10)}','First question',true,true,1),('${id(11)}','Weekly wording',true,false,2),('${id(12)}','Older answered wording',true,false,null);
insert into question_answers values('${id(20)}','${id(11)}','${id(1)}','Original onboarding answer'),('${id(21)}','${id(12)}','${id(1)}','Older answer');
select set_config('test.uid','${id(1)}',false);select set_config('test.admin','yes',false);`)
const base = await readFile(new URL('../docs/sql/2026-10-01-room-engagement-production.sql',import.meta.url),'utf8')
const start = base.indexOf('create or replace function public.admin_make_current_room_question(')
const end = base.indexOf('grant execute on function public.admin_make_current_room_question(uuid) to authenticated;', start)
await db.exec(base.slice(start,end)+'grant execute on function public.admin_make_current_room_question(uuid) to authenticated;')
await db.exec(`create schema tempa_private;
create function public.member_question_author_visible(uuid) returns boolean language sql stable as $$select $1::text<>coalesce(current_setting('test.hidden',true),'')$$;
create function tempa_private.is_correspondence_blocked_pair(uuid,uuid) returns boolean language sql stable as $$select $2::text=coalesce(current_setting('test.blocked',true),'')$$;
create function tempa_private.hidden_from_discovery(uuid,uuid) returns boolean language sql stable as $$select false$$;
alter table question_answers add column moderation_status text default 'visible';
alter table question_answers add column is_current boolean default false;
create function public.send_first_letter(uuid,uuid,text,uuid,boolean) returns boolean language sql security definer as $$
 select $4 is not null and exists(select 1 from public.question_answers qa join public.questions q on q.id=qa.question_id
 where qa.id=$2 and qa.user_id=$1 and qa.is_current = true
 and q.is_active = true) $$;
create function public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb) returns boolean language sql security definer as $$
 select exists(select 1 from public.question_answers qa join public.questions q on q.id=qa.question_id
 where qa.id=$3 and qa.user_id=$2 and qa.is_current = true
 and q.is_active = true) $$;`)
const migration = await readFile(new URL('../docs/sql/2026-10-02-fresh-weekly-question.sql',import.meta.url),'utf8')
await db.exec(migration);await db.exec(migration)
const before = (await db.query('select * from question_answers order by id')).rows
await db.exec('set role authenticated')
const fresh = (await db.query('select admin_start_room_question($1,true) id',[id(11)])).rows[0].id
assert.notEqual(fresh,id(11))
await db.exec('reset role')
assert.deepEqual((await db.query('select * from question_answers order by id')).rows,before)
assert.equal((await db.query('select count(*)::int n from question_answers where question_id=$1',[fresh])).rows[0].n,0)
assert.deepEqual((await db.query('select is_flagship,current_position from questions where id=$1',[id(10)])).rows[0],{is_flagship:true,current_position:1})
assert.equal((await db.query('select room_question_published($1) ok',[id(11)])).rows[0].ok,true)
assert.equal((await db.query('select room_question_published($1) ok',[fresh])).rows[0].ok,true)
await db.exec('set role authenticated')
await assert.rejects(db.query('select admin_start_room_question($1,true)',[id(11)]),/current Question changed/)
await assert.rejects(db.query('select admin_start_room_question($1,true)',[id(10)]),/non-Flagship/)
const reused = (await db.query('select admin_start_room_question($1,false) id',[id(12)])).rows[0].id
assert.notEqual(reused,id(12))
await db.exec("select set_config('test.admin','no',false)")
await assert.rejects(db.query('select admin_start_room_question($1,true)',[reused]),/Not authorized/)
await db.exec('reset role;set role anon')
await assert.rejects(db.query('select admin_start_room_question($1,true)',[reused]),/permission denied/)
await db.exec('reset role')
assert.deepEqual((await db.query('select * from question_answers order by id')).rows,before)
// Test the exact guarded transformation in both functions. These two fixture
// functions deliberately model only their answer guards, not Safety/letter writes.
await db.exec(`select set_config('test.uid','${id(2)}',false);set role authenticated`)
assert.equal((await db.query('select room_answer_can_start_letter($1,$2) ok',[id(20),id(1)])).rows[0].ok,true)
assert.equal((await db.query('select can_evaluate_safety_context($1,$2,$3,null,null) ok',['first_letter',id(1),id(20)])).rows[0].ok,true)
assert.equal((await db.query('select send_first_letter($1,$2,$3,$4,false) ok',[id(1),id(20),'reply',id(50)])).rows[0].ok,true)
assert.equal((await db.query('select send_first_letter($1,$2,$3,null,false) ok',[id(1),id(20),'reply'])).rows[0].ok,false)
await db.exec(`select set_config('test.blocked','${id(1)}',false)`)
assert.equal((await db.query('select room_answer_can_start_letter($1,$2) ok',[id(20),id(1)])).rows[0].ok,false)
await db.exec("select set_config('test.blocked','',false);reset role")
await db.query("update question_answers set moderation_status='hidden' where id=$1",[id(20)])
assert.equal((await db.query('select room_answer_can_start_letter($1,$2) ok',[id(20),id(1)])).rows[0].ok,false)
assert.equal((await db.query('select room_answer_can_start_letter($1,$2) ok',[id(21),id(1)])).rows[0].ok,false) // unpublished source
await db.close()
console.log('PASS: fresh question identity, empty new editor data, unchanged old answers and Flagship, archived publication, stale retry and role checks, repeatable migration.')
