import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getWaitingLetterCount,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
  getFirstContact,
  isEffectivelyExpired,
} from '@/lib/letters'
import { getMyAnswers } from '@/lib/questions'
import { canWriteToMind } from '@/app/minds/[userId]/page'
import {
  getRelationshipCapacity,
  newCorrespondenceUnavailableMessage,
} from '@/lib/relationship-capacity'
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
  getDispatchPostcard,
  dispatchPostcardToBaseContent,
  isWithinDispatchEditWindow,
  canEditDispatch,
} from '@/lib/dispatches'
import { getDispatchReplies } from '@/lib/replies'
import { isDispatchWorthReading } from '@/lib/worth-reading'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import {
  sectionTitleClass,
  metadataTextClass,
  sectionLabelClass,
  helperTextClass,
  quietLinkClass,
  iconButtonClass,
} from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'
import { hasCompletedGuide } from '@/lib/guide'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import EditorialByline from '@/app/editorial-byline'
import ReportButton from '@/app/report-button'
import MomentHint from '../moment-hint'
import TopicChips from '../topic-chips'
import KeepButton from '../keep-button'
import ShareDispatchButton from '../share-dispatch-button'
import DispatchReader from './dispatch-reader'
import AuthorActionsMenu from './author-actions-menu'
import WebVisibilityControl from './web-visibility-control'
import { getDispatchWebState } from '@/lib/public-dispatches'
import RepliesSection from './replies-section'
import WorthReadingButton from './worth-reading-button'
import BoardShelfCard from '@/app/home/board-shelf-card'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import DispatchIdentityLabel, { SponsorCta } from '../dispatch-identity-label'
import { dispatchShareText } from '@/lib/dispatch-identity'
import { getDispatchWritingStyles } from '@/lib/writing-style-data'

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M5 3v18" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </svg>
  )
}

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h16" />
    </svg>
  )
}

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
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const dispatch = await getDispatchById(supabase, dispatchId)
  if (!dispatch) notFound()

  const trailContext = parseReadingTrailParams(resolvedSearchParams)
  const returnQuery = new URLSearchParams()
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === 'string') returnQuery.set(key, value)
    else if (Array.isArray(value)) value.forEach((entry) => returnQuery.append(key, entry))
  }
  const dispatchReturnHref = `/board/${dispatch.id}${returnQuery.size ? `?${returnQuery.toString()}` : ''}`
  const boardReturnHref = trailContext
    ? `/board?s=${encodeURIComponent(trailContext.sessionStartedAt)}&seed=${encodeURIComponent(trailContext.seed)}`
    : '/board'

  const isAuthor = dispatch.authorId === user.id
  const isMemberDispatch = dispatch.identity.kind === 'member'
  const officialEditHref =
    dispatch.publishedAs === 'tempa'
      ? `/admin/content/dispatches/${dispatch.id}/edit`
      : dispatch.publishedAs === 'sponsored'
        ? `/admin/content/sponsored/${dispatch.id}/edit`
        : undefined

  if (dispatch.moderationStatus === 'hidden') {
    const waitingCount = await getWaitingLetterCount(supabase, user.id)
    return (
      <AppShell active="board" waitingLetterCount={waitingCount}>
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4 text-center">
            <p className={sectionTitleClass}>{dispatch.title}</p>
            <p className={helperTextClass}>Hidden by TEMPA.</p>
            <Link href={boardReturnHref} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground">
              <BackArrowIcon />
              Back to The Board
            </Link>
          </div>
        </main>
      </AppShell>
    )
  }

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
    dispatchWritingStyles,
    outgoingFirstContact,
    incomingFirstContact,
    relationshipCapacity,
  ] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getDispatchMoments(supabase, dispatch.id),
    getDispatchViewState(supabase, user.id, dispatch.id),
    isAuthor || !isMemberDispatch ? Promise.resolve(false) : isKeepingMind(supabase, user.id, dispatch.authorId),
    isAuthor ? getActiveDispatchShare(supabase, dispatch.id) : Promise.resolve(null),
    isAuthor ? getDispatchMomentsForEditing(supabase, dispatch.id) : Promise.resolve([]),
    isAuthor && isMemberDispatch
      ? supabase.from('profiles').select('pinned_dispatch_id').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    getDispatchReplies(supabase, dispatch.id),
    isAuthor ? Promise.resolve(false) : isDispatchWorthReading(supabase, user.id, dispatch.id),
    trailContext ? getNextTrailItems(supabase, trailContext, dispatch.id) : Promise.resolve([]),
    getDispatchPostcard(supabase, dispatch.id),
    isAuthor || !isMemberDispatch ? Promise.resolve([]) : getMyAnswers(supabase, dispatch.authorId),
    isAuthor || !isMemberDispatch ? Promise.resolve(new Set<string>()) : getActiveCorrespondencePartnerIds(supabase, user.id),
    isAuthor || !isMemberDispatch ? Promise.resolve(new Set<string>()) : getContactedAnswerIds(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'dispatch_reading'),
    getDispatchWritingStyles(supabase, [dispatch.id]),
    isAuthor || !isMemberDispatch ? Promise.resolve(null) : getFirstContact(supabase, user.id, dispatch.authorId),
    isAuthor || !isMemberDispatch ? Promise.resolve(null) : getFirstContact(supabase, dispatch.authorId, user.id),
    isAuthor || !isMemberDispatch ? Promise.resolve(null) : getRelationshipCapacity(supabase),
  ])

  const webState = isAuthor ? await getDispatchWebState(supabase, dispatch.id) : null
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
  const dispatchEditable = canEditDispatch({
    isAuthor,
    withinEditWindow: isWithinDispatchEditWindow(dispatch.publishedAt),
    replyExists: replies.length > 0,
  })

  const authorPrimaryAnswer = authorAnswers.find((a) => a.isPrimary) ?? null
  const alreadyCorrespondingWithAuthor = isMemberDispatch && activePartnerIds.has(dispatch.authorId)
  const authorPrimaryAnswerAlreadyContacted = authorPrimaryAnswer
    ? contactedAnswerIds.has(authorPrimaryAnswer.id)
    : false
  const structurallyCanWriteToAuthor = isMemberDispatch && canWriteToMind({
    isSelf: isAuthor,
    alreadyCorresponding: alreadyCorrespondingWithAuthor,
    hasCurrentAnswer: authorPrimaryAnswer !== null,
    currentAnswerAlreadyContacted: authorPrimaryAnswerAlreadyContacted || outgoingFirstContact !== null,
  })
  const incomingIsLive = incomingFirstContact?.status === 'sent' && !isEffectivelyExpired(incomingFirstContact, false)
  const outgoingIsLive = outgoingFirstContact?.status === 'sent' && !isEffectivelyExpired(outgoingFirstContact, false)
  const pendingFirstContact = outgoingIsLive ? outgoingFirstContact : incomingIsLive ? incomingFirstContact : null
  const newCorrespondenceMessage = newCorrespondenceUnavailableMessage(relationshipCapacity)
  const showWriteToAuthor = structurallyCanWriteToAuthor && !pendingFirstContact && newCorrespondenceMessage === null

  const { body: cleanBody } = stripRichBodyMarker(dispatch.body)
  const paragraphCount = splitParagraphs(cleanBody).length
  const initialPosition = clampReadingPosition(viewState?.lastParagraphIndex ?? 0, paragraphCount)

  return (
    <AppShell active="board" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <Link href={boardReturnHref} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground">
            <BackArrowIcon />
            The Board
          </Link>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              {isMemberDispatch ? (
                <Link href={`/minds/${dispatch.authorId}`} className="flex min-w-0 items-center gap-3 hover:opacity-80">
                  <ProfileIdentityMark
                    identifier={dispatch.authorId}
                    markUrl={dispatch.authorMarkUrl ?? null}
                    label={dispatch.authorMarkUrl ? `${dispatch.authorPseudonym}'s Mark` : undefined}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[15px] font-medium text-foreground">{dispatch.authorPseudonym}</p>
                      {dispatch.authorCountry && <span className="truncate text-[13px] text-muted">· {dispatch.authorCountry}</span>}
                    </div>
                    <EditorialByline
                      title={dispatch.identity.kind === 'member' ? dispatch.identity.editorialTitle : null}
                      className="mb-0.5"
                    />
                    <p className={metadataTextClass}>{formatDateTimeFull(dispatch.publishedAt)}</p>
                  </div>
                </Link>
              ) : (
                <div className="min-w-0 space-y-1">
                  <DispatchIdentityLabel identity={dispatch.identity} size="md" />
                  <p className={metadataTextClass}>{formatDateTimeFull(dispatch.publishedAt)}</p>
                </div>
              )}

              <div className="flex shrink-0 items-start gap-1">
                <ShareDispatchButton
                  dispatchId={dispatch.id}
                  title={dispatch.title}
                  authorPseudonym={dispatch.authorPseudonym}
                  shareText={dispatchShareText(dispatch.title, dispatch.identity)}
                />
                {isAuthor ? (
                  <AuthorActionsMenu
                    dispatchId={dispatch.id}
                    initialShareToken={activeShare?.id ?? null}
                    initialIsPinned={isPinned}
                    momentImagePaths={editableMoments.map((m) => m.imagePath)}
                    editable={dispatchEditable}
                    allowPin={isMemberDispatch}
                    editHref={officialEditHref}
                  />
                ) : (
                  <>
                    {isMemberDispatch && (
                      <KeepButton
                        viewerId={user.id}
                        keptUserId={dispatch.authorId}
                        keptPseudonym={dispatch.authorPseudonym}
                        initiallyKept={kept}
                      />
                    )}
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
            {webState && <WebVisibilityControl dispatchId={dispatch.id} initial={webState} />}
            {moments.some((m) => m.imageUrl) && <MomentHint dispatchId={dispatch.id} />}

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
                writingStyleId={dispatchWritingStyles.get(dispatch.id) ?? null}
              />
            </div>

            {dispatch.identity.kind === 'sponsored' && dispatch.identity.sponsor.ctaUrl && (
              <div className="flex justify-end">
                <SponsorCta identity={dispatch.identity} />
              </div>
            )}

            {!isAuthor && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <WorthReadingButton dispatchId={dispatch.id} initiallyMarked={worthReading} />

                  <div className="min-w-0 text-right leading-snug">
                    {alreadyCorrespondingWithAuthor ? (
                      <Link href="/letters" className={quietLinkClass}>
                        Open your correspondence
                      </Link>
                    ) : pendingFirstContact ? (
                      <Link href={`/letters/${pendingFirstContact.id}`} className={quietLinkClass}>
                        View your letter with {dispatch.authorPseudonym}
                      </Link>
                    ) : showWriteToAuthor && authorPrimaryAnswer ? (
                      <Link
                        href={`/write/${dispatch.authorId}?a=${authorPrimaryAnswer.id}&d=${dispatch.id}&source=dispatch&returnTo=${encodeURIComponent(dispatchReturnHref)}`}
                        className={quietLinkClass}
                      >
                        Write from this
                      </Link>
                    ) : structurallyCanWriteToAuthor && newCorrespondenceMessage ? (
                      <span className={helperTextClass}>{newCorrespondenceMessage}</span>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-foreground/10" />
              </div>
            )}

            <RepliesSection dispatchId={dispatch.id} viewerId={user.id} initialReplies={replies} />

            {continueReadingCards.length > 0 && (
              <div className="border-t border-foreground/10 pt-4">
                <p className={sectionLabelClass}>Read next</p>
                <div className="no-scrollbar mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0">
                  {continueReadingCards.map(({ item, trailQuery }) => (
                    <div key={item.id} className="w-[85%] shrink-0 snap-start sm:w-auto sm:shrink">
                      <BoardShelfCard dispatch={item} trailQuery={trailQuery} size="continue" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-foreground/10 pt-4">
              <Link href={boardReturnHref} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground">
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
