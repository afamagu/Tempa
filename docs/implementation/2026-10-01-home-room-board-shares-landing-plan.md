# Tempa: next implementation plan

Status: Home, Board search, Letterbox and landing implemented in the first release batch; Room archive and share reporting follow. PR #64 merged at d0a048992f09c364a5b1c4479a5315137c5149fb; its production deployment succeeded. Owner supplied MEMBER_QUESTIONS_READY with all eleven checks true. No open PRs remained after merging. Future implementation starts from that remote main tree; this local planning branch has the identical product tree plus this document.

## 1. Correct Home question answers, Board search and Letterbox naming

Home question and answer shelves must refer to the same explicit question UUID. Current source passes that UUID to discover_people_v2, whose recorded SQL filters answers by it, so the reported unrelated answers require checking the actual deployed function and returned identifiers rather than assuming the intended SQL is live. Add a read-only live-definition/identity preflight if needed; never recover a failed question query by substituting generic answers.

Use a dedicated question-answer retrieval path for Home and question reading. People discovery currently excludes active correspondents and already-contacted answers; these are not appropriate exclusions for reading a question's responses. Preserve authenticated member visibility, blocking, moderation and deactivation. Carry question_id and answer_id explicitly through the result mapping and verify identity before rendering.

Home retains the current question, its credit and Answer/Read-edit control until an admin explicitly replaces it. A week boundary does not clear it automatically. No answers or no unread eligible answers: omit the answer shelf, its heading and both answer-browsing controls; proceed directly to From the Board. Never fill the space with First Question/older responses. If there is no selected current question, don't disguise generic people as a question shelf; discovery has its own destination.

With eligible unread answers: use heading See how others answered, show up to three cards in a desktop row and a comfortable mobile arrangement, then See more answers linking to that exact question. Prefer the earliest eligible unread answers, with stable time/id order; when read, later unread answers can fill the three places. Do not freeze the first three forever. Actual reading records read history; a preview does not. Even when the personal Home shelf is exhausted, the complete question remains accessible in the Room/archive.

Letterbox replaces Letters in the main desktop/mobile menu and corresponding destination heading. Keep /letters routes, badges, Pen Pals and Discover People; ordinary prose such as Your letters is not mechanically rewritten. Update relevant interface dictionaries and accessibility labels together.

Board search gets a visible Search button, Enter support and a clearly labelled Clear control. Search is explicit, not a full feed reload per keystroke. Clearing the final character or using Clear immediately restores the normal Board without another menu click. Retain the prior Board browsing session on clear/back where possible. Always keep Refresh the Board available; it clears the search and starts a fresh Board session. Synchronize the field with the URL after Back/Forward/refresh. Show loading, submitted-query context and clear no-results/error states, preserving the typed query on failure. Do not report an RPC failure as No Dispatches. Search title, topics and visible writing case-insensitively, with real pagination rather than a silently truncated 50-row list. Audit the remaining search controls for the same clear/submit/focus/loading conventions without forcing a single unsuitable interaction everywhere.

Acceptance: no new-question answers, one/two/three/four answers, unrelated older answers, already-corresponding authors, read/unread, filtered/blocked/hidden/deactivated answers, replacement races, direct/back routes; Board no-match -> backspace-empty recovery, visible button/Enter parity, clear/refresh, network error, URL history and phone keyboard; desktop/mobile Letterbox.

## 2. Apply approved public landing references

Resolved references:
- Tempa-Mobile-Landing-Mark-Spacing-Final-v2(3).pdf, file_0000000079148211993df79dea3da77f.
- Tempa-Desktop-Landing-Revised-Spaced-v2(2).pdf, file_00000000a66c8211ba64fa64a52a94e7.

Desktop parsed text includes Meet people through what they write. / Let what you say come first., name-first introduction, private-letter explanation, gradual disclosure, Enter Tempa, Read a Dispatch and Sign in. The mobile PDF is image-based; render and inspect it before implementation. Match each visual reference, including Mark spacing, hierarchy and editorial writing examples; inspect intermediate tablet widths rather than only the two endpoints. Resolve any duplicate/reference-overlay text visually before treating it as final copy.

Build real responsive HTML with selectable text, accessible contrast and correct reading order. Do not serve an entire 9 MB PDF/screenshot as the page. Reuse existing branding/assets when identical; optimize newly extracted artwork. Preserve the existing browser-local Mark generator and authentication behavior. Enter Tempa/Sign in must retain the intended auth flow; Read a Dispatch must reach a genuinely available public example. Verify long mobile text, focus order, reduced-motion behavior if animation exists, font loading and layout shift. Limit changes to the public landing and assets it needs.

## 3. Define the Room and question archive

