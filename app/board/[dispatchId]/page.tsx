import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import {
  getDispatchById,
  getDispatchMoments,
  getDispatchMomentsForEditing,
  getDispatchViewState,
  clampReadingPosition,
  isKeepingMind,
  getActiveDispatchShare,
} from '@/lib/dispatches'
import { getDispatchReplies } from '@/lib/replies'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import { sectionTitleClass, metadataTextClass, helperTextClass } from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'
import { iconButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
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
}: {
  params: Promise<{ dispatchId: string }>
}) {
  const { dispatchId } = await params
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

  const [waitingCount, moments, viewState, kept, activeShare, editableMoments, pinnedRow, replies] = await Promise.all([
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
  ])

  const isPinned = isAuthor && pinnedRow.data?.pinned_dispatch_id === dispatch.id

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

            <div className="rounded-md bg-surface-shell p-4 sm:p-6">
              <DispatchReader
                viewerId={user.id}
                dispatchId={dispatch.id}
                body={dispatch.body}
                moments={moments}
                initialPosition={initialPosition}
              />
            </div>

            <RepliesSection dispatchId={dispatch.id} viewerId={user.id} initialReplies={replies} />

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
