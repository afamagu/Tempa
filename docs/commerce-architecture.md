# Tempa commerce architecture

Governing rule: **monetize preservation and expression, never access to
people.** Credits, purchases and payment state are never read by People
discovery, introductions, Board ranking, Mail Call or any correspondence
gate.

## Checkpoint 0 — current state (main `8b3a726`)

| Area | Today | Commerce plan |
|---|---|---|
| Postcards | `postcard_catalog` (text `key`, title, one `country_code`, `is_active`) + frozen `postcard_versions`; sends snapshot a version into `letter_postcards` / `dispatch_postcards`. All free. | Keep. A `commerce_products` row (type `postcard`) wraps each catalogue key. Existing Postcards backfilled **Complimentary**. |
| Send gate | `write_letter`, `reply_to_letter`, `publish_dispatch`, `publish/update_official_dispatch` each check `postcard_catalog.is_active` (Safety-wired RPCs). | Do **not** rewrite them. Premium ownership is enforced by a BEFORE INSERT trigger on `letter_postcards` / `dispatch_postcards` (Checkpoint 2). |
| Picker | `app/letters/[letterId]/postcard-picker.tsx`, flat searchable list of active Postcards. Already refuses to treat received Keepsakes as sendable. | Redesign into the marketplace (Checkpoint 3) without changing sending. |
| Keepsakes | `get_my_postcards` (received archive) under You → Keepsakes. | Keep; Gifts join it as a separate kind. |
| Admin | `/admin/content/postcards` (add, bulk import, versioning); `admin-ui` design system. | Extend with Admin → Commerce (Checkpoint 4) in the same visual language. |
| RBAC / audit | `staff_roles` (moderator/admin), `is_staff()`; `admin_audit_log` (actor `ON DELETE SET NULL`, action, target, reason, jsonb metadata). | Reuse both. Financial admin actions require `admin`. |
| Lifecycle | 2026-10-16/18/19: pause/closure; auth user retained on closure, `profiles` deleted. | Commerce references `auth.users` with no cascade, never `profiles`. |
| Email | `lib/email` (Resend REST, idempotency keys). | Reuse for receipts (Checkpoint 6). |
| Payments / commerce / analytics | None. | Built in this phase. |
| People discovery | `discover_people` — per-viewer `hashtext` shuffle (2026-10-13); introductions — priority tiers + hash (2026-10-14). No activity/capacity signals. | Checkpoint 9, isolated from commerce. |
| PR #6 | Adds `postcard_versions.story_text` + ~35 story Postcards on an older base. | Source material only; import onto the new catalogue later. |

## Locked decisions implemented

- **USD base, integer money.** All Credits and fiat amounts are `bigint`
  (fiat in ISO 4217 minor units). Local prices are explicit, effective-dated
  price books; every price row and order stores `usd_reference_minor`.
- **Ledger is the authority.** `commerce_ledger_entries` is append-only
  (UPDATE/DELETE/TRUNCATE rejected for every role). `commerce_wallets.balance`
  is a cache moved only by `tempa_private.commerce_append_ledger` (row lock,
  idempotency key, `balance_after`). No edit-balance primitive exists.
- **Negative balance** is possible only through a refund/chargeback reversal;
  it blocks further spending, never writing to people.
- **Sale vs send.** `postcard_catalog.is_active` stays the sendability switch;
  the product lifecycle controls sale/listing. Deactivating a product from sale
  never touches sent/received history or an owner's entitlement.
- **Gift = relationship object.** A gift instance needs an existing
  correspondence, is invisible to its recipient until delivered, survives the
  sender's closure, and can never target oneself.
- **Account closure.** Financial records and gifts survive closure (retention);
  Credits/entitlements become unusable because every spend RPC refuses closed
  accounts (Checkpoint 2). Legal review is required on unused-Credit treatment.

## Bundle / duplicate policy (implemented in Checkpoint 2)

- Buying a durable product already owned is refused before any debit.
- A bundle is charged its bundle price minus the current Credit price of the
  items the member already owns (never below 0); if every item is owned the
  purchase is refused. The purchase snapshots every item, marks the owned ones,
  and grants only the missing ones — atomically, idempotently.

## Checkpoints

0 audit · 1 core database · 2 server services + premium send trigger ·
3 marketplace · 4 Admin → Commerce · 5 Flutterwave test mode ·
6 refunds/chargebacks/receipts · 7 Gifts + personalization contract ·
8 merchandising + commerce recommendations · 9 People discovery quality ·
10 lifecycle/legal/launch gate. Each database change ships as a forward-only
migration plus a read-only verifier, proven on the production-faithful PGlite
fixture before any production SQL gate.
