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

await db.exec(`
 create table public.interests(key text primary key,label text);
 create table public.profile_interests(viewer_user_id uuid,interest_key text,primary key(viewer_user_id,interest_key));
 alter table public.profile_interests enable row level security;
 create policy own_interests on public.profile_interests for select using(viewer_user_id=auth.uid());
 grant select on public.profile_interests to authenticated;
 insert into public.interests values('music','Music'),('books-literature','Books & Literature'),('travel-places','Travel & Places');
 insert into public.profile_interests values('${id(1)}','music'),('${id(1)}','books-literature'),('${id(4)}','music');
`)
for (let n=8;n<=25;n++) {
 await db.query('insert into profiles(id,pseudonym,country,gender,age_range,languages,intent) values($1,$2,$3,$4,$5,$6,$7)',[id(n),`Person ${n}`,'France','Woman','25-34',['French'], n===8 ? ['Cultural exchange','Meaningful friendship'] : ['Something else']]);
}
await db.exec(`insert into profile_interests values('${id(8)}','music'),('${id(8)}','books-literature'),('${id(9)}','music');
 insert into account_deactivations values('${id(10)}',null);
 insert into correspondence_hidden_for_user values('${id(1)}','${id(303)}');
`)
await db.exec(await sql('2026-10-01-discover-people.sql'))
assert.equal((await db.query(await sql('2026-10-01-discover-people-verify.sql'))).rows[0].result,'DISCOVER_PEOPLE_VERIFIED')
await asUser(1)
const browse = async (seed, exclude=[]) => (await db.query('select discover_profile_people(p_seed=>$1,p_exclude_user_ids=>$2::uuid[],p_limit=>6) as result',[seed,exclude])).rows[0].result
const first = await browse('visit-a')
assert.equal(first.entries.length,6)
const ids = first.entries.map(e=>e.user_id)
const second = await browse('visit-a',ids)
assert.equal(second.entries.length,6)
const cursorPage = (await db.query('select discover_profile_people(p_seed=>$1,p_after_user_id=>$2::uuid) as result',['visit-a',ids.at(-1)])).rows[0].result
assert.deepEqual(cursorPage.entries.map(e=>e.user_id),second.entries.map(e=>e.user_id))
assert.ok(second.entries.every(e=>!ids.includes(e.user_id)))
assert.deepEqual((await browse('visit-a')).entries.map(e=>e.user_id),ids)
assert.notDeepEqual((await browse('visit-b')).entries.map(e=>e.user_id),ids)
const everyone = (await one("select discover_profile_people(p_limit=>24) as result")).result.entries
assert.ok(everyone.some(e=>e.user_id===id(2))) // existing correspondent remains in ordinary Discover
for (const n of [1,3,5,7,10]) assert.ok(!everyone.some(e=>e.user_id===id(n)))
assert.ok(everyone.some(e=>e.user_id===id(8) && e.answer_id==='')) // no answer required
const suggested = (await one("select discover_profile_people(p_suggested=>true,p_limit=>6) as result")).result.entries
assert.equal(suggested[0].user_id,id(8)) // two shared interests plus one shared intent
assert.equal(suggested[1].user_id,id(4)) // one shared interest plus one shared intent
assert.ok(suggested.some(e=>e.user_id===id(9)))
assert.ok(!suggested.some(e=>e.user_id===id(2)))
for (const e of suggested) assert.ok(!('interests' in e) && !('similarity' in e))
assert.equal((await one("select discover_profile_people(p_interest=>'music') as result")).result.entries.length,3)
assert.equal((await one("select discover_profile_people(p_language=>'Yoruba') as result")).result.entries.length,0)
assert.equal((await one("select discover_profile_people(p_search=>'Books') as result")).result.entries.length,1)
assert.equal((await one("select discover_profile_people(p_search=>'Person 8') as result")).result.entries[0].user_id,id(8))
assert.equal((await one(`select count(*)::int as n from profile_interests where viewer_user_id='${id(8)}'`)).n,0)
await denied("select discover_profile_people(p_search=>repeat('x',81))")
await denied("select discover_profile_people(p_exclude_user_ids=>array_fill('00000000-0000-0000-0000-000000000001'::uuid,array[601]))")
await db.exec(`reset role;insert into account_enforcement_state values('${id(1)}','banned');`)
await asUser(1)
await denied('select discover_profile_people()')
await db.exec('reset role; delete from account_enforcement_state;')
await asUser(0,'anon')
await denied('select discover_profile_people()')
await db.close()
console.log('Discover SQL checks passed: six-batch pagination, visit shuffle, all-member browsing, shared signup interests/intent ranking, filters/search, sparse pool, lifecycle/block exclusions, raw preference RLS and anonymous/inactive denial.')
