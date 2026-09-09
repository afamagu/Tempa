-- Tempa — Mail Call / Delayed Delivery: ATOMIC DEPLOYMENT VERIFICATION.
-- Companion to 2026-09-04-mail-call-atomic-deployment.sql. Run these
-- AFTER that deployment has been executed, not as part of it — nothing
-- here belongs inside that transaction.
--
-- NOT read-only: several scenarios call the writer RPCs and mutate real
-- rows (real letters, real correspondences) via the established auth-
-- impersonation pattern from earlier this session
-- (set_config('request.jwt.claims', ...) + set local role authenticated).
-- I cannot run any of this myself in this environment — no service-role
-- key or database CLI — every placeholder needs a real id substituted
-- in from your own data.
--
-- Consolidated from the writer-integration and enforcement migrations'
-- own verification sections, de-duplicated and reordered into one
-- coherent sequence — later scenarios reuse ids captured by earlier
-- ones rather than re-deriving them, and no scenario asserts a bare row
-- count or "zero rows" against a broad sender/recipient pair that could
-- legitimately have prior history (that class of bug was found and
-- fixed in both source files' verification sections; see their own
-- change notes for exactly what was wrong and why).
--
-- Do not weaken or disable immutability to make any scenario pass —
-- where a fixture needs a backdated timestamp (scenario 14 below), it
-- is created via a direct INSERT with that value as the row's initial
-- state, never via an UPDATE, since enforce_letter_immutability only
-- fires on UPDATE.

-- 0. Find real candidate profiles — grouped by country_code/continent
--    so you can pick concrete A/B pairs for the geography-dependent
--    scenarios below (same-region, same-country, same-continent,
--    different-continent all produce different effective deliver_at
--    ranges — see the compute_deliver_at migration for the exact
--    windows).
select id, country, region, country_code from public.profiles order by country_code nulls last;

-- ------------------------------------------------------------
-- Auth impersonation pattern.
-- ------------------------------------------------------------
-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1. New first contact: deliver_at > created_at, and
--    expires_at - deliver_at = exactly 72 hours. Captures the new
--    letter's id directly from the RPC's return value for reuse below.
-- select id as a_to_b_letter_id, created_at, deliver_at, expires_at,
--   deliver_at > created_at as deliver_after_created,
--   (expires_at - deliver_at) = interval '72 hours' as expiry_exactly_72h_after_delivery
-- from send_first_letter('<B-uuid>', '<some-current-answer-id-of-B>', 'A to B, in transit');

-- 2. Sender sees own in-transit letter via the view immediately —
--    still impersonating A.
-- select id, deliver_at from public.letters_for_participant
-- where id = '<a_to_b_letter_id captured in scenario 1>';
-- Expect: one row.