Room is question-led. Order:
1. This week in the Room: current prompt, optional consented author Mark/name, Answer/Read-edit action.
2. See how others answered: six response cards in a horizontal row; More answers appears only when there are further responses and opens the exact question reader.
3. A separate Discover People section, outside the shaded question panel, with its own heading and explanatory sentence. It leads to the existing people directory rather than mixing unrelated answers into this question.
4. Earlier questions: bounded previews and Browse past questions; First Question appears as its own clearly labelled permanent entry.
5. Have a question for the Room? Suggest one, retaining the profile/admin flow from #64.

No answers: no empty response carousel or false See how others answered promise. A restrained Be the first to answer invitation may accompany the current prompt. Horizontal cards support native touch scrolling, snap, keyboard focus and desktop arrows; vertical page scrolling remains natural. No forced autoplay, cloned cards or six identical placeholders if fewer people answered.

The full question reader shows the prompt, its edition date and attribution, then answers to that question only. Six-card pages with clear More answers; URL-backed filters for country, language, age and gender, and consistent interest/looking-for filters where existing privacy-safe discovery matching can be reused. Include correspondents; no matchmaking exclusion. Preserve the exact selected question, filters, page/reading place and return destination through profile/letter navigation. Existing read history may mark responses as read; the full archive does not permanently hide them.

Historical reading must not imply that an inactive/old answer is an eligible first-contact Safety anchor. Retain existing active-answer eligibility and any separate contextual snapshot needed for a historical-question letter, or route through the current profile writing path with honest wording. Established correspondents retain Write Anytime. No fake answer UUIDs or weakened first-contact rules.

Archive: newest editions first; server-side search by question words/keywords, date/month/year range and source Tempa/member. Use dated editorial rows rather than loading all years of cards. Open one edition into its question-specific answers and filters. Stable URLs and cursor pagination keep the system practical after years. Only actually published Room editions and the permanent First Question belong here; unused admin drafts and private suggestions stay private.

Record actual publication dates and a prompt snapshot at Room selection/replacement. Question created_at is not necessarily the week it was asked. Reconstruct earlier dates only from reliable existing admin publication audit entries; label missing dates honestly. Preserve publication history when a question is reused in a later edition. Tempa-origin attribution is explicit; member attribution uses #64's consent and current visibility rules, so removed consent does not leave a cached public name/Mark in the archive. Don't invent topical categories or a historical date from uncertain data.

Acceptance: exact-question identity on every fetch, current/archived/First Question separation, six-card swipe and manual more, 1/6/7/large answer counts, full archive includes correspondents/read answers appropriately, filters/clear/no-match/errors, history pagination/date provenance, private suggestions excluded, consent withdrawal, correct profile/private-letter/back behavior.

## 4. Dispatch share reporting

Current dispatch_shares stores reusable external-link state, not one record per share. It cannot yield a reliable historical share total. Keep current URLs and revocation behavior intact.

Recommended report: You -> Archive -> Dispatches lists each author's Dispatch with sharing enabled/stopped, recorded share-action count and last recorded share time. Admin gets a separate authenticated aggregate view across member/official Dispatches with title, author, status, count, last share and period filters. Default to private author/admin reporting; don't add public popularity badges or expose who shared.

Metric definition: record a successful native share handoff or successful Copy link action, after browser success. A cancelled share sheet, failed clipboard action, token creation or opening a reader is not a share. This does not prove delivery to a recipient or subsequent reading; wording/help must state what is measured. Separate metrics if external views are added later. Where native sharing is unavailable/rejected, offer a usable Copy link fallback with an honest failure state.

Add a narrow authenticated record RPC with current Dispatch/share visibility checks, opaque unique event IDs, retry deduplication and rate limits. Private raw events/aggregates have RLS/grants and author/admin scopes. Preserve moderation, deactivation and block behavior; private letters never acquire share functionality. Counts begin from the new tracking date. Existing shared Dispatches show their current state, with earlier totals unavailable, rather than fabricated zero-to-date history. Stopping/re-enabling an external link does not reset recorded counts.

Acceptance: share succeeds/cancels/fails, clipboard success/failure, duplicate retry, rapid repeat/rate cap, revoked/hidden/deactivated link, current URL preservation, author scope/admin scope/anonymous denial, accurate count and reporting-start label.

## Release discipline

Implement in this order: Home + Board correctness + Letterbox; approved landing; Room and question archive; Dispatch share reporting. Keep each change reviewable and release it once its checks pass, so the urgent fixes are not held behind the archive work. If a database change is needed, provide complete migration and read-only verifier as runnable blocks, then wait for the owner's successful result before merging dependent code. Do not execute production SQL on the owner's behalf. Validate phone/desktop layout and actual routes, focused regression tests, SQL grants/behavior and a production build per batch. After each authorized merge, require deployment success. No private member messages, invitation email enabling or Vercel configuration changes are part of this plan.
