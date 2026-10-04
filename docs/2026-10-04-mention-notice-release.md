# Mention notices and prompt email attempts

The Resend screenshot confirms a mention email was delivered. Previously a job waited two minutes and then for the next five-minute scheduler tick. This release removes the new-job delay and adds a same-origin, authenticated browser wake-up after successful publication. The route obtains the sender from the verified session, accepts no destination or email payload, and uses Next after() to attempt that sender's first-attempt jobs after returning 202. Existing publication RPCs, Safety checks, and results are unchanged.

The durable queue remains the authority. Immediate claims are service-only, sender-scoped, limited to ten jobs per wake-up and exclude retries or active claims. Larger bursts, closed tabs, network failures and failed attempts use the existing scheduler. This is prompt best-effort sending, not guaranteed instant inbox delivery. No historical skipped/sent event is replayed, no active sending switch is changed, and existing blocks, preferences, read suppression, budgets and frozen retry payloads remain enforced.

Home shows up to three pale-clay postal notices using the Mail on the way colour treatment. Each entire notice links to the exact event, uses live localized text and has room for mobile wrapping. History pagination remains separate. Arrivals has 32px separation after the notice section.

Future skipped jobs record the applicable reason at processing time. Old grouped reasons cannot be reconstructed reliably and are retained. Admin shows provider references and UTC outcome times. Provider acceptance is still not called inbox delivery.

Rollout: run docs/sql/2026-10-04-immediate-mention-emails.sql, then its -verify.sql companion. Expect IMMEDIATE_MENTION_EMAILS_READY with all true. Then merge and verify the production build. Sending stays in its prior enabled/disabled state. No Vercel settings or cron frequency changes are needed.

Validation: focused publication, composer, worker, endpoint, home-navigation tests; actual migrations executed in PGlite with queue safeguards, no duplicate leases, authenticated-user denial, sender scope, immediate due time, retry backoff, diagnostic and activation preservation checks. No real test emails sent. Existing local generated-page-export type errors remain outside this release.

Next: inspect the Room's complete page hierarchy and propose its layout and colour plan before implementing that redesign.
