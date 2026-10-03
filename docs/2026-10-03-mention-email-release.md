# Mention email release

Depends on PR77 / PUBLIC_MENTIONS_READY. No letter content, answer body, Dispatch excerpt or attachment is copied into these emails.

## Flow

An explicitly selected public mention creates the existing in-app notification. If sending is enabled and the recipient permits email, an insert trigger queues that new event with a two-minute grace period. The existing arrival-email scheduler also runs the mention worker. With the documented five-minute schedule, an eligible email is normally attempted on the first tick after the grace period; it is not promised at exactly two minutes.

The worker checks unread state, content visibility, retained mention text, account status, blocks, confirmed email and recipient preference during preparation and again immediately before provider submission. The email identifies the public sender and writing type, and links to /mentions/event-id. Sign-in preserves that destination; recipient-only lookup then opens the exact writing. Official posts show the publication identity instead of the administrator's personal pseudonym.

Preferences in You > Notifications: Everyone (default), correspondents only, or off. Opting out does not remove in-app mentions. The email footer links to these settings; signed-out visitors return there after signing in.

## Frequency and retry rules

- One new email per recipient per 15 minutes, at most ten per day, and at most two per day from non-correspondents. Additional notifications remain in-app; this is suppression, not a later digest or backlog.
- Five attempts maximum. Claim leases last 15 minutes; stale completions cannot change a newer claim.
- Freeze the exact request and idempotency key before calling the provider. Retry that exact request, including after deployment.
- Stop uncertain delivery for manual review before the provider's 24-hour idempotency window expires (23-hour internal cutoff).
- Discard successful or definitively rejected request snapshots. Provider IDs remain for operational follow-up.
- Admin status says provider acceptance, never claims inbox delivery. Raw recipient addresses and frozen email payloads are not returned by the admin status RPC.

## Rollout

1. Run docs/sql/2026-10-03-mention-emails.sql. It installs the queue, controls and trigger with sending disabled, and does not backfill older mentions.
2. Run docs/sql/2026-10-03-mention-emails-verify.sql. Expect MENTION_EMAILS_READY with every check true.
3. Merge the frontend/worker release after verification and successful preview.
4. Open Admin > System > Email. Confirm that Last worker check updates on a scheduler run. If it does not, check the existing scheduler, sender and site-origin configuration; do not assume emails are running.
5. Enable future mention emails using the separate mention-email control. No change to Vercel configuration or letter-arrival settings is required. Pausing and resuming does not replay mentions predating the latest activation.

No real-member test email was sent during development. An actual provider-accepted event after activation is still required to confirm the operational path.

## Validation

Focused worker/preferences/cron/admin route tests and a PGlite SQL harness cover permissions, self-scoped preferences, disabled/no-backfill behaviour, delay, frozen retries, stale claims, opt-out, read/block/removal/deactivation suppression, burst limits, provider identifiers and expired delivery. The harness uses local fixtures and never touches production. Existing generated-page export type errors are outside this change; deployed build status is checked separately.
