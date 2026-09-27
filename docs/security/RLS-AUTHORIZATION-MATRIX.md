# Tempa — RLS & authorization matrix

Two sources, kept distinct:

1. **Verified live (production, read-only, anon + publishable key)** — 2026-09-27.
2. **Derived from migrations** — net effect of every `grant`/`revoke`/policy in `docs/sql` in order.
   Not proof of production state; confirm with
   [`sql/production-authorization-audit.sql`](sql/production-authorization-audit.sql).

## 1. Verified live — anonymous access

| Object | Result |
|---|---|
| profiles, letters, correspondences, questions, question_answers, moments, dispatches, dispatch_replies, blocked_users, reports, safety_evaluations, account_enforcement_state, staff_roles, admin_audit_log, commerce_products, commerce_wallets, commerce_ledger_entries, postcard_catalog, postcard_versions, profile_marks | `401 42501 permission denied` (no SELECT) |
| letter_postcards | `401 permission denied for view letters_for_participant` |
| rpc discover_people, admin_commerce_overview, commerce_my_credit_balance, is_pseudonym_available, resolve_arrival_email_context | `401 permission denied for function …` |
| Public schema introspection (external report) | rejected |

## 2. Derived from migrations — client write privileges (net)

| Table | authenticated may | Policy constraining it |
|---|---|---|
| correspondence_feature_acknowledgements | INSERT | own row |
| correspondence_hidden_for_user | INSERT, DELETE | own row |
| dispatch_views | INSERT, UPDATE | own row (`dispatch_views_own`) |
| guide_completions | INSERT | own row |
| member_introduction_history | INSERT, UPDATE | own row |
| member_introduction_state | INSERT | own row |
| open_letters (legacy) | INSERT | own row |
| reading_places | INSERT, UPDATE | own row |
| **profiles** | **not determinable from migrations** — table created outside `docs/sql`; migrations only revoke TRUNCATE/TRIGGER/REFERENCES from authenticated | INSERT constrained by triggers (id = auth.uid(), adult eligibility, stage forced to `mark`); UPDATE/DELETE policy **to verify (F-04)** |
| questions | not determinable from migrations | to verify |
| every other table | none (revoked; writes only through SECURITY DEFINER RPCs) | — |

All 23 commerce tables: RLS on, no client writes, anon no read (verified by the 10-20…10-23 production verifiers).

## 3. Derived from migrations — policies with `USING (true)`

| Table | Command | Assessment |
|---|---|---|
| interests, interest_topic_aliases | SELECT | public taxonomy — intended |
| postcard_catalog, postcard_versions | SELECT to authenticated | catalogue metadata — intended (anon denied live) |

No `WITH CHECK (true)` write policy exists in the migrations.

## 4. Functions

- 77 `admin_*` functions: all staff-gated in the database (static).
- Member RPCs: identity from `auth.uid()` (static; see ATTACK-SURFACE-MAP.md).
- Service-only: `check_rate_limit` revoked from authenticated (SQL). `record_safety_evaluation`,
  arrival-email functions revoked only `from public`; anon denied live; **authenticated to verify (F-05)**.
- Anon-callable by design: `get_shared_dispatch`, `dispatch_photo_is_externally_shared`.

## 5. Storage

See SECURITY-ARCHITECTURE.md §5 (policies from migrations; bucket flags to confirm with audit query H).

## 6. Still to verify in production (run the audit SQL, blocks A–J)

1. Block C / I — whether members can UPDATE or DELETE `profiles` (and which columns).
2. Block E — whether `authenticated` can EXECUTE `record_safety_evaluation`,
   `resolve_arrival_email_context`, `record_or_fetch_arrival_email_snapshot`,
   `complete_arrival_email_job`, `compute_deliver_at`.
3. Block A — any table with RLS disabled or unexpected client privileges (tables created outside `docs/sql`).
4. Block F — any SECURITY DEFINER function without a pinned `search_path`.
5. Block G — views not `security_barrier`/`security_invoker` that expose rows to clients.
6. Block J — default privileges that auto-grant new objects to anon/authenticated.
