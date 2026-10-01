process.on('uncaughtException', e => {console.error(e.message, e.code);process.exit(1)});
import { pathToFileURL, fileURLToPath } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
`);
await db.exec(`
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
create table auth.users(id uuid primary key,created_at timestamptz default now());
create table public.profiles(id uuid primary key references auth.users(id),pseudonym text, country text, gender text, gender_custom text, age_range text,mark_id uuid, is_editorial boolean default false,editorial_title text,pseudonym_key text);
create view public.public_profiles with(security_invoker=true) as select * from public.profiles;
create table public.questions(id uuid primary key,prompt text,is_flagship boolean default false,is_active boolean default true,current_position smallint,created_at timestamptz default now());
create table public.question_answers(id uuid primary key,user_id uuid references auth.users(id),question_id uuid references questions(id),body text,moderation_status text default 'visible',is_current boolean default true,updated_at timestamptz default now());
create table public.correspondences(participant_low uuid,participant_high uuid,status text);
create table public.letters_for_participant(sender_id uuid,reply_to_id uuid,question_answer_id uuid);
create table public.admin_audit_log(actor_id uuid,actor_identifier_snapshot text,action text,target_type text,target_id uuid,target_identifier_snapshot text,metadata jsonb);
create function public.current_account_status() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'status','active')$$;
create function public.is_staff(text) returns boolean language sql stable as $$select auth.uid()='00000000-0000-0000-0000-000000000001'::uuid$$;
grant usage on schema auth to authenticated,service_role;
grant select on profiles,public_profiles,questions,question_answers,correspondences,letters_for_participant to authenticated;
`);
const root=fileURLToPath(new URL('../sql/', import.meta.url));
for(const f of ['2026-09-30-room-fair-exposure.sql','2026-09-30-room-fair-exposure-set-based-recorder.sql','2026-09-30-room-current-question.sql','2026-09-30-room-question-suggestions.sql']) {
 await db.exec(fs.readFileSync(root+f,'utf8'));console.log('Loaded',f);
}
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
for(let n=1;n<=14;n++){
 await db.query(`insert into auth.users(id) values($1);`,[uid(n)]);
 await db.query(`insert into profiles(id,pseudonym,country,age_range) values($1,$2,'NG','25-34')`,[uid(n),'Member'+n]);
}
await db.exec(`reset role; set request.jwt.claims='';
create function public.canonicalize_pseudonym(text) returns text language sql immutable as $$select regexp_replace(lower($1),'[^a-z0-9]','','g')$$;
insert into auth.users(id) values('${uid(99)}');
insert into profiles(id,pseudonym,pseudonym_key) values('${uid(99)}','Lady Larkspur','ladylarkspur');
`);
await db.exec(fs.readFileSync(root+'2026-09-30-editorial-byline.sql','utf8'));
await db.exec(fs.readFileSync(root+'2026-10-01-room-engagement-production.sql','utf8'));
await db.exec(`insert into questions(id,prompt,is_flagship,current_position) values('${uid(101)}','First',true,1),('${uid(102)}','Room',false,2),('${uid(103)}','Next',false,null);`);
for(let n=2;n<=14;n++)await db.query(`insert into question_answers(id,user_id,question_id,body) values($1,$2,$3,$4)`,[uid(200+n),uid(n),uid(102),'Answer'+n]);
async function as(role,n){await db.exec(`reset role;set request.jwt.claims='${JSON.stringify({sub:uid(n),role})}';set role ${role}`);}
const discover=async(start=null)=> (await db.query(`select discover_people_v2(p_browse_started_at=>$1::timestamptz) as result`,[start])).rows[0].result;
await as('authenticated',1);
const first=await discover();if(first.entries.length!==6)throw Error('First page not six');
const seen=first.entries.map(e=>e.user_id);
await as('service_role',1);await db.query(`select record_room_exposures($1,$2::uuid[],'room')`,[uid(1),seen]);
await as('authenticated',1);const second=await discover(first.browse_started_at);
if(second.entries.some(e=>seen.includes(e.user_id))||second.entries.length!==6)throw Error('Page2 repeats/skips');
await as('service_role',1);await db.query(`select record_room_exposures($1,$2::uuid[],'room')`,[uid(1),second.entries.map(e=>e.user_id)]);
await as('authenticated',1);const third=await discover(first.browse_started_at);
const all=[...seen,...second.entries.map(e=>e.user_id),...third.entries.map(e=>e.user_id)];
if(new Set(all).size!==13||third.entries.length!==1)throw Error('Browse failed to cover thirteen distinct people');
await as('service_role',1);await db.query(`select record_room_exposures($1,$2::uuid[],'home_room')`,[uid(1),seen]);
await db.exec('reset role');
const counts=(await db.query('select distinct_viewers from private.room_candidate_week_exposure')).rows;
if(counts.some(c=>Number(c.distinct_viewers)!==1))throw Error('Refresh counted twice');
await as('authenticated',2);
let rejected=false;try{await db.exec(`select admin_make_current_room_question('${uid(103)}')`)}catch{rejected=true}if(!rejected)throw Error('Nonadmin allowed');
await as('authenticated',1);await db.exec(`select admin_make_current_room_question('${uid(103)}')`);
await db.exec('reset role');const qs=(await db.query('select * from questions')).rows;
if(qs.find(q=>q.is_flagship).current_position!==1||qs.filter(q=>!q.is_flagship&&q.current_position!==null).length!==1)throw Error('FirstQuestion/live invariant broken');
await db.exec("reset role; set request.jwt.claims='';");
await db.exec(fs.readFileSync(root+'2026-10-01-room-engagement-production-verify.sql','utf8'));
console.log('PASS: complete production/verifier packs including reserved names');
await as('authenticated',2);
for(let n=0;n<3;n++) await db.query('select submit_room_question_suggestion($1,false)', ['What would you like to share today?']);
let throttled=false;try {await db.query('select submit_room_question_suggestion($1,false)', ['What would you like to share today?']);}catch {throttled=true;}
if(!throttled)throw Error('Suggestion rate limit missing');
await db.exec(`reset role; set request.jwt.claims='${JSON.stringify({sub:uid(3),role:'authenticated',status:'banned'})}'; set role authenticated`);
let blocked=false;try {await db.query('select submit_room_question_suggestion($1,false)', ['A different complete suggestion']);}catch {blocked=true;}
if(!blocked)throw Error('Banned account submitted suggestion');
console.log('PASS: suggestion daily cap and account-status guard');
await db.exec('reset role');
await db.exec(`update question_answers set moderation_status='hidden' where user_id='${uid(2)}';
insert into correspondences values('${uid(1)}','${uid(3)}','active');
insert into letters_for_participant values('${uid(1)}',null,'${uid(204)}');`);
await as('authenticated',1);
const eligibility = (await db.query('select discover_people_v2(p_limit=>24) as result')).rows[0].result;
if(eligibility.entries.length!==10 || eligibility.entries.some(e=>[uid(2),uid(3),uid(4)].includes(e.user_id)))throw Error('Hidden/partner/contact eligibility failed');
const focused = (await db.query('select discover_people_v2(p_question_id=>$1,p_limit=>24) as result',[uid(101)])).rows[0].result;
if(focused.entries.length!==0)throw Error('Question focus returned unrelated answers');
console.log('PASS: hidden answer, active-partner, contacted-answer exclusions and exact Question focus');
console.log('PASS: PostgreSQL migration syntax, 13-person browse coverage, refresh accounting, admin guard, First Question preservation');
await db.close();
