import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getWaitingLetterCount,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
} from '@/lib/letters'
import { getMyAnswers } from '@/lib/questions'
import { canWriteToMind } from '@/app/minds/[userId]/page'
import {
  getDispatchById,
  getDispatchMoments,
  getDispatchMomentsForEditing,
  getDispatchViewState,
  clampReadingPosition,
  isKeepingMind,
  getActiveDispatchShare,
  parseReadingTrailParams,
  getNextTrailItems,
  readingTrailSearchParams,
  getFirstMomentThumbnails,
  getDispatchPostcard,
  dispatchPostcardToBaseContent,
  isWithinDispatchEditWindow,
  canEditDispatch,
} from '@/lib/dispatches'
import { getDispatchReplies } from '@/lib/replies'
import { isDispatchWorthReading } from '@/lib/worth-reading'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import { sectionTitleClass, metadataTextClass, sectionLabelClass, helperTextClass, quietLinkClass } from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'
import { iconButtonClass } from '@/app/profile/ui'
import { hasCompletedGuide } from '@/lib/guide'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import Mindform from '@/app/mindform'
import CountryFlag from '@/app/country-flag'
import ReportButton from '@/app/report-button'
import MomentHint from '../moment-hint'
import TopicChips from '../topic-chips'
import KeepButton from '../keep-button'
import ShareDispatchButton from '../share-dispatch-button'
import DispatchReader from './dispatch-reader'
import AuthorActionsMenu from './author-actions-menu'
import RepliesSection from './replies-section'
import WorthReadingButton from './worth-reading-button'
import BoardShelfCard from '@/app/home/board-shelf-card'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'

function FlagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 3v18" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </svg>
  )
}

function BackArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h16" />
    </svg>
  )
}

/**
 * The Dispatch reader — the writing is the hero. NO horizontal swipe,
 * NO next-on-swipe, NO automatic next Dispatch, NO "Up next": Close/
 * back is the only way out, and opening another Dispatch always
 * requires a separate, deliberate tap from the Board or a profile.
 * getDispatchById relies entirely on RLS to decide visibility — a
 * missing id and a genuinely private/unpublished one are
 * indistinguishable here by design, both rendering notFound().
 */
