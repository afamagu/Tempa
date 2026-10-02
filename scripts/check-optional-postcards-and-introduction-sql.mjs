import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const {PGlite}=await import(process.env.TEMPA_SQL_TEST_MODULE??'@electric-sql/pglite')
const db=new PGlite()
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
await db.exec(`create role anon;create role authenticated;create schema auth;create schema tempa_private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon;
create table public.profiles(id uuid primary key,onboarding_stage text);
create table public.question_answers(user_id uuid,body text);
create table public.bans(user_id uuid);
create function tempa_private.account_is_banned(a uuid) returns boolean language sql stable as $$ select exists(select 1 from public.bans where user_id=a) $$;
create table public.postcard_catalog(key text,is_active boolean);
create table public.postcard_versions(postcard_key text,is_current boolean);
insert into public.postcard_catalog values('seaside',true),('inactive',false);
insert into public.postcard_versions values('seaside',true);
create table public.letter_postcards(back_message text not null,constraint letter_postcards_back_message_length check(char_length(trim(both from back_message)) between 1 and 300));
create table public.dispatch_postcards(back_message text not null,constraint dispatch_postcards_back_message_length check(char_length(trim(both from back_message)) between 1 and 300));
alter table public.letter_postcards enable row level security;alter table public.dispatch_postcards enable row level security;
revoke all on public.letter_postcards,public.dispatch_postcards,public.profiles,public.question_answers from authenticated,anon;
`)
const safety=await readFile(new URL('../docs/sql/2026-10-03-safety-persistence.sql',import.meta.url),'utf8')
const start=safety.indexOf('create or replace function tempa_private.postcard_shape_is_valid(')
const end=safety.indexOf('$function$;',start)+'$function$;'.length
await db.exec(safety.slice(start,end))
await db.exec('revoke all on function tempa_private.postcard_shape_is_valid(jsonb) from public,anon,authenticated')
// The installed public functions have different signatures and larger bodies;
// exercise their exact legacy guard and preserve a stand-in authorization check.
for(const name of ['write_letter','reply_to_letter','publish_dispatch','update_dispatch','publish_official_dispatch']) {
 const failure=name.includes('dispatch')?'published':'sent'
 await db.exec(`create function public.${name}(p_postcard jsonb) returns text language plpgsql security definer set search_path='pg_catalog' as $function$
 declare v_back_message text;
 begin
 if p_postcard->>'forbidden'='yes' then raise exception 'Existing Safety check';end if;
 v_back_message := p_postcard->>'back_message';
 if v_back_message is null or char_length(trim(both from v_back_message)) = 0 then
 raise exception 'A Postcard needs its own written message before it can be ${failure}.';
 end if;
 if char_length(trim(both from v_back_message))>300 then raise exception 'Too long';end if;
 return trim(both from v_back_message);
 end;$function$;
 revoke all on function public.${name}(jsonb) from public,anon;grant execute on function public.${name}(jsonb) to authenticated;`)
}
const sql=await readFile(new URL('../docs/sql/2026-10-02-optional-postcards-and-introduction.sql',import.meta.url),'utf8')
await db.exec(sql);await db.exec(sql)
for(const table of ['letter_postcards','dispatch_postcards']) {
 await db.query(`insert into public.${table} values($1)`,[''])
 await assert.rejects(db.query(`insert into public.${table} values($1)`,['x'.repeat(301)]))
}
for(const note of [null,'','   ','A real note']) {
 const shape={postcard_key:'seaside',back_message:note}
 assert.equal((await db.query('select tempa_private.postcard_shape_is_valid($1) as ok',[shape])).rows[0].ok,true)
 for(const name of ['write_letter','reply_to_letter','publish_dispatch','update_dispatch','publish_official_dispatch']) {
  assert.equal((await db.query(`select public.${name}($1) as note`,[shape])).rows[0].note,(note??'').trim())
  await assert.rejects(db.query(`select public.${name}($1)`,[{...shape,forbidden:'yes'}]))
 }
}
for(const shape of [{postcard_key:'inactive',back_message:''},{postcard_key:'seaside',back_message:'x'.repeat(301)},{postcard_key:'seaside',back_message:'',reveal_line:'x'.repeat(33)}]) {
 assert.equal((await db.query('select tempa_private.postcard_shape_is_valid($1) as ok',[shape])).rows[0].ok,false)
}
await db.query('insert into profiles values($1,$2),($3,$4)',[uid,'question',other,'question'])
await db.query("select set_config('test.uid',$1,false)",[uid]);await db.exec('set role authenticated')
await db.exec('select public.defer_flagship_onboarding();select public.defer_flagship_onboarding();')
await db.exec('reset role')
assert.deepEqual((await db.query('select onboarding_stage from profiles order by id')).rows.map(r=>r.onboarding_stage),['complete','question'])
assert.equal((await db.query('select count(*) as n from question_answers')).rows[0].n,0)
await db.query("update profiles set onboarding_stage='mark' where id=$1",[uid]);await db.exec('set role authenticated');await assert.rejects(db.exec('select public.defer_flagship_onboarding()'));await db.exec('reset role')
await db.query('insert into bans values($1)',[uid]);await db.exec('set role authenticated');await assert.rejects(db.exec('select public.defer_flagship_onboarding()'));await db.exec('reset role')
await db.exec('set role anon');await assert.rejects(db.exec('select public.defer_flagship_onboarding()'));await db.exec('reset role')
const checked=await db.query(await readFile(new URL('../docs/sql/2026-10-02-optional-postcards-and-introduction-verify.sql',import.meta.url),'utf8'))
assert.equal(checked.rows[0].result,'OPTIONAL_POSTCARDS_INTRODUCTION_READY')
assert.equal((await db.query("select bool_and(relrowsecurity) as ok from pg_class where oid in ('letter_postcards'::regclass,'dispatch_postcards'::regclass)")).rows[0].ok,true)
await db.close();console.log('Optional postcards and introduction SQL passed: repeatable patch, blank notes, retained limits/Safety/ACL/RLS, self-only deferral, no fabricated answers, Mark/banned/anonymous refusal.')
