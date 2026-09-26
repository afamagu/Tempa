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

## Locked decisions implemented (Checkpoint 1, revised)

- **USD base, integer money.** All Credits and fiat amounts are `bigint`
  (fiat in ISO 4217 minor units). Local prices are explicit, effective-dated
  price books; every price row and order stores `usd_reference_minor`.
- **Deterministic prices.** Exclusion constraints (btree_gist) forbid two
  *published* rows with overlapping effective windows for: one product's
  Credit price; one product/currency/market in the price book; one bundle's
  versions. Each price-book row names exactly one `market` (ISO 3166-1 alpha-2,
  or `*` as the explicit fallback; resolution is exact market, then `*`).
  Once a price row or bundle version leaves `draft` it is frozen: only closing
  its window (`effective_to`, never reopened) or retiring it is allowed. A price
  change is "close the old window, publish a new row from that instant".
  Credit prices apply only to Postcards, Gifts and Keepsake templates; fiat price
  books only to Credit packs (and future physical products).
- **Snapshots.** An order is accepted only if it equals its published price-book
  row (product, market, currency, amount, USD reference, Credits); its financial
  snapshot never changes afterwards. A Credit purchase must charge exactly its
  published Credit-price row; a purchase is frozen apart from the one-way
  `completed → refunded` link to its refund ledger entry.
- **Version integrity.** `commerce_product_versions` content is immutable (only
  `is_current` flips); an edit is a new version. Versions referenced by Gifts
  cannot be deleted. A product's type and underlying Postcard never change.
- **Provider-neutral payments.** Orders, attempts and events reference
  `commerce_payment_providers(code)`. Flutterwave is seeded with checkout and
  live mode **disabled**; another provider is a registry row, not a migration.
- **Ledger is the authority.** `commerce_ledger_entries` is append-only
  (UPDATE/DELETE/TRUNCATE rejected for every role). `commerce_wallets.balance`
  is a cache moved only by `tempa_private.commerce_append_ledger` (wallet row
  lock, `balance_after`). An idempotency key replays the original entry only
  when member, amount, entry type, source type **and** source id all match;
  anything else is refused.
- **Accounting vocabulary** (sign and source enforced by constraints):

  | Entry type | Sign | Source | Meaning |
  |---|---|---|---|
  | `credit_purchase` | + | order | Credits bought with fiat |
  | `purchase_refund_removal` | − | payment adjustment | purchased Credits removed after a fiat refund |
  | `chargeback_removal` | − | payment adjustment | purchased Credits removed after a chargeback |
  | `chargeback_restoration` | + | payment adjustment | Credits restored when a chargeback is won/reversed |
  | `product_spend` / `bundle_spend` / `gift_spend` | − | purchase | Credits spent |
  | `product_credit_refund` | + | purchase (reason + actor) | Credits returned for a legitimate digital-product refund |
  | `promotional_grant` / `complimentary_grant` | + | admin (reason + actor) | granted Credits |
  | `admin_adjustment` | ± | admin (reason + actor) | correction of last resort, never a substitute for the above |
  | `opening_balance` | + | migration | one-off import |

- **Negative balance** is possible only through `purchase_refund_removal` or
  `chargeback_removal`; it blocks further spending, never writing to people.
- **Sale vs send.** `postcard_catalog.is_active` stays the sendability switch;
  the product lifecycle controls sale/listing. Existing active Postcards were
  backfilled as *published Complimentary* so sending is unchanged. A Postcard
  added later (via Admin) gets a **draft** Complimentary product — even when the
  catalogue row is active; commercial publication is always an explicit admin
  action (Checkpoint 4).
- **Gift = relationship object.** A gift instance needs an existing
  correspondence, is invisible to its recipient until delivered, survives the
  sender's closure, and can never target oneself.
- **Account closure (owner decision).** Financial records and gifts are
  retained; Credits and entitlements become unusable because every spend RPC
  refuses closed accounts (Checkpoint 2). Member-facing wording about unused
  Credits is a **legal-review item** before launch.
- **Country names.** ISO codes such as `MA` are internal identifiers only. The
  backfilled Place terms are created as `draft` with the code as a temporary
  label, so no member sees them; human country names are required before any
  member-facing marketplace launch.

## Bundle policy (owner decision; enforced from Checkpoint 2)

Rejected: "bundle price minus today's individual prices" — it changes whenever
an item is repriced.

Adopted: **versioned bundles with fixed per-item allocations.**

- A bundle is sold through `commerce_bundle_versions` (one published version
  per moment, frozen once published). Each `commerce_bundle_version_items` row
  carries a fixed `allocation_credits`.
- Bundle price = sum of the version's allocations.
- Completion price for a member who already owns some items = sum of the
  allocations of the items they do **not** own. It is defined entirely by the
  version, so repricing an individual item never changes it.
- Buying a durable product already owned is refused before any debit; a bundle
  where every item is owned is refused.
- The purchase records `bundle_version_id`, the final completion price
  (`credits_charged`) and one `commerce_purchase_items` row per item with its
  allocation snapshot and `already_owned`. Owned items are never re-granted.
  Grant, debit and snapshot happen atomically and idempotently (Checkpoint 2).

## Checkpoints

0 audit · 1 core database · 2 server services + premium send trigger ·
3 marketplace · 4 Admin → Commerce · 5 Flutterwave test mode ·
6 refunds/chargebacks/receipts · 7 Gifts + personalization contract ·
8 merchandising + commerce recommendations · 9 People discovery quality ·
10 lifecycle/legal/launch gate. Each database change ships as a forward-only
migration plus a read-only verifier, proven on the production-faithful PGlite
fixture before any production SQL gate.
