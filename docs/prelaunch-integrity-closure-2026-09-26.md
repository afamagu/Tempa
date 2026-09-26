# Pre-launch integrity + account lifecycle — closure notes (2026-09-26)

Production state and schema facts this phase established that are not
obvious from the migration files alone.

## Production SQL applied in this phase

| Migration | Verifier result |
|---|---|
| `docs/sql/2026-10-17-dispatch-reply-safety-whitespace-fix.sql` | `…-verify.sql`: one row, every column true, `overall_pass = true` |
| `docs/sql/2026-10-16-account-lifecycle.sql` | `…-verify.sql`: one row, every pass/fail check true, `overall_pass = true` |

`2026-10-16-account-lifecycle.sql` is the **only** account lifecycle
migration. The earlier `2026-10-16-account-deletion.sql` draft was never
executed and was removed from the branch before merge.

`2026-10-17-dispatch-reply-safety-whitespace-fix.sql` holds the live
`create_reply`: Safety consumes the exact submitted `p_body`; the trimmed
`v_body` is only validated and stored. Any future redefinition of
`create_reply` must start from this file, not from 2026-10-06.

## One open correspondence per pair — enforced by a live-created index

The original `correspondences_one_active_per_pair` (2026-08-31, unique on
`(participant_low, participant_high) where status = 'active'`) was
superseded when correspondences gained a `pending` state. The live
invariant is the stricter unique partial index:

```sql
create unique index correspondences_one_open_per_pair
  on public.correspondences (participant_low, participant_high)
  where status = any (array['pending'::text, 'active'::text]);
```

It was created directly in production during the September correspondence
lifecycle repair; **no migration file in this repository creates it**.
Evidence it exists: `2026-09-30-mark-identity-and-admin-member-workspace.sql`
refuses to run without exactly this index (prerequisite guard), and every
first letter's `send_first_letter` performs
`on conflict (participant_low, participant_high) where status = any (array['pending','active'])`,
which Postgres rejects (42P10) unless this index exists. Rebuilding a
database from `docs/sql/` alone must create it before 2026-09-30.

## Audit rows that are false positives

The read-only audit (`2026-09-26-prelaunch-production-schema-audit.sql`,
kept off `main`) replayed migrations textually and did not model renames:

- **2026-08-31-correspondences PARTIAL** — the missing
  `correspondences_one_active_per_pair` is intentionally superseded (above).
- **2026-09-06-open-letters PARTIAL** — `2026-09-07-dispatches-and-board.sql`
  renamed `open_letters` → `dispatches`, both indexes → `dispatches_*_idx`
  and both policies; `dispatches_select_published` was later redefined
  (2026-09-22) and `dispatches_insert_own` deliberately dropped
  (2026-10-06, Safety). Nothing should be recreated.
