import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const {PGlite}=await import(process.env.TEMPA_SQL_TEST_MODULE??'@electric-sql/pglite')
const db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,deleted_at timestamptz,recovery_token text,confirmation_token text);
create table public.account_enforcement_state(user_id uuid primary key,status text);
create table public.account_closures(user_id uuid primary key,closed_at timestamptz default now(),storage_objects jsonb default '{}',storage_cleaned_at timestamptz,auth_disabled_at timestamptz,last_error text);
alter table public.account_closures enable row level security;
revoke all on public.account_closures from public,anon,authenticated;
`)
for(let n=1;n<=6;n++) await db.query('insert into auth.users(id,recovery_token,deleted_at) values($1,$2,$3)',[id(n),'token'.repeat(12)+n,n===6?'2026-10-01':null])
for(let n=1;n<=4;n++) await db.query('insert into account_closures(user_id) values($1)',[id(n)])
await db.query('insert into account_closures(user_id) values($1)',[id(6)])
for(const [n,status] of [[2,'banned'],[3,'suspended'],[4,'restricted']]) await db.query('insert into account_enforcement_state values($1,$2)',[id(n),status])
const sql=await readFile(new URL('../docs/sql/2026-10-02-deleted-member-return.sql',import.meta.url),'utf8')
await db.exec(sql);await db.exec(sql)
await db.exec('set role service_role')
const states=[]
for(let n=1;n<=5;n++) states.push((await db.query('select account_auth_state($1) as state',[id(n)])).rows[0].state)
assert.deepEqual(states,['deleted','permanently_banned','deleted','deleted','none'])
const queue=(await db.query('select * from closed_account_auth_repair_candidates()')).rows
assert.deepEqual(queue.map(r=>r.user_id).sort(),[1,3,4].map(id))
assert.deepEqual(Object.keys(queue[0]).sort(),['closed_at','storage_objects','user_id'])
assert.equal((await db.query('select * from closed_account_auth_repair_candidates($1)',[id(2)])).rows.length,0)
assert.equal((await db.query('select * from closed_account_auth_repair_candidates($1)',[id(5)])).rows.length,0)
assert.equal((await db.query('select * from closed_account_auth_repair_candidates($1)',[id(6)])).rows.length,0)
assert.equal((await db.query('select account_auth_state_for_email_link($1) as state',['token'.repeat(12)+'1'])).rows[0].state,'deleted')
assert.equal((await db.query('select account_auth_state_for_email_link($1) as state',[''])).rows[0]?.state,null)
// Changing a candidate's enforcement immediately removes it from the queue.
await db.exec('reset role');await db.query("insert into account_enforcement_state values($1,'banned')",[id(1)]);await db.exec('set role service_role')
assert.equal((await db.query('select * from closed_account_auth_repair_candidates($1)',[id(1)])).rows.length,0)
for(const role of ['anon','authenticated']) {
 await db.exec(`reset role;set role ${role}`)
 for(const call of ['account_auth_state(\''+id(1)+'\')','account_auth_state_for_email_link(\''+'token'.repeat(12)+'1\')','closed_account_auth_repair_candidates()']) await assert.rejects(db.query('select * from '+call))
 await assert.rejects(db.query('select * from account_closures'))
}
await db.exec('reset role')
const result=await db.query(await readFile(new URL('../docs/sql/2026-10-02-deleted-member-return-verify.sql',import.meta.url),'utf8'))
assert.equal(result.rows[0].result,'DELETED_MEMBER_RETURN_READY')
assert.equal((await db.query('select count(*) as n from account_closures')).rows[0].n,5)
await db.close()
console.log('Deleted-member-return SQL passed: repeatable migration, banned precedence, voluntary/restricted/suspended closure return, active and retired exclusions, exact candidate id, state changes, private service-only access and unchanged closure history.')
