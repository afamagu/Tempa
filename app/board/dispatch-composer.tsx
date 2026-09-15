'use client'

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
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
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
  dispatchPostcardToBaseContent,
  type DispatchMoment,
  type DispatchMomentDraft,
  type DispatchPostcard,
  type PublishDispatchError,
} from '@/lib/dispatches'
import { processImageForUpload } from '@/lib/image-processing'
import { getMyAccountStatus, accountBlockedMessage, type AccountStatus } from '@/lib/account-status'
import { getActivePostcards, type PostcardCatalogEntry } from '@/lib/postcards'
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

const TITLE_MAX_CHARS = 70

// Publish-failure diagnostic checkpoint (2026-09-08). Development-only:
// appends the literal Supabase/Postgres error detail to the generic
// production message, so the actual failure (a RAISE EXCEPTION message,
// a constraint code, a trigger's message, etc.) is visible on screen
// during diagnosis instead of only in the console. The production
// message itself is never altered — this only ever appends, and only
// in development.
function formatDevErrorDetail(error: PublishDispatchError): string {
  if (!error) return ''
  const parts = [`${error.code ?? '?'}: ${error.message}`]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(`hint: ${error.hint}`)
  return `\n(${parts.join(' — ')})`
}

// A client-side approximation of dispatch_visible_length (the live SQL
// function), for diagnostic logging ONLY — never used to validate or
// block anything here. Close enough to be useful for comparing against
// the server's own 10,000-character ceiling when diagnosing a failure;
// the server's own check remains the actual authority regardless.
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
  /** Dispatch Postcards Checkpoint 2 — the already-published, IMMUTABLE
   * Postcard this Dispatch carries, if any. Shown quietly (read-only,
   * via LetterheadPostcard) in edit mode — never a picker/change/remove
   * control; update_dispatch itself has no Postcard parameter at all, so
   * there is no ordinary path to mutate this even if a control existed. */
  postcard: DispatchPostcard | null
}

/**
 * The Dispatch composer — title, body (Bold/Italic/Emoji via the same
 * shared Tiptap schema every letter composer uses), up to 3 topics,
 * optional still-image Moments, and (Dispatch Postcards Checkpoint 2,
 * CREATE MODE ONLY) an optional single Postcard. The Postcard reuses the
 * exact same PostcardComposerSlot/PostcardPicker/PostcardEditor
 * components the Letter composer already uses — no parallel picker/
 * editor. Selected once, before publish: publish_dispatch resolves the
 * catalogue key to its CURRENT immutable version server-side (never the
 * client), so the choice made here is only ever a draft until Publish
 * actually locks it in. No length UI anywhere for the body: Dispatches
 * carry no product-facing character cap (see dispatchTitleError for the
 * one genuine, visible limit — the title).
 *
 * WRITE → PREVIEW → PUBLISH (create mode only) — same philosophy as
 * moments-composer.tsx's own WRITE → PREVIEW → SEND, adapted rather than
 * copied: the primary action is "Preview Dispatch," never a direct
 * publish. `canPreview` decides whether Preview is reachable at all
 * (title/body/no-photo-mid-upload — the same signal used for previous
 * Publish-button eligibility) and DELIBERATELY excludes the Postcard
 * back-message completeness check, mirroring moments-composer.tsx's own
 * `canSend` exactly: that gate applies at the actual Publish action
 * instead (inside DispatchPreview, as `publishBlockedReason`, with a
 * visible, restrained explanation and a direct link back into the
 * Postcard editor) — never silently. This is the fix for a real live
 * defect: the previous single-button flow folded the Postcard-message
 * gate directly into the Publish button's own `disabled` state with NO
 * visible explanation anywhere in the UI, so an author who opened the
 * new Postcard picker, selected one, and closed the editor without
 * writing a back message was left staring at a permanently disabled
 * "Publish Dispatch" button with no way to understand why. Edit mode is
 * unaffected — it never renders a Postcard picker at all (see
 * existingDispatch.postcard's own read-only display below), so its own
 * `canSubmit` needs no such gate and its "Save changes" button still
 * submits directly, exactly as before.
 *
 * Board usability checkpoint (2026-09-09): also serves editing, via
 * `mode="edit"` + `existingDispatch` — the SAME composer, not a second
 * one, per the explicit instruction to reuse this architecture rather
 * than build a parallel edit form. In edit mode: the editor starts from
 * `dispatchBodyToDoc(existingDispatch.body, existingDispatch.moments)`
 * (reuses markupBodyToLetterDoc for all text/mark reconstruction, adding
 * only Moment reattachment — see that function's own doc comment)
 * instead of an empty document; there is no
 * localStorage draft at all (an in-progress edit of already-published
 * writing isn't a "draft" in the same sense a first-time compose
 * session is, and skipping it avoids ever colliding with — or
 * accidentally overwriting — this author's unrelated new-Dispatch
 * draft); submitting calls update_dispatch (via updateDispatch) instead
 * of publish_dispatch, and always redirects to the SAME Dispatch id,
 * never a new one.
 *
 * Visual rule (Board usability follow-up, 2026-09-09): the writing
 * surface itself is `bg-surface-shell` — the same darker-paper token
 * the private-letter reader (letter-body.tsx) already uses, and the
 * Dispatch reader (app/board/[dispatchId]/page.tsx) already reuses —
 * so composing feels like the same TEMPA paper the piece will be read
 * on. Everything OUTSIDE the editor (title input, topic input, buttons)
 * stays on the ordinary page background; only the writing area itself
 * carries the tint. This is a deliberate divergence from the private-
 * letter composer (moments-composer.tsx), which stays bg-transparent —
 * private-letter styling is untouched by this rule.
 */
