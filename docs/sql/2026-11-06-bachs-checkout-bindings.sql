begin;
create table if not exists public.commerce_bachs_checkouts (
 checkout_id text primary key check (checkout_id ~ '^chk_[A-Za-z0-9_-]+$'),
 order_id uuid not null unique references public.commerce_orders(id),
 reference text not null unique,
 created_at timestamptz not null default now()
);
alter table public.commerce_bachs_checkouts enable row level security;
revoke all on public.commerce_bachs_checkouts from public,anon,authenticated;
grant select,insert on public.commerce_bachs_checkouts to service_role;
commit;
