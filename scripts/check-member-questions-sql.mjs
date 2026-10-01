import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
create schema auth;create schema private;create schema tempa_private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
create table auth.users(id uuid primary key);
create table profiles(id uuid primary key,pseudonym text,mark_id uuid);
create view public_profiles as select * from profiles where id<>coalesce(nullif(current_setting('test.blocked',true),'')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff');
create table account_enforcement_state(user_id uuid,status text);
create table account_deactivations(user_id uuid,reactivated_at timestamptz);
create function tempa_private.account_is_banned(uuid) returns boolean language sql stable as $$select exists(select 1 from public.account_enforcement_state where user_id=$1 and status='banned')$$;
create function public.is_staff(text) returns boolean language sql stable as $$select current_setting('test.admin',true)='yes'$$;
create table questions(id uuid primary key default gen_random_uuid(),prompt text,family text,is_active boolean default false,is_flagship boolean default false,current_position smallint);
create unique index question_slots on questions(current_position) where current_position is not null;
create table admin_audit_log(actor_id uuid,actor_identifier_snapshot text,action text,target_type text,target_id uuid,target_identifier_snapshot text,metadata jsonb);
create table correspondences(id uuid primary key,participant_low uuid,participant_high uuid);
create table letters(id uuid primary key default gen_random_uuid(),correspondence_id uuid,sender_id uuid,recipient_id uuid,body text);
create view letters_for_participant as select * from letters where sender_id=auth.uid() or (recipient_id=auth.uid() and current_setting('test.delivered',true)='yes');
create table letter_submissions(sender_id uuid,client_submission_id uuid,letter_id uuid,primary key(sender_id,client_submission_id));
create function public.current_account_status() returns text language sql as $$select 'active'::text$$;
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
for (let n=1;n<=4;n++) { await db.query('insert into auth.users values($1)',[id(n)]);await db.query('insert into profiles values($1,$2,null)',[id(n),`Member ${n}`]) }
await db.query('insert into correspondences values($1,$2,$3)',[id(100),id(1),id(2)])
await db.query("insert into questions(id,prompt,is_active,is_flagship,current_position) values($1,'Flagship',true,true,1)",[id(90)])
const sql=await readFile(new URL('../docs/sql/2026-10-01-member-question-profiles.sql',import.meta.url),'utf8')
await db.exec(sql);await db.exec(sql)
await db.exec('create table private.room_invitation_email_config(singleton boolean,sending_enabled boolean);insert into private.room_invitation_email_config values(true,false);')
const verified=await db.query(await readFile(new URL('../docs/sql/2026-10-01-member-question-profiles-verify.sql',import.meta.url),'utf8'));assert.equal(verified.rows[0].result,'MEMBER_QUESTIONS_READY')
async function user(n,role='authenticated',admin=false) { await db.exec(`reset role; select set_config('test.uid','${id(n)}',false);select set_config('test.role','${role}',false);select set_config('test.admin','${admin?'yes':'no'}',false);set role ${role};`) }
const allow={mutationDisposition:'allow',escalateCase:false}
async function publish(n,body,classification=allow,ack=false,legacy=null) { await user(n,'service_role');return (await db.query('select publish_member_question_trusted($1,$2,true,$3,$4,$5) id',[id(n),body,classification,ack,legacy])).rows[0].id }
// Previously private suggestions are not retroactively published.
await user(3);const legacy=(await db.query('select submit_room_question_suggestion($1,true) id',['What would you like to understand better?'])).rows[0].id
await db.exec('reset role');assert.equal((await db.query('select * from member_questions')).rows.length,0)
await assert.rejects(publish(1,'What would you like to understand better?',allow,false,legacy))
await publish(3,'What would you like to understand better?',allow,false,legacy)
// Service has function access but definer owns the private write; no member may forge it.
await user(1);await assert.rejects(db.query('select publish_member_question_trusted($1,$2,true,$3,false,null)',[id(1),'What makes a place feel like home?',allow]))
await assert.rejects(db.query('insert into member_questions(author_id,suggestion_id,body) values($1,$2,$3)',[id(1),id(50),'A forbidden direct publication']))
const q=await publish(2,'What makes a place feel like home?')
const pending=await publish(2,'Which memory would you like to share?',{...allow,escalateCase:true})
await assert.rejects(publish(3,'What would you tell your younger self?',{mutationDisposition:'warn',escalateCase:false},false))
await assert.rejects(publish(3,'What would you tell your younger self?',{mutationDisposition:'deny',escalateCase:true},true))
await user(1);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,1)
await user(2);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,2)
await db.query("select manage_member_question($1,'visibility',false)",[q])
await user(1);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,0)
await assert.rejects(db.query("select manage_member_question($1,'visibility',true)",[q]))
await user(2);await db.query("select manage_member_question($1,'visibility',true)",[q])
await user(1);await assert.rejects(db.query('select send_first_letter_from_member_question($1,$2,$3,$4,null,false)',[id(2),q,id(91),'Hello there']))
await db.exec('reset role');assert.equal((await db.query('select * from letters')).rows.length,0)
await user(1);const letter=(await db.query('select * from send_first_letter_from_member_question($1,$2,$3,$4,$5,false)',[id(2),q,id(91),'Hello there',id(92)])).rows[0]
assert.equal((await db.query('select prompt_snapshot from member_question_letter_contexts where letter_id=$1',[letter.id])).rows[0].prompt_snapshot,'What makes a place feel like home?')
await user(3);assert.equal((await db.query('select * from member_question_letter_contexts')).rows.length,0)
await user(1);await db.exec(`select set_config('test.blocked','${id(2)}',false)`);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,0)
await db.exec("select set_config('test.blocked','',false)")
await db.exec('reset role');await db.query('insert into account_deactivations values($1,null)',[id(2)]);await user(1);assert.equal((await db.query('select * from profile_member_questions($1)',[id(2)])).rows.length,0)
await db.exec('reset role');await db.query('delete from account_deactivations where user_id=$1',[id(2)])
await user(2);assert.equal((await db.query('select * from member_question_letter_contexts')).rows.length,0)
await db.exec("select set_config('test.delivered','yes',false)");assert.equal((await db.query('select * from member_question_letter_contexts')).rows.length,1)
await user(1);const sent=(await db.query('select write_letter_from_member_question_once($1,$2,$3,$4,$5)',[id(200),id(100),q,'Another hello',id(93)])).rows[0]
await db.query('select write_letter_from_member_question_once($1,$2,$3,$4,$5)',[id(200),id(100),q,'Another hello',id(93)])
await assert.rejects(db.query('select write_letter_from_member_question_once($1,$2,$3,$4,$5)',[id(200),id(100),pending,'Another hello',id(93)]))
await db.exec('reset role');assert.equal((await db.query('select * from letters')).rows.length,2)
const suggestion=(await db.query('select suggestion_id from member_questions where id=$1',[q])).rows[0].suggestion_id
await user(1);await assert.rejects(db.query('select admin_select_member_question($1,$2)',[suggestion,'What makes a place feel like home?']))
await user(4,'authenticated',true);const room=(await db.query('select admin_select_member_question($1,$2) id',[suggestion,'What makes a place feel like home?'])).rows[0].id
assert.equal((await db.query('select admin_select_member_question($1,$2) id',[suggestion,'What makes a place feel like home?'])).rows[0].id,room)
assert.equal((await db.query('select * from room_question_credit($1)',[room])).rows.length,1)
await db.exec('reset role');assert.equal((await db.query('select current_position from questions where id=$1',[id(90)])).rows[0].current_position,1)
await user(2);await db.query("select manage_member_question($1,'credit',false)",[q]);await user(1);assert.equal((await db.query('select * from room_question_credit($1)',[room])).rows.length,0)
await user(2);await db.query("select manage_member_question($1,'withdraw',null)",[q]);await user(1)
await assert.rejects(db.query('select send_first_letter_from_member_question($1,$2,$3,$4,$5,false)',[id(2),q,id(91),'Hello again',id(92)]))
// A retry still returns the original successful letter after the question is withdrawn.
await db.query('select write_letter_from_member_question_once($1,$2,$3,$4,$5)',[id(200),id(100),q,'Another hello',id(93)])
await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from member_questions'));await assert.rejects(db.query('select * from profile_member_questions($1)',[id(2)]))
await db.close();console.log('Member-question SQL passed: repeatable migration, trusted publication, warnings/denials, owner/public RLS, hide/withdraw, atomic selection/Flagship preservation, consent attribution, participant delivery privacy, send rollback and scoped retries.')
