-- Read-only verification; no rows or functions are changed.
select
  case when exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.dispatches'::regclass
      and c.conname = 'dispatches_body_visible_length'
      and c.convalidated
      and pg_get_constraintdef(c.oid) =
        'CHECK ((dispatch_visible_length(body) <= 200000))'
  )
  and public.dispatch_visible_length(repeat('x', 10001)) = 10001
  and public.dispatch_visible_length(chr(8291) || '**' || repeat('x', 10001) || '**') = 10001
  then 'DISPATCH_BODY_CEILING_VERIFIED'
  else 'DISPATCH_BODY_CEILING_NOT_VERIFIED'
  end as result;
