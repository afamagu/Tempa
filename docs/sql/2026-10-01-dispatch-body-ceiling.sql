-- Dispatch long-form publishing hotfix. Run once, then the verifier.
-- Removes the obsolete 10,000-visible-character ceiling. The Safety
-- endpoint continues to enforce its separate 200,000 encoded-character
-- request ceiling. No content, RPC, grants, or visibility changes.
begin;

alter table public.dispatches
  drop constraint if exists dispatches_body_visible_length;

alter table public.dispatches
  add constraint dispatches_body_visible_length
  check (public.dispatch_visible_length(body) <= 200000);

commit;
