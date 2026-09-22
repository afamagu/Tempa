-- ============================================================
-- TEMPA — ARRIVAL EMAIL SCHEDULER: VERIFICATION
-- Run AFTER 2026-10-02-arrival-email-scheduler.sql has been applied.
-- Every statement below is a SELECT — no mutation of any kind, and no
-- decrypted Vault secret VALUE is ever selected, only whether a named
-- secret row exists.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- scheduler has not been installed yet. Per this repo's own
-- established caveat (see e.g. 2026-09-21-adult-eligibility-and-legal-
-- acceptance-verify.sql's header), some checks may need catalog-shape
-- follow-up once actually run against real Postgres/pg_cron. The
-- SUMMARY query's individually named columns are what make that
-- tractable.
--
-- `vault_secret_present` is reported but deliberately NOT part of
-- `overall_pass` — see 2026-10-02-arrival-email-scheduler.sql Part 2's
-- own comment: the job may legitimately be installed before the Vault
-- secret exists, so its absence is informational here, not a failure
-- of the scheduler installation itself.
-- ============================================================

with
extensions_check as (
  select
    exists (select 1 from pg_extension where extname = 'pg_cron') as pg_cron_installed,
    exists (select 1 from pg_extension where extname = 'pg_net') as pg_net_installed
),
job_check as (
  select
    count(*) filter (where jobname = 'tempa-arrival-emails') as exact_name_matches,
    -- Catches both an exact duplicate AND a near-duplicate installed
    -- under a slightly different name (e.g. a typo'd re-run that
    -- didn't hit the idempotent unschedule-by-exact-name path) —
    -- either would leave more than one Tempa arrival-email job firing.
    count(*) filter (where jobname ilike '%tempa%arrival%email%') as tempa_arrival_email_job_count,
    max(schedule) filter (where jobname = 'tempa-arrival-emails') as schedule,
    max(command) filter (where jobname = 'tempa-arrival-emails') as command,
    bool_and(active) filter (where jobname = 'tempa-arrival-emails') as is_active
  from cron.job
),
command_check as (
  select
    coalesce(j.command ilike '%net.http_post%', false) as uses_http_post,
    coalesce(j.command ilike '%https://jointempa.com/api/cron/arrival-emails%', false) as targets_correct_endpoint,
    coalesce(j.command ilike '%vault.decrypted_secrets%', false) as sources_bearer_from_vault,
    coalesce(j.command ilike '%tempa_arrival_email_cron_secret%', false) as references_stable_secret_name,
    -- A literal secret glued directly after "Bearer " (no quote/space)
    -- would look like `Bearer sk_abc123...` in the stored command text;
    -- the correct, Vault-sourced command instead reads
    -- `Bearer ' || (select ...)`, which this pattern does not match.
    coalesce(not (j.command ~ 'Bearer [A-Za-z0-9_\-\.]{15,}'), true) as no_literal_bearer_token,
    coalesce(j.command ilike '%timeout_milliseconds%', false) as declares_bounded_timeout
  from job_check j
),
vault_check as (
  select exists (
    select 1 from vault.decrypted_secrets where name = 'tempa_arrival_email_cron_secret'
  ) as secret_present
)
select
  e.pg_cron_installed,
  e.pg_net_installed,
  (j.exact_name_matches = 1) as exactly_one_job,
  (j.tempa_arrival_email_job_count = 1) as no_duplicate_or_near_duplicate_jobs,
  (j.schedule = '*/5 * * * *') as schedule_is_five_minutes,
  coalesce(j.is_active, false) as job_is_active,
  c.uses_http_post,
  c.targets_correct_endpoint,
  c.sources_bearer_from_vault,
  c.references_stable_secret_name,
  c.no_literal_bearer_token,
  c.declares_bounded_timeout,
  v.secret_present as vault_secret_present,
  (
    e.pg_cron_installed and e.pg_net_installed
    and j.exact_name_matches = 1 and j.tempa_arrival_email_job_count = 1
    and j.schedule = '*/5 * * * *' and coalesce(j.is_active, false)
    and c.uses_http_post and c.targets_correct_endpoint
    and c.sources_bearer_from_vault and c.references_stable_secret_name
    and c.no_literal_bearer_token and c.declares_bounded_timeout
  ) as overall_pass
from extensions_check e, job_check j, command_check c, vault_check v;