-- 3. Recipient cannot see it via the view before delivery. Scoped by
--    the exact letter id — NOT by sender_id/recipient_id, which would
--    wrongly return non-empty if A and B have any prior delivered
--    correspondence.
-- select set_config('request.jwt.claims', json_build_object('sub','<B-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select * from public.letters_for_participant where id = '<a_to_b_letter_id captured in scenario 1>';
-- Expect: zero rows.

-- 4. Recipient cannot find it via search before delivery. Search by a
--    distinctive marker unique to this test letter's body, not by A's
--    pseudonym — A's person-card may legitimately still appear in
--    search if this pair has independent prior established
--    correspondence, which is not a failure.
-- select send_first_letter('<B-uuid>', '<answer-of-B>', 'zzz-mailcall-test-marker zzz, undelivered');
-- (as B) select * from search_letterbox('zzz-mailcall-test-marker');
-- Expect: no letter-kind row with this excerpt/marker.

-- 5. Recipient cannot mark it opened, reply to it, or close it before
--    delivery, even knowing the exact id (still as B).
-- select mark_letter_opened('<a_to_b_letter_id captured in scenario 1>');
-- select id, opened_at from public.letters where id = '<a_to_b_letter_id captured in scenario 1>';
-- Expect: opened_at still null — the UPDATE silently affected zero rows.
-- select reply_to_letter('<a_to_b_letter_id captured in scenario 1>', 'replying before I could have read it');
-- Expect: exception "Letter not found, not addressed to you, or no longer awaiting a reply."
-- select close_letter('<a_to_b_letter_id captured in scenario 1>', 'I can''t take on another correspondence right now.');
-- Expect: exception "Letter not found, not addressed to you, or no longer awaiting a decision."

-- 6. Recipient cannot obtain a photo via can_view_letter_photo before
--    delivery (requires a letter with a Photo Moment and enabled
--    consent in an established correspondence, sent via write_letter
--    with p_moments, checked before that new letter's own deliver_at).
-- select can_view_letter_photo('<image-path-of-an-undelivered-letters-photo>');
-- Expect: false.

-- 7. Once deliver_at passes, full visibility returns across every
--    surface. Use a same-region pair for the shortest realistic wait
--    (~2h45m-3h15m), or backdate a FRESH insert's deliver_at using the
--    same privileged-INSERT technique as scenario 14 below — never via
--    UPDATE, which immutability blocks.
-- select * from public.letters_for_participant where id = '<now-delivered-letter-id>';
-- Expect: one row, fully visible to the recipient.
-- select is_unread from public.letters_for_participant where id = '<now-delivered-letter-id>';
-- Expect: true (until opened).
-- select mark_letter_opened('<now-delivered-letter-id>');
-- select opened_at from public.letters where id = '<now-delivered-letter-id>';
-- Expect: now populated.
-- select * from search_letterbox('<sender-pseudonym-substring>');
-- Expect: now finds it.

-- 8. Same-direction clamp: second ordinary letter's deliver_at is at
--    least 1 minute after the first's. Requires an ESTABLISHED
--    correspondence between A and B (reply once as B, then send two
--    ordinary letters A->B back to back via write_letter).
-- select id as first_ordinary_id, deliver_at as first_deliver_at from write_letter('<correspondence-id>', 'first ordinary letter');
-- select id as second_ordinary_id, deliver_at as second_deliver_at from write_letter('<correspondence-id>', 'second ordinary letter, sent moments later');
-- Expect: second_deliver_at >= first_deliver_at + interval '1 minute'.

-- 9. Crossed letters remain independent. Use a pair with no prior
--    first-contact history, or capture correspondence_id directly from
--    the RPC return values as shown — a bare re-derivation query would
--    error if this pair has ever re-contacted across a prior closed-
--    then-reopened correspondence (send_first_letter's S5 case).
-- select id as a_to_b_id, correspondence_id as fixture_correspondence_id
--   from send_first_letter('<B-uuid>', '<answer-of-B>', 'A to B');  -- (as A)
-- select id as b_to_a_id
--   from send_first_letter('<A-uuid>', '<answer-of-A>', 'B to A');  -- (as B)
-- select sender_id, recipient_id, deliver_at, correspondence_id
-- from public.letters
-- where correspondence_id = '<fixture_correspondence_id captured above>'
-- order by created_at;
-- Expect: two rows, opposite directions, independently-computed deliver_at values.

-- 10. Reverse-direction first contacts share exactly one correspondence
--     row — direct database proof. Scoped to the specific correspondence
--     from scenario 9, not to all history ever exchanged between A/B.
-- select count(distinct correspondence_id) as distinct_correspondences
-- from public.letters
-- where reply_to_id is null
--   and correspondence_id = '<fixture_correspondence_id captured in scenario 9>';
-- Expect: 1.

-- 11. Duplicate same-sender first contact still rejected.
-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select send_first_letter('<B-uuid>', '<answer-of-B>', 'trying again');
-- Expect: exception "You have already sent a first-contact letter to this recipient." (errcode 23505).

-- 12. Established correspondence rejects send_first_letter, with a
--     message distinct from scenario 11's (after B has replied to A,
--     establishing the correspondence).
-- select send_first_letter('<B-uuid>', '<answer-of-B>', 'should be rejected');
-- Expect: exception "This correspondence is already established. Use write_letter instead."
-- (SQLSTATE P0001, the plpgsql default — deliberately not 23505).

-- 13. Closing one root does not close the correspondence while the
--     other root remains live. Using the crossed pair from scenario 9
--     (neither yet replied/established).
-- (as B, declining A's letter)
-- select close_letter('<a_to_b_id captured in scenario 9>', 'I can''t take on another correspondence right now.');
-- select status, established_at from public.correspondences where id = '<fixture_correspondence_id>';
-- Expect: status = 'active' still, because B's own letter to A is still a live root.
-- select status from public.letters where id = '<b_to_a_id captured in scenario 9>';
-- Expect: 'sent', untouched by A's-side closure.

-- 14. Established correspondence cannot be closed by expiry of an old
--     root — the crossed-root-after-establishment scenario in full,
--     plus confirms the surviving root obeys the ordinary visibility
--     rule with no special-casing. Fixture created via a direct INSERT
--     (never an UPDATE — enforce_letter_immutability only fires on
--     UPDATE, so an already-past expires_at set as a row's initial
--     value is untouched by it). Run as a privileged role in the SQL
--     editor (bypasses RLS/grants by design — this is seeding initial
--     state, not mutating an existing row).
--
--     PRECONDITION: this INSERT will itself violate
--     correspondences_one_active_per_pair if the chosen pair already
--     has an active correspondence (e.g., reusing A/B from earlier
--     scenarios without cleanup). Use genuinely fresh disposable
--     profiles X, Y here.
-- insert into public.correspondences (participant_low, participant_high, status, established_at)
-- values (least('<X-uuid>','<Y-uuid>'), greatest('<X-uuid>','<Y-uuid>'), 'active', now())
-- returning id;
-- -- capture as <fixture_correspondence_id>
--
-- insert into public.letters (sender_id, recipient_id, correspondence_id, body, deliver_at, expires_at, status)
-- values ('<Y-uuid>', '<X-uuid>', '<fixture_correspondence_id>',
--         'fixture: surviving crossed root, already past its own expiry',
--         now() - interval '2 hours', now() - interval '1 hour', 'sent')
-- returning id;
-- -- capture as <surviving_root_id>
--
-- select expire_stale_first_contacts();
--
-- select status, established_at from public.correspondences where id = '<fixture_correspondence_id>';
-- Expect: status = 'active' (untouched — established_at is not null, so the guard prevents
-- closure even though a root just expired).
--
-- select status, closed_by from public.letters where id = '<surviving_root_id>';
-- Expect: status = 'closed', closed_by = 'system' — the LETTER itself still correctly expires;
-- only the CORRESPONDENCE-level closure is suppressed.
--
-- select set_config('request.jwt.claims', json_build_object('sub','<X-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select * from public.letters_for_participant where correspondence_id = '<fixture_correspondence_id>';
-- Expect: exactly the rows X is entitled to under the ordinary sender/delivered rule — no
-- special treatment because the correspondence happens to be established.
--
-- -- Cleanup (cascades to the fixture letters via correspondence_id's ON DELETE CASCADE):
-- delete from public.correspondences where id = '<fixture_correspondence_id>';

-- 15. Immutability — confirm deliver_at is frozen post-creation.
-- update public.letters set deliver_at = now() where id = '<any-letter-id>';
-- Expect: exception "Letters are immutable except for their lifecycle status fields."

-- 16. Metadata/grant confirmation — every SECURITY DEFINER function
--     touched by this deployment carries the hardened search_path, and
--     none of their privilege surfaces silently regressed.
select proname, prosecdef, proconfig
from pg_proc
where proname in (
  'search_letterbox', 'can_view_letter_photo', 'mark_letter_opened',
  'reply_to_letter', 'close_letter', 'send_first_letter', 'write_letter',
  'expire_stale_first_contacts'
);
-- Expect: prosecdef = true for all eight, proconfig containing
-- search_path=pg_catalog for all eight.

select exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'letters'
    and grantee = 'authenticated' and privilege_type = 'SELECT'
) as authenticated_has_direct_letters_select;
-- Expect: false — letters_select_participant's hardening granted nothing new.
