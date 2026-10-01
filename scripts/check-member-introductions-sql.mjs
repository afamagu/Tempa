// Runs isolated PostgreSQL/WASM fixtures, never a production connection.
// Install @electric-sql/pglite in a temporary folder; point
// TEMPA_SQL_TEST_MODULE to its dist/index.js (or install it locally).
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const sql = (name) => readFile(new URL(`../docs/sql/${name}`, import.meta.url), 'utf8')
const one = async (query) => (await db.query(query)).rows[0]
async function asUser(n, role = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid','${n ? id(n) : ''}',false); select set_config('test.role','${role}',false); set role ${role};`)
}
async function denied(query) { await assert.rejects(db.query(query)) }
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema tempa_private;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now());
  create table public.profiles(id uuid primary key,pseudonym text,country text,gender text,gender_custom text,age_range text,mark_id uuid,languages text[],intent text[]);
  create table public.questions(id uuid primary key,prompt text,is_flagship boolean,is_active boolean,current_position integer);
  create table public.question_answers(id uuid primary key,user_id uuid,question_id uuid,body text,moderation_status text default 'visible',is_current boolean default true,updated_at timestamptz default now());
  create table public.correspondences(id uuid primary key,participant_low uuid,participant_high uuid,status text default 'active',established_at timestamptz default now());
  create table public.letters(id uuid primary key,correspondence_id uuid,sender_id uuid,recipient_id uuid,reply_to_id uuid,question_answer_id uuid,created_at timestamptz default now(),deliver_at timestamptz default now());
  create table public.correspondence_hidden_for_user(user_id uuid,correspondence_id uuid);
  create table public.account_enforcement_state(user_id uuid,status text);
  create table public.account_deactivations(user_id uuid,reactivated_at timestamptz);
  create table public.account_closures(user_id uuid);
  create table public.blocked_users(blocker_id uuid,blocked_id uuid);
  create function tempa_private.is_correspondence_blocked_pair(a uuid,b uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.blocked_users where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a)) $$;
  create function tempa_private.account_is_banned(a uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.account_closures where user_id=a) or exists(select 1 from public.account_enforcement_state where user_id=a and status='banned') $$;
  create function public.current_account_status() returns text language sql stable security definer as $$ select coalesce((select status from public.account_enforcement_state where user_id=auth.uid()),'active') $$;
  create view public.public_profiles with(security_barrier=true) as select p.* from public.profiles p where not tempa_private.account_is_banned(p.id) and not tempa_private.is_correspondence_blocked_pair(auth.uid(),p.id);
  create view public.letters_for_participant with(security_barrier=true) as select l.* from public.letters l where l.sender_id=auth.uid() or (l.recipient_id=auth.uid() and l.deliver_at <= now());
  grant usage on schema auth to authenticated,service_role,anon;
  grant execute on function auth.uid(),auth.role() to authenticated,service_role,anon;
  grant select on public.public_profiles,public.letters_for_participant,public.questions,public.question_answers,public.correspondences,public.correspondence_hidden_for_user to authenticated;
