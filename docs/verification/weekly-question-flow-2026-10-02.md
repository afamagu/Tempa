# Weekly question repair

Prepared from main e67e023; rebased onto the latest main before publication.

The editor already selects by question ID. Reusing an answered onboarding Question as the weekly Question brings along its old answers. Live row identity has NOT been inspected; this explains the code path but does not prove the provenance of Evening Quill's production answer. The supplied read-only preflight retrieves that evidence.

Home previously used oldest unread answers and excluded the viewer. It now keeps the latest three visible answers by creation time, including own/read answers. Fewer than three genuine eligible answers yields fewer cards. Edits do not move old answers to the top.

Home answer links open a full answer reader with a private reply action. Profile browsing retains its existing page. Missing/hidden selected answers cannot silently fall back to unrelated answers. Room answer dialogs offer private reply directly. Existing correspondents go to their composer; incoming first letters go to that letter. Own answers do not offer self-replies. Replying uses existing letters, not public comments.

Question editors retain question-specific drafts, use question ID as React identity, and return to the originating Home/Room surface. An existing answer to the exact new question remains editable rather than discarded.

The new admin action starts a fresh week atomically, creates a new question ID for a restart or previously answered question, and preserves every previous answer and the Flagship. It records publication history so the outgoing legacy Question remains in the library. Existing question suggestions and Read the Room layout are unchanged.

The SQL also permits visible published Room answers as first-letter origins in both the Safety context check and sender. It surgically updates the installed answer predicate, preserves the rest of the installed functions, and refuses unknown guard shapes. The original discovery eligibility path remains. New Room eligibility checks publication, moderation, author visibility, blocks and discovery hiding.

## Validation

- Targeted Vitest: 175 tests across 19 files passed before final rebase.
- TypeScript and ESLint on changed application files passed.
- PGlite executed the migration twice and tested fresh identities, unchanged answers/Flagship, archived visibility, stale restart rejection, admin/anonymous permissions, Room answer eligibility, blocked/hidden/unpublished denial, and preservation of an unrelated sender guard.
- PGlite letter functions model answer guards; this is NOT a production letter-send or live authenticated browser test.
- Build result recorded in the PR.

## Release sequence — not executed

1. Run `docs/sql/2026-10-02-fresh-weekly-question-preflight.sql` read-only; confirm the selected live question and installed functions.
2. Obtain explicit SQL approval, then apply `docs/sql/2026-10-02-fresh-weekly-question.sql` and run its `-verify.sql` counterpart.
3. Merge/deploy the application patch only after DB readiness. No production SQL, merge or deploy was performed during preparation.
4. In Admin → Content → Questions, inspect the current wording and click **Start a fresh week with this question** once. This preserves old answers and creates an empty new weekly question.
5. Verify as Evening Quill: blank editor for the fresh question; submit a new answer; Home displays it; full answer opens directly; another member can reply; old answers remain below under their original question.

The restart archives any answers already attached to the old ID, including any genuine submissions made during the mixed period. Inspect those records first; do not silently reassign or delete them. The new UI requires the migration and deliberately does not fall back to the old unsafe selection operation.
