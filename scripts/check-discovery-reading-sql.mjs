import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create role authenticated; create role anon; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create table public.question_answers(id uuid primary key,user_id uuid,moderation_status text);
create table public.correspondences(id uuid primary key,participant_low uuid,participant_high uuid,status text,established_at timestamptz);
create table public.correspondence_hidden_for_user(user_id uuid,correspondence_id uuid);
create table public.public_profiles(id uuid,pseudonym text,mark_id uuid);
create table public.letters_for_participant(id uuid,correspondence_id uuid,created_at timestamptz);
create function public.can_pick_correspondent(uuid) returns boolean language sql as $$select auth.uid() is not null$$;
grant usage on schema auth to authenticated,anon;
grant select on public.question_answers,public.correspondences,public.correspondence_hidden_for_user,public.public_profiles,public.letters_for_participant to authenticated;`)
for(let n=1;n<=32;n++) await db.query('insert into auth.users values($1)',[id(n)])
await db.query('insert into question_answers values($1,$2,$3)',[id(101),id(2),'visible'])
await db.query('insert into question_answers values($1,$2,$3)',[id(102),id(2),'hidden'])
for(let n=2;n<=32;n++) {
 await db.query('insert into public_profiles values($1,$2,null)',[id(n),`Person ${n}`]);
 await db.query("insert into correspondences values($1,$2,$3,'active',now())",[id(200+n),id(1),id(n)]);
 await db.query('insert into letters_for_participant values($1,$2,now())',[id(300+n),id(200+n)]);
}
for(let i=0;i<2;i++) for(const file of ['2026-10-01-public-correspondent-picker.sql','2026-10-01-home-answer-reading.sql']) await db.exec(await readFile(new URL('../docs/sql/'+file,import.meta.url),'utf8'))
const verification = await db.query(await readFile(new URL('../docs/sql/2026-10-01-discovery-reading-verify.sql',import.meta.url),'utf8'))
assert.equal(verification.rows[0].result,'DISCOVERY_READING_READY')
await db.exec(`select set_config('test.uid','${id(1)}',false);set role authenticated;`)
const first=(await db.query("select * from correspondent_picker_page('',21,0)")).rows
const next=(await db.query("select * from correspondent_picker_page('',21,20)")).rows
assert.equal(first.length,21);assert.equal(next.length,11)
assert.equal(new Set([...first.slice(0,20),...next].map(r=>r.user_id)).size,31)
await db.query('select mark_member_answer_read($1)',[id(101)]);await db.query('select mark_member_answer_read($1)',[id(101)])
await db.query('select mark_member_answer_read($1)',[id(102)])
assert.equal((await db.query('select * from member_answer_reads')).rows.length,1)
await db.exec(`reset role;select set_config('test.uid','${id(2)}',false);set role authenticated;`)
assert.equal((await db.query('select * from member_answer_reads')).rows.length,0)
await assert.rejects(db.query('insert into member_answer_reads values($1,$2,now())',[id(1),id(102)]))
await db.exec('reset role;set role anon;')
await assert.rejects(db.query("select * from correspondent_picker_page('',21,0)"))
await assert.rejects(db.query('select mark_member_answer_read($1)',[id(101)]))
await db.close();console.log('SQL checks passed: repeatable installation, paginated picker, idempotent visible-answer reads, own-history RLS and anonymous denial.')