`)
for (let n = 1; n <= 7; n++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id(n), `${n}@example.test`])
  await db.query('insert into profiles values($1,$2,$3,$4,null,$5,null,$6,$7)', [id(n), ['Sender','Strong','Weak','Stranger','Blocked','Travelling','Closed'][n-1], n % 2 ? 'Nigeria' : 'France', 'Woman', '25-34', n % 2 ? ['English'] : ['French'], ['Cultural exchange']])
}
await db.exec(`insert into questions values('${id(100)}','First',true,true,null),('${id(101)}','Live Question',false,true,1),('${id(102)}','Old Question',false,false,null);`)
for (let n = 1; n <= 7; n++) await db.query('insert into question_answers(id,user_id,question_id,body) values($1,$2,$3,$4)', [id(200+n),id(n),id(n === 1 ? 101 : 100), n === 1 ? '@Strong and @Weak, what do you think?' : 'Answer'])
for (const partner of [2,3,5,6,7]) {
  await db.query('insert into correspondences(id,participant_low,participant_high) values($1,$2,$3)', [id(300+partner), id(1), id(partner)])
  for (let j = 0; j < (partner === 2 ? 5 : 1); j++) await db.query('insert into letters(id,correspondence_id,sender_id,recipient_id,reply_to_id,deliver_at) values($1,$2,$3,$4,$5,$6)', [id(400+partner*10+j),id(300+partner),id(partner),id(1),id(499),partner === 6 ? '2100-01-01' : '2000-01-01'])
}
await db.exec(`insert into blocked_users values('${id(1)}','${id(5)}'); insert into account_closures values('${id(7)}');`)
const bodyFoundation = await sql('2026-09-07-dispatches-and-board.sql')
await db.exec(bodyFoundation.match(/create or replace function public\.dispatch_visible_length\(p_body text\)[\s\S]*?\$\$;/)[0])
await db.exec('create table public.dispatches(body text, constraint dispatches_body_visible_length check(public.dispatch_visible_length(body) <= 10000));')
for (const name of ['2026-09-30-room-fair-exposure.sql','2026-09-30-room-fair-exposure-set-based-recorder.sql','2026-10-01-engagement-production.sql']) await db.exec(await sql(name))
assert.equal((await db.query(await sql('2026-10-01-engagement-production-verify.sql'))).rows[0].result, 'ENGAGEMENT_RECONCILIATION_VERIFIED')

await db.exec('grant usage on schema tempa_private to authenticated;')
await db.exec(await sql('2026-10-14-member-introductions.sql'))
assert.equal((await db.query(await sql('2026-10-01-member-introductions-preflight.sql'))).rows[0].result,'MEMBER_INTRODUCTIONS_READY')
await asUser(1)
const first = (await db.query('select * from get_member_introductions(7)')).rows
assert.equal(first.length,1)
assert.equal(first[0].candidate_id,id(4))
assert.equal(first[0].priority_tier,1)
await db.query('select mark_member_introduction_presented($1)',[id(4)])
assert.equal((await db.query('select * from get_member_introductions(7)')).rows[0].priority_tier,2)
await db.exec('reset role;')
for (const n of [8,9]) {
 await db.query("insert into auth.users(id,created_at) values($1,(select baseline_at+interval '1 second' from member_introduction_state where viewer_id=$2))",[id(n),id(1)])
 await db.query('insert into profiles(id,pseudonym,country,gender,age_range,languages,intent) values($1,$2,$3,$4,$5,$6,$7)',[id(n),`New ${n}`,'Kenya','Woman','25-34',['English'],['Cultural exchange']]);
 await db.query('insert into question_answers(id,user_id,question_id,body) values($1,$2,$3,$4)',[id(200+n),id(n),id(100),'New writing']);
}
await asUser(1)
const added = (await db.query('select * from get_member_introductions(7)')).rows
assert.deepEqual(added.map(r=>r.priority_tier),[0,0,2])
await db.query('select mark_member_introduction_presented($1)',[added[0].candidate_id])
const returned = (await db.query('select * from get_member_introductions(7)')).rows.filter(r=>r.priority_tier===0)
assert.equal(returned.length,1)
await db.query('select consume_member_introduction($1,$2)',[returned[0].candidate_id,'profile'])
assert.equal((await db.query('select * from get_member_introductions(7)')).rows.filter(r=>r.priority_tier===0).length,0)
await asUser(2)
assert.equal((await db.query('select * from member_introduction_history where viewer_id=$1',[id(1)])).rows.length,0)
await denied(`insert into member_introduction_history(viewer_id,candidate_id) values('${id(1)}','${id(9)}')`)
await asUser(0,'anon')
await denied('select * from get_member_introductions(7)')
// Apply the forward-only upgrade twice: repeatable without resetting history.
await db.exec('reset role;')
for (let i=0;i<2;i++) await db.exec(await sql('2026-10-01-member-introductions-recycling.sql'))
assert.equal((await db.query(await sql('2026-10-01-member-introductions-recycling-verify.sql'))).rows[0].result,'INTRODUCTION_RECYCLING_VERIFIED')
await asUser(1)
// All three previously encountered people are cooling down, including old consumed rows.
assert.equal((await db.query('select * from get_member_introductions(7)')).rows.length,0)
await db.exec("reset role; update member_introduction_history set last_presented_at=now()-interval '8 days', consumed_at=case when consumed_at is not null then now()-interval '8 days' end where viewer_id='"+id(1)+"';")
await asUser(1)
const recycled = (await db.query('select * from get_member_introductions(7)')).rows
assert.equal(recycled.length,3)
assert.ok(recycled.every(r=>r.priority_tier===2))
// Six days remains hidden; exactly seven days is eligible at the same transaction clock.
await db.exec('reset role; begin;')
await db.query("update member_introduction_history set last_presented_at=now()-interval '6 days', consumed_at=null, consumed_reason=null where viewer_id=$1 and candidate_id=$2",[id(1),id(4)])
await asUser(1)
assert.ok(!(await db.query('select * from get_member_introductions(7)')).rows.some(r=>r.candidate_id===id(4)))
await db.exec('reset role;')
await db.query("update member_introduction_history set last_presented_at=now()-interval '7 days' where viewer_id=$1 and candidate_id=$2",[id(1),id(4)])
await asUser(1)
assert.ok((await db.query('select * from get_member_introductions(7)')).rows.some(r=>r.candidate_id===id(4)))
await db.exec('commit;')
// Every retrieval shuffles the same eligible pool (20 independent samples).
const orders = new Set()
for(let i=0;i<20;i++) orders.add((await db.query('select * from get_member_introductions(7)')).rows.map(r=>r.candidate_id).join(','))
assert.ok(orders.size>1)
// A presentation refreshes the cooldown even for formerly consumed people.
await db.query('select mark_member_introduction_presented($1)',[id(9)])
assert.ok(!(await db.query('select * from get_member_introductions(7)')).rows.some(r=>r.candidate_id===id(9)))
// Starting a draft or viewing a profile records an encounter; does not prove sending.
await db.query('select consume_member_introduction($1,$2)',[id(8),'write'])
await db.exec("reset role; update member_introduction_history set last_presented_at=now()-interval '8 days',consumed_at=now()-interval '8 days' where viewer_id='"+id(1)+"' and candidate_id='"+id(8)+"';")
await asUser(1)
assert.ok((await db.query('select * from get_member_introductions(7)')).rows.some(r=>r.candidate_id===id(8)))
// Sending to any answer excludes the person, even if their representative answer changes.
await db.exec('reset role;')
await db.query('insert into letters(id,sender_id,recipient_id,question_answer_id) values($1,$2,$3,$4)',[id(990),id(1),id(8),id(998)])
for(let n=10;n<=20;n++) {
 await db.query("insert into auth.users(id,created_at) values($1,$2)",[id(n),n===10?'2100-01-01':'2000-01-01'])
 await db.query("insert into profiles(id,pseudonym,languages,intent) values($1,$2,$3,$4)",[id(n),`Member ${n}`,['English'],['Cultural exchange']])
 await db.query("insert into question_answers(id,user_id,question_id,body) values($1,$2,$3,$4)",[id(200+n),id(n),id(100),'Writing'])
}
await asUser(1)
const bounded=(await db.query('select * from get_member_introductions(999)')).rows
assert.equal(bounded.length,7)
assert.equal(bounded[0].candidate_id,id(10))
assert.equal(bounded[0].priority_tier,0)
assert.ok(bounded.slice(1).every(r=>r.priority_tier===1))
assert.ok(!bounded.some(r=>[2,3,5,6,7,8,9].some(n=>r.candidate_id===id(n))))
await asUser(2)
assert.equal((await db.query('select * from member_introduction_history where viewer_id=$1',[id(1)])).rows.length,0)
await asUser(0,'anon')
await denied('select * from get_member_introductions(7)')
await denied(`select mark_member_introduction_presented('${id(4)}')`)
await denied(`select consume_member_introduction('${id(4)}','profile')`)
await db.close()
console.log('Original foundation and recycling upgrade passed: repeatable migration, seven-day cooldown, old dismissals restored, unseen priority, shuffled retrieval, draft versus sent-letter exclusion, seven-card cap, own history RLS and anonymous denial.')
