import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.TEMPA_SQL_TEST_MODULE ?? '@electric-sql/pglite')
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated;
create table public.dispatches(id uuid primary key, web_public boolean not null);
create table public.dispatch_moments(
 id uuid primary key default gen_random_uuid(), dispatch_id uuid not null references dispatches(id),
 position integer not null, image_path text not null,
 constraint dispatch_moments_unique_gap unique(dispatch_id,position),
 constraint dispatch_moments_position_nonnegative check(position>=0)
);
alter table public.dispatch_moments enable row level security;
grant select on public.dispatch_moments to authenticated;
create policy moment_read on public.dispatch_moments for select to authenticated using(true);
create table public.letters(id integer primary key);
create table public.moments(letter_id integer references letters(id),position integer,unique(letter_id,position));
create function public.get_shared_dispatch(uuid) returns jsonb language sql security definer set search_path=pg_catalog as $$
select coalesce((select jsonb_agg(jsonb_build_object('position',dm.position,'image_path',dm.image_path) order by dm.position)
from public.dispatch_moments dm where dm.dispatch_id=$1 and exists(select 1 from public.dispatches d where d.id=$1 and d.web_public)),'[]'::jsonb)
$$;
create function public.get_public_dispatch(text) returns jsonb language sql security definer set search_path=pg_catalog as $$
select public.get_shared_dispatch($1::uuid) || coalesce((select jsonb_agg(jsonb_build_object('position',dm.position,'image_path',dm.image_path) order by dm.position)
from public.dispatch_moments dm where false),'[]'::jsonb)
$$;
revoke all on function public.get_shared_dispatch(uuid),public.get_public_dispatch(text) from public;
grant execute on function public.get_shared_dispatch(uuid),public.get_public_dispatch(text) to anon,authenticated;
insert into public.dispatches values('00000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000002',false);
insert into public.dispatch_moments(dispatch_id,position,image_path) values('00000000-0000-0000-0000-000000000001',0,'old.jpg');
`)
const readersBefore = (await db.query("select oid,proacl::text,prosecdef,proconfig,pg_get_functiondef(oid) as definition from pg_proc where oid in('get_shared_dispatch(uuid)'::regprocedure,'get_public_dispatch(text)'::regprocedure) order by oid")).rows
const migration = await readFile(new URL('../docs/sql/2026-10-02-multiple-dispatch-moments.sql', import.meta.url),'utf8')
await db.exec(migration)
await db.exec(migration)
const verified = (await db.query(await readFile(new URL('../docs/sql/2026-10-02-multiple-dispatch-moments-verify.sql',import.meta.url),'utf8'))).rows[0]
assert.equal(verified.result,'MULTIPLE_DISPATCH_MOMENTS_READY')
const readersAfter = (await db.query("select oid,proacl::text,prosecdef,proconfig,pg_get_functiondef(oid) as definition from pg_proc where oid in('get_shared_dispatch(uuid)'::regprocedure,'get_public_dispatch(text)'::regprocedure) order by oid")).rows
for(let i=0;i<readersBefore.length;i++) {
 const before=readersBefore[i],after=readersAfter[i]
 assert.deepEqual({...before,definition:undefined},{...after,definition:undefined})
 assert.equal(after.definition.replaceAll('order by dm.position, dm.attachment_order','order by dm.position'),before.definition)
}
// The unchanged publishing RPCs insert one row for every JSON array item.
await db.query(`insert into public.dispatch_moments(dispatch_id,position,image_path)
select '00000000-0000-0000-0000-000000000001',(m->>'position')::integer,m->>'image_path'
from jsonb_array_elements($1::jsonb) m`,[JSON.stringify([{position:0,image_path:'first.jpg'},{position:0,image_path:'second.jpg'},{position:0,image_path:'second.jpg'},{position:1,image_path:'third.jpg'}])])
await db.exec('set role anon')
const read = (await db.query("select public.get_shared_dispatch('00000000-0000-0000-0000-000000000001') result")).rows[0].result
assert.deepEqual(read.map(m=>m.image_path),['old.jpg','first.jpg','second.jpg','second.jpg','third.jpg'])
const publicRead=(await db.query("select public.get_public_dispatch('00000000-0000-0000-0000-000000000001') result")).rows[0].result
assert.deepEqual(publicRead,read)
assert.deepEqual((await db.query("select public.get_shared_dispatch('00000000-0000-0000-0000-000000000002') result")).rows[0].result,[])
await assert.rejects(db.query("insert into public.dispatch_moments(dispatch_id,position,image_path) values('00000000-0000-0000-0000-000000000001',0,'denied.jpg')"),/permission denied/)
await db.exec('reset role;set role authenticated')
await assert.rejects(db.query("insert into public.dispatch_moments(dispatch_id,position,image_path) values('00000000-0000-0000-0000-000000000001',0,'denied.jpg')"),/permission denied/)
await db.exec('reset role')
await assert.rejects(db.query("insert into public.dispatch_moments(dispatch_id,position,image_path) values('00000000-0000-0000-0000-000000000001',-1,'invalid.jpg')"),/dispatch_moments_position_nonnegative/)
assert.equal((await db.query("select count(*)::int as n from public.dispatch_moments")).rows[0].n,5)
assert.equal((await db.query("select count(*)::int as n from pg_constraint where conrelid='public.moments'::regclass and contype='u'")).rows[0].n,1)
console.log('MULTIPLE_DISPATCH_MOMENTS_READY: repeated migration, every photo retained in order, identical reader gates/ACLs, anonymous/member write denial, valid positions and unchanged letter tables verified.')
await db.close()
