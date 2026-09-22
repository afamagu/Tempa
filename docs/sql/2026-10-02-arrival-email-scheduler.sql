-- ============================================================
-- TEMPA — ARRIVAL EMAIL SCHEDULER (Supabase Cron + pg_net + Vault)
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- and ONLY after: (1) the production deployment containing
-- app/api/cron/arrival-emails is live, (2) CRON_SECRET is configured
-- as a Vercel production environment variable, and (3) a Supabase
-- Vault secret named tempa_arrival_email_cron_secret has been created
-- OUT OF BAND (Dashboard → Project Settings → Vault, or a one-off
-- `select vault.create_secret(...)` typed directly into the SQL editor
-- and never committed) holding the SAME random value as CRON_SECRET.
-- See docs/arrival-email-scheduler.md for the full two-secret
-- handshake — that value is never written anywhere in this file, in
-- Git, in cron.job's stored command text, or in any test.
-- ============================================================
--
-- Separate from, and applied strictly after, docs/sql/2026-10-01-
-- arrival-email-delivery.sql (already live in production as of this
-- writing) — that migration built the queue/worker RPC surface this
-- scheduler exists only to trigger on a timer. Nothing here touches
-- any table, RLS policy, or function from that migration, and this
-- file does not change the production sending kill switch (arrival_
-- email_system_config.sending_enabled), which stays false regardless
-- of whether this scheduler is installed.
--
-- Native Vercel Cron cannot be used — the project is confirmed on the
-- Vercel Hobby tier, which only permits once-daily cron schedules;
-- this feature needs 5-minute granularity (see vercel.json's removal
-- in this same commit — the file contained only that now-unusable
-- cron declaration). Supabase's own documented pattern — pg_cron
-- (schedules a periodic job), pg_net (makes the actual outbound HTTP
-- call asynchronously, without blocking the scheduling transaction),
-- and Vault (holds the bearer secret so it is never embedded as a
-- literal value in the job's own stored SQL text) — is used exactly as
-- documented, not a custom scheduler mechanism.
--
-- Idempotent by construction: re-running this whole file always ends
-- with exactly one job named 'tempa-arrival-emails' — Part 3 below
-- unschedules any existing job of that exact name before scheduling a
-- fresh one. No other cron job — Tempa's or anyone else's — is ever
-- touched; the lookup only ever matches this one exact jobname.

begin;

-- ============================================================
-- 1. EXTENSIONS — pg_cron and pg_net, Supabase's documented,
--    project-safe pattern
-- ============================================================
-- Both are on Supabase's own extension allow-list; CREATE EXTENSION
-- for either requires the privileges Supabase grants its projects'
-- `postgres` role by default. If this errors, enable both first via
-- Dashboard → Database → Extensions, then re-run this file. pg_net
-- always exposes its API as `net.http_post`/`net.http_get` regardless
-- of the schema passed to `with schema` here — that clause only places
-- the extension's own control objects, matching Supabase's documented
-- examples.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;


-- ============================================================
-- 2. ADVISORY VAULT-SECRET PRESENCE CHECK — informational only
-- ============================================================
-- Deliberately does not gate scheduling — installing the job ahead of
-- the Vault secret existing is safe (a missing/wrong bearer just makes
-- every tick a 401 the worker never even starts on, and sending stays
-- disabled regardless either way), and an operator may legitimately
-- want the job definition in place before flipping every switch. This
-- only raises a visible NOTICE so a missing secret is never silently
-- discovered later as a string of failed ticks. Checks presence only
-- — never selects vault.decrypted_secrets.decrypted_secret, the actual
-- value.

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'tempa_arrival_email_cron_secret'
  ) then
    raise notice
      'Vault secret "tempa_arrival_email_cron_secret" was not found. The cron job below will still be scheduled, but every tick will send an empty/invalid bearer token until this secret is created (see docs/arrival-email-scheduler.md) — app/api/cron/arrival-emails will reject it with 401, which is safe (no email will send), but the job will silently no-op until the secret exists.';
  end if;
end $$;


-- ============================================================
-- 3. TEMPA-ARRIVAL-EMAILS — the one named job, idempotent install
-- ============================================================
-- Every 5 minutes, POSTs to the production arrival-email cron route
-- with an Authorization header built from the Vault secret at RUN
-- TIME — net.http_post's headers argument is evaluated fresh on every
-- tick from the live vault.decrypted_secrets view, so the secret VALUE
-- itself never appears in cron.job's stored command text (only the
-- Vault secret's NAME does), in this file, or anywhere else in this
-- repository. timeout_milliseconds (240000 = 240s) is bounded well
-- under the Vercel Hobby function ceiling (300s) while comfortably
-- exceeding the worker's own per-provider-request timeout
-- (lib/email/provider.ts's REQUEST_TIMEOUT_MS, 10s) many times over —
-- the worker can process a full batch of jobs, each individually
-- provider-timeout-bounded, without pg_net cutting the whole request
-- short.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tempa-arrival-emails') then
    perform cron.unschedule('tempa-arrival-emails');
  end if;
end $$;

select cron.schedule(
  'tempa-arrival-emails',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://jointempa.com/api/cron/arrival-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'tempa_arrival_email_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  );
  $cron$
);

commit;
