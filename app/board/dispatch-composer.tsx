'use client'

import { usePublicMentions } from '@/app/use-public-mentions'
import CorrespondentPicker from '@/app/correspondent-picker'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { TextSelection } from '@tiptap/pm/state'
import { createClient } from '@/lib/supabase/client'
import {
  sectionLabelClass,
  helperTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/app/profile/ui'
import { baseWritingExtensions, nativeWritingAttributes } from '@/app/letters/writing-extensions'
import { useEditorVisualViewport } from '@/app/letters/use-editor-visual-viewport'
import WritingToolbar from '@/app/letters/writing-toolbar'
import {
  docToPlainBody,
  docToMomentDrafts,
  docToDraftMomentDescriptors,
  resolveDraftPreviewMoments,
  dispatchBodyToDoc,
  canSendLetter,
  letterDocHasContent,
  stripRichBodyMarker,
  EMPTY_LETTER_DOC,
  type LetterDocJSON,
} from '@/lib/letter-editor-doc'
import { resolveDispatchPhotoUrl } from '@/lib/draft-photo-url'
import {
  readDispatchDraft,
  writeDispatchDraft,
  clearDispatchDraft,
  readDispatchPostcardDraft,
  writeDispatchPostcardDraft,
  clearDispatchPostcardDraft,
} from '@/lib/letter-editor-draft'
import {
  dispatchTitleError,
  normalizeTopics,
  publishDispatch,
  updateDispatch,
  publishOfficialDispatch,
  updateOfficialDispatch,
  dispatchPostcardToBaseContent,
  type OfficialPublishedAs,
  type SponsorFields,
  type DispatchMoment,
  type DispatchMomentDraft,
  type DispatchPostcard,
  type PublishDispatchError,
} from '@/lib/dispatches'
import { processImageForUpload } from '@/lib/image-processing'
import { getMyAccountStatus, accountBlockedMessage, type AccountStatus } from '@/lib/account-status'
import { getActivePostcards, type PostcardCatalogEntry } from '@/lib/postcards'
import {
  evaluateSafety,
  SAFETY_CANNOT_SEND_MESSAGE,
  SAFETY_CHECK_FAILED_MESSAGE,
  SAFETY_FINANCIAL_REQUEST_COPY_KEY,
} from '@/lib/safety/send-with-safety'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import { resolveDispatchIdentity, safeSponsorUrl, TEMPA_IDENTITY_NAME } from '@/lib/dispatch-identity'
import SafetyBlockedDialog from '@/app/safety-blocked-dialog'
import FeatureIntroduction from '@/app/feature-introduction'
import type { LetterPostcardDraft } from '@/lib/moments'
import { DispatchPhotoMoment } from './dispatch-photo-moment-node'
import { MomentAffordance } from '@/app/letters/[letterId]/moment-affordance-extension'
import PhotoSourceInputs, { selectPhotoSourceRef } from '@/app/letters/[letterId]/photo-source-inputs'
import MomentSourceMenu from '@/app/letters/[letterId]/moment-source-menu'
import PostcardPicker from '@/app/letters/[letterId]/postcard-picker'
import PostcardComposerSlot from '@/app/letters/[letterId]/postcard-composer-slot'
import PostcardEditor from '@/app/letters/[letterId]/postcard-editor'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import TopicInput from './topic-input'
import DispatchPreview from './dispatch-preview'
import { WEB_PUBLIC_COPY, webVisibilityRefusal } from '@/lib/public-dispatches'

const TITLE_MAX_CHARS = 140

function formatDevErrorDetail(error: PublishDispatchError): string {
  if (!error) return ''
  const parts = [`${error.code ?? '?'}: ${error.message}`]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(`hint: ${error.hint}`)
  return `\n(${parts.join(' — ')})`
}

function approximateVisibleBodyLength(body: string): number {
  const { body: withoutMarker } = stripRichBodyMarker(body)
  return withoutMarker.replace(/\*\*/g, '').replace(/_/g, '').length
}

export type ExistingDispatchForEditing = {
  id: string
  title: string
  body: string
  topics: string[]
  moments: { position: number; imagePath: string; previewUrl: string | null }[]
  postcard: DispatchPostcard | null
  webPublic?: boolean | null
}

export default function DispatchComposer({
  authorId,
  authorPseudonym = '',
  authorMarkUrl = null,
  mode = 'create',
  existingDispatch,
  showComposerIntro = false,
  showPostcardIntro = false,
  publication,
  webChoiceAvailable = false,
  writingStyleId = null,
}: {
  publication?: { publishedAs: OfficialPublishedAs; initialSponsor?: SponsorFields | null }
  authorId: string
  authorPseudonym?: string
  authorMarkUrl?: string | null
  mode?: 'create' | 'edit'
  existingDispatch?: ExistingDispatchForEditing
  showComposerIntro?: boolean
  showPostcardIntro?: boolean
  webChoiceAvailable?: boolean
  /** Writing Style — the author's CURRENT style, for Preview only (the
   * database snapshots the real value at Publish). Ignored for
   * official/sponsored Dispatches, which speak in Tempa's own voice. */
  writingStyleId?: string | null
}) {
  const isEdit = mode === 'edit' && Boolean(existingDispatch)
  const official = publication ?? null
  const isSponsored = official?.publishedAs === 'sponsored'
  const draftKey = official ? `${authorId}:${official.publishedAs}` : authorId
  const mentions = usePublicMentions(`dispatch:${draftKey}:${existingDispatch?.id ?? "new"}`)
  const [sponsor, setSponsor] = useState<SponsorFields>(
    official?.initialSponsor ?? { sponsorName: '', ctaLabel: '', ctaUrl: '' }
  )
  const router = useRouter()
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTargetRef = useRef<number | null>(null)
  const composerRootRef = useRef<HTMLElement | null>(null)
  useEditorVisualViewport(composerRootRef)

  const [title, setTitle] = useState(existingDispatch?.title ?? '')
  const [topics, setTopics] = useState<string[]>(existingDispatch?.topics ?? [])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New Dispatches are public on the web by default. Editing always
  // preserves the existing Dispatch's actual state. The choice remains
  // explicit and reversible before and after publication.
  const initialWebPublic = isEdit ? existingDispatch?.webPublic ?? null : true
  const showWebChoice = webChoiceAvailable && initialWebPublic !== null
  const [webPublic, setWebPublic] = useState<boolean>(initialWebPublic === true)

  const [pendingWarning, setPendingWarning] = useState<{ evaluationId: string; copyKey?: string } | null>(null)
  const [financialBlocked, setFinancialBlocked] = useState(false)
  const [myStatus, setMyStatus] = useState<AccountStatus>('active')

  useEffect(() => {
    let cancelled = false
    getMyAccountStatus(createClient()).then((status) => {
      if (!cancelled) setMyStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [openPicker, setOpenPicker] = useState<{ index: number; anchorRect: DOMRect } | null>(null)
  const [previewMoments, setPreviewMoments] = useState<DispatchMoment[] | null>(null)
  const [preparingPreview, setPreparingPreview] = useState(false)
  const [postcardDraft, setPostcardDraft] = useState<LetterPostcardDraft | null>(null)
  const [postcardPickerOpen, setPostcardPickerOpen] = useState(false)
  const [postcardEditorOpen, setPostcardEditorOpen] = useState(false)
  const [activePostcards, setActivePostcards] = useState<PostcardCatalogEntry[]>([])
  const [postcardIntroActive, setPostcardIntroActive] = useState(false)

  function handleAddPostcard() {
    if (showPostcardIntro) setPostcardIntroActive(true)
    else setPostcardPickerOpen(true)
  }

  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    getActivePostcards(createClient()).then((postcards) => {
      if (!cancelled) setActivePostcards(postcards)
    })
    return () => {
      cancelled = true
    }
  }, [isEdit])

  useEffect(() => {
    if (isEdit) return
    const restored = readDispatchPostcardDraft(draftKey)
    queueMicrotask(() => setPostcardDraft(restored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, draftKey])

  function setPostcardDraftAndPersist(next: LetterPostcardDraft | null) {
    setPostcardDraft(next)
    writeDispatchPostcardDraft(draftKey, next)
  }

  function choosePostcard(postcardKey: string) {
    setPostcardDraftAndPersist({
      postcardKey,
      revealLine: postcardDraft?.revealLine ?? '',
      backMessage: postcardDraft?.backMessage ?? '',
    })
    setPostcardPickerOpen(false)
    setPostcardEditorOpen(true)
  }

  function removePostcard() {
    setPostcardDraftAndPersist(null)
    setPostcardEditorOpen(false)
  }

  const postcardCatalogEntry = postcardDraft
    ? (activePostcards.find((p) => p.key === postcardDraft.postcardKey) ?? null)
    : null

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      ...baseWritingExtensions(),
      Placeholder.configure({ placeholder: 'Begin writing…' }),
      DispatchPhotoMoment,
      MomentAffordance.configure({
        enabled: true,
        allowMultiplePhotos: true,
        allParagraphs: true,
        onRequestPhoto: (index, anchorRect) => setOpenPicker({ index, anchorRect }),
      }),
    ],
    content: isEdit && existingDispatch ? dispatchBodyToDoc(existingDispatch.body, existingDispatch.moments) : EMPTY_LETTER_DOC,
    editorProps: {
      attributes: {
        ...nativeWritingAttributes,
        class:
          'min-h-64 w-full rounded-md border border-foreground/15 bg-surface-shell px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-4',
      },
    },
    onUpdate({ editor: current }) {
      if (isEdit) return
      writeDispatchDraft(draftKey, { title, doc: current.getJSON() as LetterDocJSON, topics })
    },
  })

  useEffect(() => {
    if (!editor || isEdit) return
    const draft = readDispatchDraft(draftKey)
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(draft.title)
      setTopics(draft.topics)
      editor.commands.setContent(draft.doc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, draftKey])

  function persistDraft(nextTitle: string, nextTopics: string[]) {
    if (!editor || isEdit) return
    writeDispatchDraft(draftKey, { title: nextTitle, doc: editor.getJSON() as LetterDocJSON, topics: nextTopics })
  }

  function handleTitleChange(value: string) {
    setTitle(value)
    persistDraft(value, topics)
  }

  function handleTopicsChange(next: string[]) {
    const normalized = normalizeTopics(next)
    setTopics(normalized)
    persistDraft(title, normalized)
  }

  const docJSON = (editor?.getJSON() as LetterDocJSON | undefined) ?? EMPTY_LETTER_DOC
  const titleError = dispatchTitleError(title)
  const canSubmit =
    Boolean(editor) &&
    titleError === null &&
    canSendLetter(docJSON, { aboveMax: false, submitting: publishing }) &&
    !uploadingIndex
  const canPreview =
    Boolean(editor) &&
    titleError === null &&
    canSendLetter(docJSON, { aboveMax: false, submitting: publishing || preparingPreview }) &&
    !uploadingIndex
  const previewBlockedReason: string | null =
    isEdit || publishing || preparingPreview
      ? null
      : titleError
        ? titleError
        : !letterDocHasContent(docJSON)
          ? 'Write something before you can preview.'
          : null

  const sponsorError: string | null = !isSponsored
    ? null
    : sponsor.sponsorName.trim().length === 0
      ? 'Add the sponsor’s name.'
      : sponsor.sponsorName.trim().length > 80
        ? 'Sponsor name is too long.'
        : sponsor.ctaUrl.trim().length > 0 && !safeSponsorUrl(sponsor.ctaUrl)
          ? 'The link must be a full https:// address.'
          : sponsor.ctaLabel.trim().length > 0 && sponsor.ctaUrl.trim().length === 0
            ? 'Add a link for this label, or clear the label.'
            : sponsor.ctaLabel.trim().length > 40
              ? 'Link label is too long.'
              : null

  const publishBlockedReason: string | null = !isEdit ? sponsorError : null

  const publicIdentity = resolveDispatchIdentity({
    publishedAs: official?.publishedAs ?? 'member',
    authorId,
    authorPseudonym,
    authorCountry: null,
    authorMarkUrl,
    sponsorName: sponsor.sponsorName,
    sponsorCtaLabel: sponsor.ctaLabel,
    sponsorCtaUrl: sponsor.ctaUrl,
  })
  const postcardSenderName = official
    ? official.publishedAs === 'tempa'
      ? TEMPA_IDENTITY_NAME
      : sponsor.sponsorName.trim() || 'Sponsor'
    : authorPseudonym

  function insertPhotoMomentAtParagraphEnd(paragraphIndex: number, attrs: { imagePath: string; previewUrl: string }) {
    if (!editor) return
    const { state } = editor
    const { doc, schema } = state
    let currentIndex = 0
    let targetPos: number | null = null
    doc.forEach((node, offset) => {
      if (node.type.name !== 'paragraph') return
      if (currentIndex === paragraphIndex) targetPos = offset + node.nodeSize - 1
      currentIndex += 1
    })
    if (targetPos === null) return
    const momentNode = schema.nodes.photoMoment.create(attrs)
    const tr = state.tr.insert(targetPos, momentNode)
    const mappedSelectionPos = tr.mapping.map(state.selection.from)
    tr.setSelection(TextSelection.near(tr.doc.resolve(mappedSelectionPos)))
    editor.view.dispatch(tr)
    editor.view.focus()
  }

  function chooseSource(useCamera: boolean) {
    if (openPicker === null) return
    pendingTargetRef.current = openPicker.index
    setOpenPicker(null)
    selectPhotoSourceRef(useCamera, libraryInputRef, cameraInputRef).current?.click()
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const index = pendingTargetRef.current
    e.target.value = ''
    pendingTargetRef.current = null
    if (!file || index === null || !editor) return
    setUploadingIndex(index)
    setError(null)
    try {
      const blob = await processImageForUpload(file)
      const path = `${authorId}/${crypto.randomUUID()}.jpg`
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('dispatch-photos')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError
      insertPhotoMomentAtParagraphEnd(index, { imagePath: path, previewUrl: URL.createObjectURL(blob) })
    } catch {
      setError('Could not add that photo. Please try again.')
    } finally {
      setUploadingIndex(null)
    }
  }

  async function handleSubmit() {
    const canPublish = isEdit ? canSubmit && !sponsorError : canPreview && !publishBlockedReason
    if (!editor || !canPublish) return
    setPublishing(true)
    setError(null)
    if (official) {
      await performSubmit(null, false)
      return
    }

    const finalDoc = editor.getJSON() as LetterDocJSON
    const body = docToPlainBody(finalDoc)
    const normalizedTopics = normalizeTopics(topics)
    const outcome =
      isEdit && existingDispatch
        ? await evaluateSafety({ surface: 'dispatch_update', dispatchId: existingDispatch.id, title, topics: normalizedTopics, body })
        : await evaluateSafety({
            surface: 'dispatch_publish',
            title,
            topics: normalizedTopics,
            body,
            postcard: postcardDraft
              ? {
                  postcardKey: postcardDraft.postcardKey,
                  revealLine: postcardDraft.revealLine.trim().length > 0 ? postcardDraft.revealLine : null,
                  backMessage: postcardDraft.backMessage,
                }
              : null,
          })

    if (outcome.status === 'error') {
      setError(SAFETY_CHECK_FAILED_MESSAGE)
      setPublishing(false)
      return
    }
    if (outcome.status === 'cannot_send') {
      if (outcome.copyKey === SAFETY_FINANCIAL_REQUEST_COPY_KEY) setFinancialBlocked(true)
      else setError(SAFETY_CANNOT_SEND_MESSAGE)
      setPublishing(false)
      return
    }
    if (outcome.status === 'warning_required') {
      setPendingWarning({ evaluationId: outcome.evaluationId, copyKey: outcome.copyKey })
      setPublishing(false)
      return
    }
    await performSubmit(outcome.evaluationId, false)
  }

  function handleCancelWarning() {
    setPendingWarning(null)
  }

  async function handleAcknowledgeWarning() {
    if (!pendingWarning) return
    await performSubmit(pendingWarning.evaluationId, true)
  }

  async function performSubmit(safetyEvaluationId: string | null, warningAcknowledged: boolean) {
    if (!editor) return
    setPublishing(true)
    setError(null)
    const finalDoc = editor.getJSON() as LetterDocJSON
    const body = docToPlainBody(finalDoc)
    const moments: DispatchMomentDraft[] = docToMomentDrafts(finalDoc)
      .filter((m) => m.type === 'photo')
      .map((m) => ({ position: m.position, imagePath: m.imagePath }))

    const actionTag = isEdit ? '[board] edit attempt' : '[board] publish attempt'
    if (process.env.NODE_ENV === 'development') {
      console.debug(actionTag, {
        titleLength: title.length,
        approximateVisibleBodyLength: approximateVisibleBodyLength(body),
        topicCount: topics.length,
        normalizedTopics: normalizeTopics(topics),
        momentCount: moments.length,
        moments: moments.map((m) => ({
          type: 'photo',
          position: m.position,
          imagePathBelongsToAuthor: m.imagePath.startsWith(`${authorId}/`),
        })),
      })
    }

    const genericErrorMessage = isEdit
      ? 'Could not save your changes. Please try again.'
      : 'Could not publish your Dispatch. Please try again.'

    try {
      const requestedWeb = showWebChoice ? webPublic : undefined
      const { data, error: submitError } = official
        ? isEdit && existingDispatch
          ? await updateOfficialDispatch(createClient(), existingDispatch.id, {
              publishedAs: official.publishedAs,
              title,
              body,
              topics,
              mentions: mentions.retained(body),
              moments,
              sponsor,
              webPublic: requestedWeb,
            })
          : await publishOfficialDispatch(createClient(), {
              publishedAs: official.publishedAs,
              title,
              body,
              topics,
              mentions: mentions.retained(body),
              moments,
              postcard: postcardDraft,
              sponsor,
              webPublic: requestedWeb,
            })
        : safetyEvaluationId === null
          ? { data: null, error: { message: 'A Safety evaluation is required.' } }
          : isEdit && existingDispatch
          ? await updateDispatch(createClient(), existingDispatch.id, {
              title,
              body,
              topics,
              mentions: mentions.retained(body),
              moments,
              safetyEvaluationId,
              warningAcknowledged,
              webPublic: requestedWeb,
            })
          : await publishDispatch(createClient(), {
              title,
              body,
              topics,
              mentions: mentions.retained(body),
              moments,
              postcard: postcardDraft,
              safetyEvaluationId,
              warningAcknowledged,
              webPublic: requestedWeb,
            })

      if (submitError || !data) {
        console.error(isEdit ? '[board] edit failed' : '[board] publish failed', {
          code: submitError?.code,
          message: submitError?.message,
          details: submitError?.details,
          hint: submitError?.hint,
        })
        const devDetail = process.env.NODE_ENV === 'development' ? formatDevErrorDetail(submitError) : ''
        const editLockMessage = 'This Dispatch can no longer be edited.'
        const momentPlacementMessage = 'Moment position is out of range for this Dispatch.'
        const webRefusal = webVisibilityRefusal(submitError?.message)
        if (webRefusal) {
          setError(webRefusal)
          return
        }
        setError(
          submitError?.message === editLockMessage
            ? editLockMessage
            : submitError?.message === momentPlacementMessage
              ? `One of your Moments could not be placed. Your draft is safe. Return to editing and try placing that Moment again.${devDetail}`
              : `${accountBlockedMessage(myStatus) ?? genericErrorMessage}${devDetail}`
        )
        return
      }

      if (!isEdit) {
        clearDispatchDraft(draftKey)
        clearDispatchPostcardDraft(draftKey)
      }
      mentions.clear()
      setPendingWarning(null)
      router.push(`/board/${isEdit && existingDispatch ? existingDispatch.id : data.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(isEdit ? '[board] edit threw' : '[board] publish threw', { message })
      const devDetail = process.env.NODE_ENV === 'development' ? `\n(${message})` : ''
      setError(`${genericErrorMessage}${devDetail}`)
    } finally {
      setPublishing(false)
    }
  }

  async function handleOpenPreview() {
    if (!editor || preparingPreview) return
    setPreparingPreview(true)
    try {
      const descriptors = docToDraftMomentDescriptors(editor.getJSON() as LetterDocJSON)
      const supabase = createClient()
      const resolved = await resolveDraftPreviewMoments(descriptors, (imagePath) => resolveDispatchPhotoUrl(supabase, imagePath))
      setPreviewMoments(
        resolved
          .filter((m) => m.type === 'photo')
          .map((m) => ({ id: m.id, position: m.position, imageUrl: m.imageUrl }))
      )
    } finally {
      setPreparingPreview(false)
    }
  }

  const backHref = isEdit && existingDispatch
    ? `/board/${existingDispatch.id}`
    : official
      ? `/admin/content/${official.publishedAs === 'tempa' ? 'dispatches' : 'sponsored'}`
      : '/board'

  return (
    <main ref={composerRootRef} className="min-h-screen flex items-center justify-center p-6">
      <PhotoSourceInputs libraryInputRef={libraryInputRef} cameraInputRef={cameraInputRef} onChange={handleFileChosen} />

      <div className="w-full max-w-2xl space-y-6 py-10">
        <div className="space-y-1">
          <p className={sectionLabelClass}>
            {official
              ? `${isEdit ? 'Edit ' : ''}${official.publishedAs === 'tempa' ? 'Tempa Dispatch' : 'Sponsored Dispatch'}`
              : isEdit
                ? 'Edit Dispatch'
                : 'Dispatch'}
          </p>
          <p className={helperTextClass}>
            {official?.publishedAs === 'tempa'
              ? 'Published by Tempa, shown with the Tempa emblem. Your own name, Mark and profile are never shown.'
              : official?.publishedAs === 'sponsored'
                ? 'Shown with a Sponsored label and the sponsor’s name — never as Tempa, and never as you.'
                : 'Writing offered to the wider Tempa community — not addressed to anyone in particular.'}
          </p>
        </div>

        {isSponsored && (
          <fieldset className="space-y-3 rounded-md border border-foreground/10 p-4" aria-label="Sponsor">
            <label className="block space-y-1">
              <span className={sectionLabelClass}>Sponsor name</span>
              <input className={inputClass} value={sponsor.sponsorName} maxLength={80} onChange={(e) => setSponsor({ ...sponsor, sponsorName: e.target.value })} placeholder="e.g. Acme Paper Co." />
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
              <label className="block space-y-1">
                <span className={sectionLabelClass}>Link label (optional)</span>
                <input className={inputClass} value={sponsor.ctaLabel} maxLength={40} onChange={(e) => setSponsor({ ...sponsor, ctaLabel: e.target.value })} placeholder="Learn more" />
              </label>
              <label className="block space-y-1">
                <span className={sectionLabelClass}>Link (optional, https://)</span>
                <input className={inputClass} type="url" inputMode="url" value={sponsor.ctaUrl} maxLength={500} onChange={(e) => setSponsor({ ...sponsor, ctaUrl: e.target.value })} placeholder="https://" />
              </label>
            </div>
            {sponsorError && <p className={helperTextClass}>{sponsorError}</p>}
          </fieldset>
        )}

        {!isEdit && showComposerIntro && (
          <FeatureIntroduction guideKey="dispatch_composer" title="Leave something on the Board" ctaLabel="Start writing">
            <p>
              A Dispatch is writing offered beyond a private correspondence — a story from your day,
              something you&rsquo;ve noticed, a question you&rsquo;ve been carrying, or simply something worth putting into words.
            </p>
            <p>New Dispatches are public on the web by default. You can keep any one on Tempa only before publishing.</p>
          </FeatureIntroduction>
        )}

        <input type="text" value={title} onChange={(e) => handleTitleChange(e.target.value)} maxLength={TITLE_MAX_CHARS} placeholder="What is this about, in one line?" aria-label="Dispatch title" className={inputClass} />
        <p className={`text-right text-[12px] ${title.length >= TITLE_MAX_CHARS ? 'text-red-600' : helperTextClass}`}>
          {title.length} / {TITLE_MAX_CHARS}
        </p>

        {!isEdit && (
          <>
            {postcardIntroActive && !postcardDraft && (
              <FeatureIntroduction
                guideKey="postcard"
                title="Postcards"
                ctaLabel="Choose a postcard"
                onDismiss={() => setPostcardIntroActive(false)}
                onCta={() => {
                  setPostcardIntroActive(false)
                  setPostcardPickerOpen(true)
                }}
              >
                <p className="italic">Send a little piece of a place.</p>
                <p>Choose a postcard, add a few words to the front, and write something more on the back — then send it along with your Letter or Dispatch as a small keepsake.</p>
              </FeatureIntroduction>
            )}
            <PostcardComposerSlot draft={postcardDraft} catalogEntry={postcardCatalogEntry} onAdd={handleAddPostcard} onEdit={() => setPostcardEditorOpen(true)} />
          </>
        )}

        {isEdit && existingDispatch?.postcard && (
          <div className="flex justify-end">
            <LetterheadPostcard
              base={dispatchPostcardToBaseContent(existingDispatch.postcard.version)}
              revealLine={existingDispatch.postcard.revealLine}
              backMessage={existingDispatch.postcard.backMessage}
              senderPseudonym={existingDispatch.postcard.senderPseudonymSnapshot}
            />
          </div>
        )}

        <div className="space-y-2">
          <WritingToolbar editor={editor} />
          <CorrespondentPicker editor={editor} onSelect={mentions.select}><EditorContent editor={editor} /></CorrespondentPicker>
        </div>

        {uploadingIndex !== null && <p className={helperTextClass}>Adding photo…</p>}
        {openPicker !== null && (
          <MomentSourceMenu anchorRect={openPicker.anchorRect} onChooseLibrary={() => chooseSource(false)} onChooseCamera={() => chooseSource(true)} onCancel={() => setOpenPicker(null)} />
        )}

        {postcardPickerOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-background px-3 py-4 shadow-lg touch-pan-y sm:bg-foreground/30 sm:px-4 sm:py-8">
            <PostcardPicker postcards={activePostcards} onSelect={choosePostcard} onCancel={() => setPostcardPickerOpen(false)} />
          </div>
        )}

        {postcardEditorOpen && postcardDraft && (
          <PostcardEditor
            draft={postcardDraft}
            catalogEntry={postcardCatalogEntry}
            senderPseudonym={postcardSenderName}
            onChange={setPostcardDraftAndPersist}
            onChangePostcard={() => {
              setPostcardEditorOpen(false)
              setPostcardPickerOpen(true)
            }}
            onRemove={removePostcard}
            onDone={() => setPostcardEditorOpen(false)}
          />
        )}

        <div className="space-y-1.5">
          <p className={sectionLabelClass}>Topics (optional, up to 3)</p>
          <TopicInput topics={topics} onChange={handleTopicsChange} />
        </div>

        {!isEdit && previewBlockedReason && <p className={helperTextClass}>{previewBlockedReason}</p>}

        {showWebChoice && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-foreground/12 p-3">
            <input type="checkbox" checked={webPublic} onChange={(e) => setWebPublic(e.target.checked)} className="mt-1 h-4 w-4 accent-accent" data-testid="web-public-choice" />
            <span className="space-y-0.5">
              <span className="block text-[15px] font-medium text-foreground">{WEB_PUBLIC_COPY.label}</span>
              <span className={`block ${helperTextClass}`}>{webPublic ? WEB_PUBLIC_COPY.on : WEB_PUBLIC_COPY.off}</span>
            </span>
          </label>
        )}

        {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <Link href={backHref} className={secondaryButtonClass}>Back</Link>
          {isEdit ? (
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className={primaryButtonClass}>{publishing ? 'Saving…' : 'Save changes'}</button>
          ) : (
            <button type="button" onClick={handleOpenPreview} disabled={!canPreview || preparingPreview} className={primaryButtonClass}>{preparingPreview ? 'Preparing…' : 'Preview Dispatch'}</button>
          )}
        </div>
      </div>

      {!isEdit && previewMoments && (
        <DispatchPreview
          identity={publicIdentity}
          authorId={authorId}
          authorPseudonym={postcardSenderName}
          authorMarkUrl={authorMarkUrl}
          title={title}
          body={docToPlainBody(docJSON)}
          topics={topics}
          moments={previewMoments}
          postcardDraft={postcardDraft}
          postcardCatalogEntry={postcardCatalogEntry}
          onBack={() => setPreviewMoments(null)}
          onPublish={handleSubmit}
          publishing={publishing}
          publishBlockedReason={publishBlockedReason}
          onEditPostcard={() => setPostcardEditorOpen(true)}
          error={error}
          writingStyleId={official ? null : writingStyleId}
          webPublic={showWebChoice ? webPublic : undefined}
        />
      )}

      <SafetyWarningDialog
        open={pendingWarning !== null}
        copyKey={pendingWarning?.copyKey}
        onCancel={handleCancelWarning}
        onAcknowledgeAndSend={handleAcknowledgeWarning}
        sending={publishing}
        actionLabel={isEdit ? 'Save anyway' : 'Publish anyway'}
        sendingLabel={isEdit ? 'Saving…' : 'Publishing…'}
      />
      <SafetyBlockedDialog open={financialBlocked} onClose={() => setFinancialBlocked(false)} />
    </main>
  )
}