export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ dispatchId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { dispatchId } = await params
  const resolvedSearchParams = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const dispatch = await getDispatchById(supabase, dispatchId)

  if (!dispatch) {
    notFound()
  }

  const isAuthor = dispatch.authorId === user.id

  // Admin Command Center Phase 2A-1 — a hidden Dispatch's row only ever
  // reaches this point for its own author (dispatches_select_published's
  // RLS already returns null — notFound() above — for anyone else).
  // The author gets a calm, restrained notice here instead of the
  // normal reading view — never the reporter/moderator identity or the
  // internal moderation reason, matching Decision 2 exactly.
  if (dispatch.moderationStatus === 'hidden') {
    const waitingCount = await getWaitingLetterCount(supabase, user.id)
    return (
      <AppShell active="board" waitingLetterCount={waitingCount}>
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4 text-center">
            <p className={sectionTitleClass}>{dispatch.title}</p>
            <p className={helperTextClass}>Hidden by TEMPA.</p>
            <Link
              href="/board"
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
            >
              <BackArrowIcon />
              Back to The Board
            </Link>
          </div>
        </main>
      </AppShell>
    )
  }

  // Reading Trail (Home Phase 1) — only ever present when THIS exact
  // link was generated from an already-ranked board_feed_page result
  // (a Home section card, the ambient strip, or a normal /board feed
  // card); a bare direct/shared URL or a search-result card carries
  // none of these params, so trailContext is null and no trail is
  // manufactured — see lib/dispatches.ts's own "READING TRAIL" section.
  const trailContext = parseReadingTrailParams(resolvedSearchParams)

  const [
    waitingCount,
    moments,
    viewState,
    kept,
    activeShare,
    editableMoments,
    pinnedRow,
    replies,
    worthReading,
    nextTrailItems,
    postcard,
    authorAnswers,
    activePartnerIds,
    contactedAnswerIds,
    readingIntroSeen,
  ] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getDispatchMoments(supabase, dispatch.id),
    getDispatchViewState(supabase, user.id, dispatch.id),
    isAuthor ? Promise.resolve(false) : isKeepingMind(supabase, user.id, dispatch.authorId),
    // Only the author can SELECT dispatch_shares at all (RLS); a
    // non-author's Share button simply starts from "not yet known" and
    // still works correctly via share_dispatch's own get-or-create.
    isAuthor ? getActiveDispatchShare(supabase, dispatch.id) : Promise.resolve(null),
    // Needed only so Delete can clean up this Dispatch's own storage
    // objects afterward — see author-actions-menu.tsx.
    isAuthor ? getDispatchMomentsForEditing(supabase, dispatch.id) : Promise.resolve([]),
    isAuthor
      ? supabase.from('profiles').select('pinned_dispatch_id').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    getDispatchReplies(supabase, dispatch.id),
    // Board Phase 2C — Worth Reading is a private per-viewer mark, and
    // (like Keep in Mind) a member cannot mark their own Dispatch, so
    // the author's own view never needs this lookup at all.
    isAuthor ? Promise.resolve(false) : isDispatchWorthReading(supabase, user.id, dispatch.id),
    // Home Phase 1B — up to CONTINUE_READING_COUNT subsequent rows in
    // the SAME session/ordering, never just one.
    trailContext ? getNextTrailItems(supabase, trailContext, dispatch.id) : Promise.resolve([]),
    // Dispatch Postcards Checkpoint 2 — at most one, resolved once here;
    // null renders nothing (see LetterheadPostcard's own conditional
    // rendering below).
    getDispatchPostcard(supabase, dispatch.id),
    // Dispatch → Correspondence Entry Point checkpoint — the EXACT same
    // three data sources app/minds/[userId]/page.tsx already reads to
    // decide "Write to this mind" vs "Open your correspondence" vs
    // nothing, applied to the Dispatch's own author instead of an
    // arbitrary profile id. No new eligibility logic, no new RPC/table —
    // this is a pure reuse of the existing correspondence contract (see
    // canWriteToMind below). The author's own view never needs any of
    // this — "write to yourself" is nonsensical and always suppressed.
    isAuthor ? Promise.resolve([]) : getMyAnswers(supabase, dispatch.authorId),
    isAuthor ? Promise.resolve(new Set<string>()) : getActiveCorrespondencePartnerIds(supabase, user.id),
    isAuthor ? Promise.resolve(new Set<string>()) : getContactedAnswerIds(supabase, user.id),
    // Post-onboarding corrections checkpoint (Q2) — the first-read
    // Dispatch introduction, same account-persisted guide_completions
    // gate every other FeatureIntroduction in this codebase uses. This
    // is the AUTHENTICATED reader only (app/board/[dispatchId]/page.tsx);
    // the anonymous/public shared-Dispatch reader (/d/[shareToken]) is a
    // wholly separate page that never imports this component at all, so
    // it structurally can't show here.
    hasCompletedGuide(supabase, user.id, 'dispatch_reading'),
  ])

  // Same batched first-Moment lookup every other Dispatch listing
  // surface already uses — safe to call with an empty array (Home
  // Phase 1's own getFirstMomentThumbnails already short-circuits then).
  const nextTrailThumbnails = await getFirstMomentThumbnails(
    supabase,
    nextTrailItems.map((item) => item.id)
  )

  // Each card's OWN trailQuery carries the SAME session plus ITS OWN
  // cursor (BoardShelfCard builds the actual href from dispatch.id +
  // this query string), so a reader who picks the 2nd/3rd/4th
  // suggestion — not just the first — still starts the trail correctly
  // from THAT item onward.
  const continueReadingCards = trailContext
    ? nextTrailItems.map((item) => ({
        item,
        trailQuery: readingTrailSearchParams(
          { sessionStartedAt: trailContext.sessionStartedAt, seed: trailContext.seed },
          item
        ).toString(),
      }))
    : []

  const isPinned = isAuthor && pinnedRow.data?.pinned_dispatch_id === dispatch.id

  // Smoke-test contract completion checkpoint (Section G) — a UI HINT
  // only, deciding whether the Edit Dispatch affordance is even offered
  // ("the product should not tease an unavailable action"). The real
  // authority is update_dispatch itself, re-checked fresh on every
  // save. `replies` above is read under the viewer's OWN RLS-governed
  // session, which can undercount a Reply that's currently moderator-
  // hidden and authored by someone other than this Dispatch's author
  // (see canEditDispatch's own doc comment in lib/dispatches.ts) — an
  // accepted imprecision for a hint, never a safety gap, since the RPC
  // itself checks unconditional row existence regardless of this value.
  const dispatchEditable = canEditDispatch({
    isAuthor,
    withinEditWindow: isWithinDispatchEditWindow(dispatch.publishedAt),
    replyExists: replies.length > 0,
  })

  // Dispatch → Correspondence Entry Point checkpoint — identical
  // derivation to app/minds/[userId]/page.tsx's own primaryAnswer/
  // alreadyCorresponding/showWriteToMind (the SAME exported pure
  // predicate, the SAME two ids-based checks), just keyed on the
  // Dispatch's author instead of whichever profile page a viewer opened.
  // When isAuthor, authorAnswers/activePartnerIds/contactedAnswerIds are
  // all empty by construction (see the Promise.all above), so this
  // always resolves to showWriteToMind=false, alreadyCorresponding=false
  // — never a self-correspondence affordance.
  const authorPrimaryAnswer = authorAnswers.find((a) => a.isPrimary) ?? null
  const alreadyCorrespondingWithAuthor = activePartnerIds.has(dispatch.authorId)
  const authorPrimaryAnswerAlreadyContacted = authorPrimaryAnswer
    ? contactedAnswerIds.has(authorPrimaryAnswer.id)
    : false
  const showWriteToAuthor = canWriteToMind({
    isSelf: isAuthor,
    alreadyCorresponding: alreadyCorrespondingWithAuthor,
    hasCurrentAnswer: authorPrimaryAnswer !== null,
    currentAnswerAlreadyContacted: authorPrimaryAnswerAlreadyContacted,
  })

  const { body: cleanBody } = stripRichBodyMarker(dispatch.body)
  const paragraphCount = splitParagraphs(cleanBody).length
  const initialPosition = clampReadingPosition(viewState?.lastParagraphIndex ?? 0, paragraphCount)

  return (
    <AppShell active="board" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <Link
            href="/board"
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            <BackArrowIcon />
            The Board
          </Link>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/minds/${dispatch.authorId}`}
                className="flex min-w-0 items-center gap-3 hover:opacity-80"
              >
                <Mindform identifier={dispatch.authorId} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[15px] font-medium text-foreground">{dispatch.authorPseudonym}</p>
                    <CountryFlag country={dispatch.authorCountry} />
                  </div>
                  <p className={metadataTextClass}>{formatDateTimeFull(dispatch.publishedAt)}</p>
                </div>
              </Link>
              <div className="flex shrink-0 items-start gap-1">
                <ShareDispatchButton
                  dispatchId={dispatch.id}
                  title={dispatch.title}
                  authorPseudonym={dispatch.authorPseudonym}
                />
                {isAuthor ? (
                  <AuthorActionsMenu
                    dispatchId={dispatch.id}
                    initialShareToken={activeShare?.id ?? null}
                    initialIsPinned={isPinned}
                    momentImagePaths={editableMoments.map((m) => m.imagePath)}
                    editable={dispatchEditable}
                  />
                ) : (
                  <>
                    <KeepButton
                      viewerId={user.id}
                      keptUserId={dispatch.authorId}
                      keptPseudonym={dispatch.authorPseudonym}
                      initiallyKept={kept}
                    />
                    <div className="relative">
                      <ReportButton
                        targetType="dispatch"
                        targetId={dispatch.id}
                        triggerClassName={iconButtonClass}
                        triggerLabel={<FlagIcon />}
                        triggerAriaLabel="Report this Dispatch"
                        panelClassName="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-foreground/10 bg-background p-3 shadow-md"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <h1 className={sectionTitleClass}>{dispatch.title}</h1>

            {dispatch.topics.length > 0 && <TopicChips topics={dispatch.topics} />}

            {moments.some((m) => m.imageUrl) && <MomentHint dispatchId={dispatch.id} />}

            {/* Dispatch Postcards Checkpoint 2 — reuses LetterheadPostcard
                verbatim (closed thumbnail, tap to open the real front/
                back/Living-Reveal PostcardObject overlay), positioned
                with the Dispatch's own header/body content, above the
                reader. No attached Postcard renders nothing here. */}
            {postcard && (
              <div className="flex justify-end">
                <LetterheadPostcard
                  base={dispatchPostcardToBaseContent(postcard.version)}
                  revealLine={postcard.revealLine}
                  backMessage={postcard.backMessage}
                  senderPseudonym={postcard.senderPseudonymSnapshot}
                />
              </div>
            )}

            {/* Post-onboarding corrections checkpoint (Q2) — shown once,
                immediately before the reading surface itself, the first
                time this member opens a Dispatch to read (never on the
                Board, and never stacked with the Board introduction,
                which is a separate page). Explains the overall reading
                grammar; MomentHint below stays separate contextual
                microcopy specifically about Moments — the two are
                deliberately not merged. Replayable later from You →
                Tempa Guide. */}
            {!readingIntroSeen && (
              <FeatureIntroduction guideKey="dispatch_reading" title="Reading a Dispatch" ctaLabel="Start reading">
                <p>
                  Take your time. A Dispatch may have little Moments tucked into the writing —
                  glimpses from the writer&rsquo;s world that you can open as you go. At the end,
                  you can mark it Worth Reading, reply publicly, or write privately if
                  you&rsquo;d like to know the writer.
                </p>
              </FeatureIntroduction>
            )}

            <div className="rounded-md bg-surface-shell p-4 sm:p-6">
              <DispatchReader
                viewerId={user.id}
                dispatchId={dispatch.id}
                body={dispatch.body}
                moments={moments}
                initialPosition={initialPosition}
              />
            </div>

            {/* Dispatch/author actions row (Small Dispatch Reader Layout
                Correction) — Worth Reading and the correspondence entry
                point are siblings of the SAME row, not stacked with the
                latter reading like a Replies affordance. Worth Reading
                stays at its existing left position; "Write to this
                mind"/"Open your correspondence" moves to the row's right
                edge. flex-wrap lets the link drop to its own line on
                narrow screens rather than squeezing against the Worth
                Reading control. The divider that used to sit directly
                above the correspondence link now sits below the whole
                row, so Replies only ever begins after BOTH actions have
                been presented as a single "Dispatch/author actions"
                concept — see this page's own test for the exact DOM
                relationship this establishes. */}
            {!isAuthor && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <WorthReadingButton dispatchId={dispatch.id} initiallyMarked={worthReading} />

                  {/* Dispatch → Correspondence Entry Point checkpoint — a
                      quiet, editorial invitation into the EXISTING private
                      correspondence flow, never a social engagement bar. Same
                      three-state contract as app/minds/[userId]/page.tsx
                      (write / already-corresponding / nothing), reusing its
                      exact destinations — no new writing flow, no relationship
                      label ("Correspondent" etc.) ever shown. quietLinkClass
                      (a restrained underlined text link, not a button) keeps
                      this visually subordinate to the Dispatch itself, and
                      deliberately NOT sticky/floating — an ordinary in-flow
                      element, safe on mobile alongside AppShell's bottom nav. */}
                  {(showWriteToAuthor || alreadyCorrespondingWithAuthor) &&
                    (showWriteToAuthor && authorPrimaryAnswer ? (
                      <Link href={`/write/${dispatch.authorId}?a=${authorPrimaryAnswer.id}`} className={quietLinkClass}>
                        Write to this mind
                      </Link>
                    ) : (
                      <Link href="/letters" className={quietLinkClass}>
                        Open your correspondence
                      </Link>
                    ))}
                </div>

                <div className="border-t border-foreground/10" />
              </div>
            )}

            <RepliesSection dispatchId={dispatch.id} viewerId={user.id} initialReplies={replies} />

            {/* Reading Trail (Home Phase 1B, desktop card quality
                revisited in Phase 1C) — a compact "next reads" shelf,
                restrained editorial navigation rather than a single
                title-only link: up to CONTINUE_READING_COUNT subsequent
                rows from the SAME deterministic session/ordering, using
                the SAME BoardShelfCard language/thumbnail machinery
                Home already uses (identity, country, title, excerpt,
                first-Moment thumbnail — no counts, no Worth Reading
                metric, no popularity label). Renders ONLY when this
                exact page load carried valid trail params AND
                board_feed_page actually has at least one next row for
                that cursor — a direct/shared URL, a search result, or
                simply reaching the end of the ordering all render
                nothing here. Mobile: native horizontal overflow +
                scroll-snap, one card substantially visible, no library,
                no dots, no auto-advance — unchanged from Phase 1B.
                Desktop: Phase 1C widens this from a cramped 3-per-row
                rail to 2 comfortably-sized cards (BoardShelfCard's own
                'continue' size — see board-shelf-card.tsx), so a full
                pseudonym, a 2-line title, and real editorial excerpt
                copy all have room to breathe instead of truncating
                hard. A single remaining item renders gracefully with no
                fake carousel affordance — the row simply doesn't
                overflow. */}
            {continueReadingCards.length > 0 && (
              <div className="border-t border-foreground/10 pt-4">
                <p className={sectionLabelClass}>Read next</p>
                <div className="no-scrollbar mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0">
                  {continueReadingCards.map(({ item, trailQuery }) => (
                    <div key={item.id} className="w-[85%] shrink-0 snap-start sm:w-auto sm:shrink">
                      <BoardShelfCard
                        dispatch={item}
                        thumbnailUrl={nextTrailThumbnails.get(item.id)}
                        trailQuery={trailQuery}
                        size="continue"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom-of-letter return nav (pre-beta UX polish batch 1) —
                the same destination as the top back link, so a reader who
                reaches the end of a very long Dispatch never has to
                scroll back up to return to the Board. Deliberately an
                ordinary in-flow link, not sticky/floating. */}
            <div className="border-t border-foreground/10 pt-4">
              <Link
                href="/board"
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
              >
                <BackArrowIcon />
                Back to The Board
              </Link>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
