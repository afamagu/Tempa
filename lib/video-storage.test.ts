import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
const sender='11111111-1111-4111-8111-111111111111'
const recipient='22222222-2222-4222-8222-222222222222'
const outsider='33333333-3333-4333-8333-333333333333'
const corr='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const letter='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const path=`${corr}/video/cccccccc-cccc-4ccc-8ccc-cccccccccccc.mp4`
let db: PGlite
beforeAll(async () => {
 db=new PGlite()
 await db.exec(`
 create role anon; create role authenticated;
 create schema auth; create schema storage; create schema tempa_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table storage.buckets(id text primary key, public boolean, file_size_limit bigint,allowed_mime_types text[]);
 insert into storage.buckets values('letter-photos',false,5242880,array['image/jpeg']);
 create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb);
 create table public.correspondences(id uuid,participant_low uuid,participant_high uuid,status text,established_at timestamptz,photo_consent_status text);
 insert into public.correspondences values('${corr}','${sender}','${recipient}','active',now(),'enabled');
 create table public.letters(id uuid,correspondence_id uuid,sender_id uuid,deliver_at timestamptz);
 insert into public.letters values('${letter}','${corr}','${sender}',now()+interval '1 day');
 create table public.moments(letter_id uuid,type text,image_path text,trim_start_seconds numeric,duration_seconds numeric);
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create function public.current_account_status() returns text language sql stable as $$select 'active'::text$$;
 create function public.moments_qualified_for_viewer(uuid) returns boolean language sql stable as $$select true$$;
 create function tempa_private.is_blocked_pair(uuid,uuid) returns boolean language sql stable as $$select coalesce(current_setting('test.blocked',true),'false')='true'$$;
 create function public.is_correspondence_participant(uuid) returns boolean language sql stable security definer as $$select exists(select 1 from correspondences where id=$1 and auth.uid() in(participant_low,participant_high))$$;
 create function public.can_view_letter_photo(text) returns boolean language sql stable security definer as $$
 select exists(select 1 from moments m join letters l on l.id=m.letter_id join correspondences c on c.id=l.correspondence_id
 where m.image_path=$1 and auth.uid() in(c.participant_low,c.participant_high)
 and (l.sender_id=auth.uid() or(c.photo_consent_status='enabled' and l.deliver_at<=now()))
 and not tempa_private.is_blocked_pair(c.participant_low,c.participant_high))$$;
 alter table storage.objects enable row level security;
 grant usage on schema auth,storage to authenticated; grant select,insert on storage.objects to authenticated;
 create policy letter_photos_insert on storage.objects for insert to authenticated with check(bucket_id='letter-photos' and public.is_correspondence_participant((storage.foldername(name))[1]::uuid));
 create policy letter_photos_select on storage.objects for select to authenticated using(bucket_id='letter-photos' and public.can_view_letter_photo(name));
 `)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261010053745_video_moments_storage_repair.sql',import.meta.url),'utf8'))
},30_000)
afterAll(async()=>{await db.close()})
async function asUser<T>(uid: string, action:()=>Promise<T>):Promise<T>{
 await db.exec(`set role authenticated; select set_config('test.uid','${uid}',false);`)
 try{return await action()}finally{await db.exec('reset role')}
}
describe('video Storage migration and consent boundaries',()=>{
 it('preserves the private bucket and original JPEG size limit',async()=>{
 const result=await db.query<{public:boolean;file_size_limit:number;allowed_mime_types:string[]}>('select * from storage.buckets')
 expect(result.rows[0]).toMatchObject({public:false,file_size_limit:5242880,allowed_mime_types:['image/jpeg','video/mp4']})
 })
 it('allows the qualified sender to upload a clip and restore an unsent draft',async()=>{
 await asUser(sender,()=>db.query('insert into storage.objects values($1,$2,$3,$4)', ['letter-photos',path,sender,{mimetype:'video/mp4'}]))
 const result=await asUser(sender,()=>db.query('select * from storage.objects where name=$1',[path]))
 expect(result.rows).toHaveLength(1)
 })
 it('does not expose unsent footage to the recipient or outsider',async()=>{
 for(const uid of [recipient,outsider]) expect((await asUser(uid,()=>db.query('select * from storage.objects where name=$1',[path]))).rows).toHaveLength(0)
 })
 it('rejects a video disguised as a photo, and outsiders uploading to this correspondence',async()=>{
 await expect(asUser(sender,()=>db.query('insert into storage.objects values($1,$2,$3,$4)', ['letter-photos',`${corr}/fake.jpg`,sender,{mimetype:'video/mp4'}]))).rejects.toThrow()
 await expect(asUser(outsider,()=>db.query('insert into storage.objects values($1,$2,$3,$4)', ['letter-photos',path,outsider,{mimetype:'video/mp4'}]))).rejects.toThrow()
 })
 it('preserves JPEG uploads',async()=>{
 await asUser(sender,()=>db.query('insert into storage.objects values($1,$2,$3,$4)', ['letter-photos',`${corr}/photo.jpg`,sender,{mimetype:'image/jpeg'}]))
 })
 it('rejects original playback windows, missing durations, and missing clip references',async()=>{
 await db.exec(`select set_config('test.uid','${sender}',false)`)
 for(const [start,duration,clip] of [[5,10,path],[0,null,path],[0,11,path],[0,10,`${corr}/video/dddddddd-dddd-4ddd-8ddd-dddddddddddd.mp4`]]) {
 await expect(db.query('insert into moments values($1,$2,$3,$4,$5)',[letter,'video',clip,start,duration])).rejects.toThrow('missing or invalid')
 }
 })
 it('recipient read requires both delivery and consent, including after re-signing',async()=>{
 await db.query('insert into moments values($1,$2,$3,0,10)',[letter,'video',path])
 expect((await asUser(recipient,()=>db.query('select * from storage.objects where name=$1',[path]))).rows).toHaveLength(0)
 await db.exec(`update letters set deliver_at=now()-interval '1 second'; update correspondences set photo_consent_status='pending'`)
 expect((await asUser(recipient,()=>db.query('select * from storage.objects where name=$1',[path]))).rows).toHaveLength(0)
 await db.exec("update correspondences set photo_consent_status='enabled'")
 for(let i=0;i<2;i++) expect((await asUser(recipient,()=>db.query('select * from storage.objects where name=$1',[path]))).rows).toHaveLength(1)
 })
 it('a block prevents sender draft reads and recipient delivered reads',async()=>{
 await db.exec("select set_config('test.blocked','true',false)")
 for(const uid of [sender,recipient]) expect((await asUser(uid,()=>db.query('select * from storage.objects where name=$1',[path]))).rows).toHaveLength(0)
 })
})
