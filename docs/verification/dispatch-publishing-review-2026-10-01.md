# Dispatch publishing review — 2026-10-01

Production returned SQLSTATE 23514 naming `dispatches_body_visible_length`.
The supplied live catalog confirms `dispatch_visible_length(body) <= 10000`;
the composer intentionally has no product-level body cap. Safety evaluation
succeeded, and the publishing transaction rolled back. The live functions
already insert `status='published'` and `published_at=now()` correctly.

The forward migration raises this obsolete ceiling to 200,000 member-visible
characters. Safety independently keeps its existing 200,000 encoded-request
ceiling. No content is rewritten and no authentication, Safety consumption,
RPC signatures, grants, Postcard checks, or visibility settings are changed.
There are no runtime application changes.

Validation: the PGlite harness reproduces the old failure on a formatted
10,001-character body, then accepts it after running the actual migration.
It also checks the 200,000 boundary, rejects 200,001 and blank bodies,
preserves an existing row, safely reruns the migration, and executes the
actual read-only verifier. This is an isolated PostgreSQL fixture, not a
production publish or an authenticated end-to-end test.

Production migration is pending execution by the project owner. Run
`docs/sql/2026-10-01-dispatch-body-ceiling.sql`, then the matching verifier;
expect `DISPATCH_BODY_CEILING_VERIFIED`. Retry the preserved draft after this.
