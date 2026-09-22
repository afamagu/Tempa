# Arrival-email scheduler: Supabase Cron, not Vercel Cron

The production Vercel project is on the **Hobby** tier. Vercel Hobby
cron only supports **once-daily** schedules; the arrival-email worker
needs to run every 5 minutes. `vercel.json`'s native `crons`
declaration was removed for this reason — native Vercel Cron is not
used for this feature at all.

Instead, production triggers `POST /api/cron/arrival-emails` every 5
minutes from inside Supabase itself, using Supabase's own documented
pattern:

- **pg_cron** schedules the periodic job (`*/5 * * * *`).
- **pg_net** makes the actual outbound HTTPS call, asynchronously,
  without blocking the scheduling transaction.
- **Supabase Vault** holds the bearer secret, so the secret's value
  never appears as a literal string anywhere — not in the job's own
  stored `cron.job.command` text, not in this repository, not in any
  test.

The job definition lives in
[`docs/sql/2026-10-02-arrival-email-scheduler.sql`](sql/2026-10-02-arrival-email-scheduler.sql),
verified by
[`docs/sql/2026-10-02-arrival-email-scheduler-verify.sql`](sql/2026-10-02-arrival-email-scheduler-verify.sql).
Re-running the install file is safe — it always ends with exactly one
job named `tempa-arrival-emails`, never a duplicate, and never touches
any other cron job in the project.

## The two-secret handshake

`app/api/cron/arrival-emails` authorizes a request by comparing its
`Authorization: Bearer <value>` header, in constant time, against the
server's own `CRON_SECRET` environment variable
(`app/api/cron/arrival-emails/route.ts`). For the scheduler to
actually reach that route, **the same random secret value** must exist
in two separate places:

1. **Vercel production environment** — `CRON_SECRET`. Set this on the
   Vercel project (Project Settings → Environment Variables →
   Production). This is what the route itself checks incoming
   requests against.
2. **Supabase Vault** — a secret named exactly
   `tempa_arrival_email_cron_secret`. This is what the scheduled
   `net.http_post` call reads at every tick to build its
   `Authorization` header. Create it with, e.g.:

   ```sql
   select vault.create_secret(
     '<the same random value used for CRON_SECRET>',
     'tempa_arrival_email_cron_secret',
     'Bearer secret for the Tempa arrival-email cron scheduler (POST /api/cron/arrival-emails)'
   );
   ```

   Run that as a **one-off command typed directly into the Supabase
   SQL editor** (or created via the Vault UI) — **never save it to a
   file, never commit it, never paste it into a chat log or a ticket**.
   Generate the value once (a long random string — e.g. `openssl rand
   -hex 32`), then paste that same value into both places above and
   discard your own copy of it.

If either side is missing or the two values don't match, every
scheduled tick gets a `401` from the route — the worker function never
even starts, and no email can send. That's the safe failure mode: a
misconfigured secret produces silent 401s, never a wrong or duplicate
send.

## Install ordering — do not get ahead of this

Do not install or enable the scheduler until, in this order:

1. The production deployment containing `app/api/cron/arrival-emails`
   is live on `main` (i.e. this feature branch has been reviewed,
   merged, and deployed).
2. `CRON_SECRET` is configured as a **Vercel production** environment
   variable (not just a preview/development one).
3. The `tempa_arrival_email_cron_secret` Vault secret exists in the
   production Supabase project, holding the same value as (2).

Only then should `docs/sql/2026-10-02-arrival-email-scheduler.sql` be
run against production Supabase. Running it earlier is not
catastrophic — see that file's own Part 2, which only raises an
advisory `NOTICE` if the Vault secret is missing rather than blocking
— but every tick before all three steps are done is just a wasted,
safely-rejected 401.

None of this is gated on the arrival-email **sending kill switch**
(`arrival_email_system_config.sending_enabled`, see
[`docs/sql/2026-10-01-arrival-email-delivery.sql`](sql/2026-10-01-arrival-email-delivery.sql)),
which is a separate, independent switch and starts `false` regardless
of whether the scheduler is installed or running.