export default function DispatchComposer({
  authorId,
  authorPseudonym = '',
  mode = 'create',
  existingDispatch,
}: {
  authorId: string
  /** Dispatch Postcards Checkpoint 2 — the author's CURRENT pseudonym,
   * resolved server-side by the caller (app/board/write/page.tsx,
   * app/board/[dispatchId]/edit/page.tsx), same "never a snapshot at
   * draft time" reasoning as PostcardEditor's own senderPseudonym prop
   * (lib/moments.ts's resolveLetterPostcardDisplay doc comment). Unused
   * outside the Postcard editor's own live draft preview. */
  authorPseudonym?: string
  mode?: 'create' | 'edit'
  existingDispatch?: ExistingDispatchForEditing
}) {
  const isEdit = mode === 'edit' && Boolean(existingDispatch)
  const router = useRouter()
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTargetRef = useRef<number | null>(null)

  const [title, setTitle] = useState(existingDispatch?.title ?? '')
  const [topics, setTopics] = useState<string[]>(existingDispatch?.topics ?? [])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Account enforcement messaging (pre-beta UX polish batch 1) — see
  // lib/account-status.ts. publish_dispatch fully blocks restricted,
  // suspended, and banned alike (all three share one generic RPC
  // message), so unlike moments-composer.tsx's narrower case, the
  // three-way accountBlockedMessage applies directly here.
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

  // WRITE → PREVIEW → PUBLISH (create mode only) — same null-means-
  // closed/resolving, array-means-ready convention moments-composer.tsx
  // already uses for its own `previewMoments`. Never touched in edit
  // mode (edit mode has no Preview step at all).
  const [previewMoments, setPreviewMoments] = useState<DispatchMoment[] | null>(null)
  const [preparingPreview, setPreparingPreview] = useState(false)

  // Dispatch Postcards Checkpoint 2 — CREATE MODE ONLY. Mirrors moments-
  // composer.tsx's own Postcard state exactly: held entirely separate
  // from the editor document, null means nothing attached,
  // postcardPickerOpen serves both the empty slot's "+ Add a postcard"
  // and the editor's own "Change postcard." Left permanently unused (and
  // never rendered) in edit mode — an already-published Dispatch's
  // Postcard is immutable, shown read-only via existingDispatch.postcard
  // instead (see the JSX below).
  const [postcardDraft, setPostcardDraft] = useState<LetterPostcardDraft | null>(null)
  const [postcardPickerOpen, setPostcardPickerOpen] = useState(false)
  const [postcardEditorOpen, setPostcardEditorOpen] = useState(false)
  const [activePostcards, setActivePostcards] = useState<PostcardCatalogEntry[]>([])

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

  // Restored once on mount, from its own separate key — completely
  // independent of the editor's own draft restoration above, same
  // reasoning as moments-composer.tsx's matching effect.
  useEffect(() => {
    if (isEdit) return
    const restored = readDispatchPostcardDraft(authorId)
    queueMicrotask(() => setPostcardDraft(restored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, authorId])

  // The ONE place a Postcard edit is both applied to state AND
  // persisted — see moments-composer.tsx's matching function for why
  // this is deliberately not a useEffect keyed on postcardDraft changing.
  function setPostcardDraftAndPersist(next: LetterPostcardDraft | null) {
    setPostcardDraft(next)
    writeDispatchPostcardDraft(authorId, next)
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

  // "The front is the atmosphere. The back is written for this
  // particular sending" — same rule write_letter enforces for a sent
  // Letter Postcard, applied here to Publish. Draft state may have a
  // blank back while composing; Publish itself requires a real,
  // author-written message (mirrored server-side in publish_dispatch).
  const postcardNeedsMessage = Boolean(postcardDraft && postcardDraft.backMessage.trim().length === 0)

  const editor = useEditor({
    immediatelyRender: false,
    // Same Send-button reactivity fix every other letter composer
    // needs — see moments-composer.tsx's own comment for the full
    // explanation of why @tiptap/react requires this explicitly.
    shouldRerenderOnTransaction: true,
    extensions: [
      ...baseWritingExtensions(),
      Placeholder.configure({ placeholder: 'Begin writing…' }),
      DispatchPhotoMoment,
      MomentAffordance.configure({
        enabled: true,
        onRequestPhoto: (index, anchorRect) => setOpenPicker({ index, anchorRect }),
      }),
    ],
    content: isEdit && existingDispatch ? dispatchBodyToDoc(existingDispatch.body, existingDispatch.moments) : EMPTY_LETTER_DOC,
    // bg-surface-shell (not bg-transparent, unlike the private-letter
    // composer this schema is otherwise shared with — see
    // moments-composer.tsx, deliberately left untouched) — the same
    // paper token the Dispatch/private-letter READERS already use, so
    // writing a Dispatch feels like the same TEMPA paper it will be
    // read on. See this file's own top-level doc comment.
    editorProps: {
      attributes: {
        class:
          'min-h-64 w-full rounded-md border border-foreground/15 bg-surface-shell px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-4',
      },
    },
    onUpdate({ editor: current }) {
      if (isEdit) return
      writeDispatchDraft(authorId, { title, doc: current.getJSON() as LetterDocJSON, topics })
    },
  })

  // Restored after mount, not as the editor's initial state — same
  // SSR-hydration-mismatch reasoning as every other composer's draft
  // restoration here (localStorage doesn't exist during server
  // rendering, so reading it any earlier than a post-mount effect would
  // either throw or produce a value the server-rendered markup never
  // had, i.e. a hydration mismatch). title/topics are ordinary React
  // state — unlike the editor's own content, there is no non-React
  // system holding them — so restoring them is a legitimate, one-time,
  // effect-driven initialization from an external source (the same
  // category of exception react-hooks/set-state-in-effect exists to
  // let through), not a case of state that should instead be derived
  // during render. Never runs in edit mode — see this component's own
  // doc comment for why editing has no draft at all.
  useEffect(() => {
    if (!editor || isEdit) return
    const draft = readDispatchDraft(authorId)
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage, see comment above
      setTitle(draft.title)
      setTopics(draft.topics)
      editor.commands.setContent(draft.doc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, authorId])

  function persistDraft(nextTitle: string, nextTopics: string[]) {
    if (!editor || isEdit) return
    writeDispatchDraft(authorId, { title: nextTitle, doc: editor.getJSON() as LetterDocJSON, topics: nextTopics })
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
  // aboveMax is always false: Dispatches have no product-level length
  // limit (see the Build Guide's Dispatches section) — the server-side
  // 10,000-visible-character ceiling is a defensive backstop only, never
  // surfaced here.

  // Edit mode's own submit eligibility — "Save changes" still submits
  // directly, unchanged from before Preview existed. Postcard state is
  // permanently inert in edit mode (the effects above never populate it
  // there), so no Postcard gate is needed here at all.
  const canSubmit =
    Boolean(editor) &&
    titleError === null &&
    canSendLetter(docJSON, { aboveMax: false, submitting: publishing }) &&
    !uploadingIndex

  // Create mode's Preview eligibility — deliberately the SAME shape as
  // moments-composer.tsx's own `canSend`: title/body/no-photo-mid-upload
  // only. The Postcard back-message completeness gate is intentionally
  // NOT here — see this file's own top-level doc comment for why folding
  // it in here (the previous, single-button behavior) was the live bug.
  const canPreview =
    Boolean(editor) &&
    titleError === null &&
    canSendLetter(docJSON, { aboveMax: false, submitting: publishing || preparingPreview }) &&
    !uploadingIndex

  // Shown next to the Preview button ONLY when there is something
  // concrete and fixable to say — never a generic "can't submit" dead
  // end. Photo-upload-in-progress already has its own visible "Adding
  // photo…" line below, so it isn't duplicated here.
  const previewBlockedReason: string | null =
    isEdit || publishing || preparingPreview
      ? null
      : titleError
        ? titleError
        : !letterDocHasContent(docJSON)
          ? 'Write something before you can preview.'
          : null

  // The actual Publish precondition (evaluated inside DispatchPreview in
  // create mode, or directly by "Save changes" in edit mode) — the ONE
  // place the Postcard back-message gate now lives, always paired with a
  // visible reason (DispatchPreview's own publishBlockedReason prop).
  const publishBlockedReason: string | null =
    !isEdit && postcardNeedsMessage ? 'Write something on the back of your postcard before publishing.' : null

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

  // Dispatch Preview checkpoint — the SAME "prevent double-submission"
  // guard the button's own `disabled` already provides, reasserted here
  // defensively: in edit mode, `canSubmit` (already false while
  // `publishing`); in create mode, `canPreview` plus the Postcard
  // completeness gate — since Preview's own Publish button is disabled
  // while `publishing` or `publishBlockedReason`, this can only ever be
  // reached once per click either way.
  async function handleSubmit() {
    const canPublish = isEdit ? canSubmit : canPreview && !publishBlockedReason
    if (!editor || !canPublish) return
    setPublishing(true)
    setError(null)

    const finalDoc = editor.getJSON() as LetterDocJSON
    const body = docToPlainBody(finalDoc)
    const moments: DispatchMomentDraft[] = docToMomentDrafts(finalDoc)
      .filter((m) => m.type === 'photo')
      .map((m) => ({ position: m.position, imagePath: m.imagePath }))

    const actionTag = isEdit ? '[board] edit attempt' : '[board] publish attempt'
    if (process.env.NODE_ENV === 'development') {
      // Safe structural summary only — never the full body, an image's
      // raw bytes, an auth token, or an email address. Exactly what is
      // about to be sent, shaped the same way publishDispatch/
      // updateDispatch will shape it (normalizeTopics is pure/
      // idempotent, so calling it again here for logging matches the
      // real payload exactly).
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
      // Dispatch Postcards Checkpoint 2 — the draft is passed ONLY on
      // the create-mode publish call; updateDispatch never accepts a
      // postcard parameter at all (update_dispatch has no such RPC
      // argument), so an edit-mode submission cannot touch it even by
      // accident.
      const { data, error: submitError } =
        isEdit && existingDispatch
          ? await updateDispatch(createClient(), existingDispatch.id, { title, body, topics, moments })
          : await publishDispatch(createClient(), { title, body, topics, moments, postcard: postcardDraft })

      if (submitError || !data) {
        console.error(isEdit ? '[board] edit failed' : '[board] publish failed', {
          code: submitError?.code,
          message: submitError?.message,
          details: submitError?.details,
          hint: submitError?.hint,
        })
        const devDetail = process.env.NODE_ENV === 'development' ? formatDevErrorDetail(submitError) : ''
        // Account enforcement messaging (pre-beta UX polish batch 1) —
        // restricted/suspended/banned all fully block publish_dispatch,
        // so the caller's own already-known status (never decoded from
        // the RPC's shared generic message) can replace the generic
        // retry-implying fallback outright when it applies.
        setError(`${accountBlockedMessage(myStatus) ?? genericErrorMessage}${devDetail}`)
        return
      }

      if (!isEdit) {
        clearDispatchDraft(authorId)
        clearDispatchPostcardDraft(authorId)
      }
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

  // WRITE → PREVIEW → PUBLISH (create mode only) — resolves the CURRENT
  // editor document's Moments into real, displayable Moment[] BEFORE
  // opening Preview, the same "resolve fresh at the moment Preview is
  // requested" approach moments-composer.tsx's own handleOpenPreview
  // uses (docToDraftMomentDescriptors + resolveDraftPreviewMoments,
  // reused as-is — the only Dispatch-specific addition is
  // resolveDispatchPhotoUrl, signing against the separate dispatch-
  // photos bucket instead of letter-photos). previewMoments stays null
  // (Preview closed/not yet resolving) until this completes, exactly
  // mirroring that same null-vs-array convention.
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

  const backHref = isEdit && existingDispatch ? `/board/${existingDispatch.id}` : '/board'

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <PhotoSourceInputs libraryInputRef={libraryInputRef} cameraInputRef={cameraInputRef} onChange={handleFileChosen} />

      <div className="w-full max-w-2xl space-y-6 py-10">
        <div className="space-y-1">
          <p className={sectionLabelClass}>{isEdit ? 'Edit Dispatch' : 'Dispatch'}</p>
          <p className={helperTextClass}>
            Writing offered to the wider Tempa community — not addressed to anyone in particular.
          </p>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          maxLength={TITLE_MAX_CHARS}
          placeholder="What is this about, in one line?"
          aria-label="Dispatch title"
          className={inputClass}
        />

        {/* Dispatch Postcards Checkpoint 2 — CREATE MODE ONLY: the same
            letterhead-position slot the Letter composer uses, sitting
            between the title and the writing surface, entirely outside
            the ProseMirror document. EDIT MODE shows the already-
            published, immutable Postcard instead (if any) — read-only,
            no picker/change/remove control — via LetterheadPostcard
            directly, never this slot. */}
        {!isEdit && (
          <PostcardComposerSlot
            draft={postcardDraft}
            catalogEntry={postcardCatalogEntry}
            onAdd={() => setPostcardPickerOpen(true)}
            onEdit={() => setPostcardEditorOpen(true)}
          />
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
          <EditorContent editor={editor} />
        </div>

        {uploadingIndex !== null && <p className={helperTextClass}>Adding photo…</p>}

        {openPicker !== null && (
          <MomentSourceMenu
            anchorRect={openPicker.anchorRect}
            onChooseLibrary={() => chooseSource(false)}
            onChooseCamera={() => chooseSource(true)}
            onCancel={() => setOpenPicker(null)}
          />
        )}

        {postcardPickerOpen && (
          <div className="fixed inset-x-0 bottom-0 z-50 bg-background p-4 shadow-lg">
            <PostcardPicker postcards={activePostcards} onSelect={choosePostcard} onCancel={() => setPostcardPickerOpen(false)} />
          </div>
        )}

        {postcardEditorOpen && postcardDraft && (
          <PostcardEditor
            draft={postcardDraft}
            catalogEntry={postcardCatalogEntry}
            senderPseudonym={authorPseudonym}
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

        {/* Dispatch Preview checkpoint — restrained, single-line
            explanation for WHY Preview isn't available yet, shown only
            when there's something concrete and fixable to say. Never
            rendered in edit mode (edit mode has its own direct "Save
            changes" with no Preview step). */}
        {!isEdit && previewBlockedReason && <p className={helperTextClass}>{previewBlockedReason}</p>}

        {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <Link href={backHref} className={secondaryButtonClass}>
            Back
          </Link>
          {isEdit ? (
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className={primaryButtonClass}>
              {publishing ? 'Saving…' : 'Save changes'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenPreview}
              disabled={!canPreview || preparingPreview}
              className={primaryButtonClass}
            >
              {preparingPreview ? 'Preparing…' : 'Preview Dispatch'}
            </button>
          )}
        </div>
      </div>

      {/* WRITE → PREVIEW → PUBLISH (create mode only) — only
          publishDispatch/publish_dispatch call site remaining for create
          mode; handleSubmit is passed straight through, never
          duplicated. Editor/title/topics/Postcard draft all stay exactly
          as they were underneath — this is purely an overlay. */}
      {!isEdit && previewMoments && (
        <DispatchPreview
          authorId={authorId}
          authorPseudonym={authorPseudonym}
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
        />
      )}
    </main>
  )
}
