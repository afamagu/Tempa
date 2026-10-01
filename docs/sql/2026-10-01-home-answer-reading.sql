begin;
create table if not exists public.member_answer_reads (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  answer_id uuid not null references public.question_answers(id) on delete cascade,
  first_read_at timestamptz not null default now(),
  primary key(viewer_id,answer_id)
);
alter table public.member_answer_reads enable row level security;
drop policy if exists member_answer_reads_own on public.member_answer_reads;
create policy member_answer_reads_own on public.member_answer_reads for select to authenticated using(viewer_id=auth.uid());
drop policy if exists member_answer_reads_insert_own on public.member_answer_reads;
create policy member_answer_reads_insert_own on public.member_answer_reads for insert to authenticated with check(viewer_id=auth.uid() and exists(select 1 from public.question_answers qa where qa.id=answer_id and qa.user_id<>auth.uid() and qa.moderation_status='visible'));
revoke all on public.member_answer_reads from public,anon,authenticated;
grant select,insert on public.member_answer_reads to authenticated;
create or replace function public.mark_member_answer_read(p_answer_id uuid)
returns void language plpgsql security invoker set search_path='pg_catalog' as $fn$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not exists(select 1 from public.question_answers where id=p_answer_id and user_id<>auth.uid() and moderation_status='visible') then return; end if;
  insert into public.member_answer_reads(viewer_id,answer_id) values(auth.uid(),p_answer_id) on conflict do nothing;
end;
$fn$;
revoke all on function public.mark_member_answer_read(uuid) from public,anon;
grant execute on function public.mark_member_answer_read(uuid) to authenticated;
commit;
