'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { TextSelection } from '@tiptap/pm/state'
import { createClient } from '@/lib/supabase/client'
import { helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import { toMomentRpcPayload, type Moment, type LetterPostcardDraft } from '@/lib/moments'
import { getActivePostcards, type PostcardCatalogEntry } from '@/lib/postcards'
import FeatureIntroduction from '@/app/feature-introduction'
import {
  docToPlainBody,
  docToMomentDrafts,
  docToDraftMomentDescriptors,
  resolveDraftPreviewMoments,
  extractLegacyPostcardMoment,
  stripPostcardMoments,
  canSendLetter,
  plainBodyToLetterDoc,
  EMPTY_LETTER_DOC,
  type LetterDocJSON,
} from '@/lib/letter-editor-doc'
import { resolveLetterPhotoUrl } from '@/lib/draft-photo-url'
import TempaNote from '@/app/tempa-note'
import {
  readLetterEditorDraft,
  writeLetterEditorDraft,
  clearLetterEditorDraft,
  readLetterPostcardDraft,
  writeLetterPostcardDraft,
  clearLetterPostcardDraft,
} from '@/lib/letter-editor-draft'
import { readLetterDraft, clearLetterDraft } from '@/lib/letter-draft'
import {
  getMyAccountStatus,
  accountBlockedMessage,
  RESTRICTED_ATTACHMENT_MESSAGE,
  CORRESPONDENCE_CLOSED_MESSAGE,
  type AccountStatus,
} from '@/lib/account-status'
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
import WritingToolbar from '@/app/letters/writing-toolbar'
import { PhotoMoment } from './photo-moment-node'
import { PostcardMoment } from './postcard-moment-node'
import { MomentAffordance } from './moment-affordance-extension'
import PhotoSourceInputs, { selectPhotoSourceRef } from './photo-source-inputs'
import MomentSourceMenu from './moment-source-menu'
import { processImageForUpload } from '@/lib/image-processing'
import PostcardPicker from './postcard-picker'
import PostcardComposerSlot from './postcard-composer-slot'
import PostcardEditor from './postcard-editor'
import LetterPreview from './letter-preview'

/**
 * The composer for an ESTABLISHED correspondence's ongoing letters —
 * one continuous, structured document (Tiptap/ProseMirror) rather than
 * a stack of separate paragraph boxes. Pressing Enter is the editor's
 * own native paragraph split — nothing here intercepts it. A quiet `⊕`
 * (see moment-affordance-extension.ts) appears after every paragraph
 * the writer has already finished, as a widget decoration — never part
 * of the actual document, so ignoring it and continuing to type costs
 * nothing and needs no "escape." Attaching a photo inserts a real,
 * atomic `photoMoment` node (see photo-moment-node.tsx) as a child of
 * that exact paragraph, so ProseMirror's own position-mapping keeps it
 * correctly attached through any later edit anywhere else in the
 * document — there is no separate index to go stale.
 *
 * Moments here are photo-only — Postcards have left Moments entirely,
 * for NEW composition (Letter-Level Postcards V1, 2026-09-13): a
 * Postcard is now one optional letterhead enclosure belonging to the
 * whole letter (see PostcardComposerSlot/PostcardEditor and its own
 * separate draft, lib/letter-editor-draft.ts), never a paragraph-
 * positioned ProseMirror node. `PostcardMoment` stays registered as an
 * editor extension purely for backward compatibility — an already-
 * in-progress draft saved before this checkpoint may still have an old
 * inline postcardMoment node sitting in localStorage, and it must keep
 * restoring/rendering/removing correctly (photo-moment-node.tsx's
 * sibling, postcard-moment-node.tsx, is completely untouched) — but
 * nothing in this composer can create a NEW one anymore. A historical
 * *delivered* Postcard Moment (moments.type = 'postcard') remains fully
 * readable wherever it was originally sent, forever.
 *
 * Write Anytime: the SAME component and the SAME write_letter RPC serve
 * both the person-archive quill (replyToId omitted) and "Reply" from a
 * specific incoming letter (replyToId set) — there is no second
 * implementation. Only reachable once correspondence.established_at is
 * not null (see app/letters/with/[userId]/write/page.tsx and
 * app/letters/[letterId]/page.tsx) — that alone is enough to be HERE,
 * writing text, but NOT enough for a Moment: momentsQualified is a
 * separate, stricter signal (Letter 2 must have actually delivered, not
 * merely been sent — see isMomentsQualifiedForViewer, lib/letters.ts).
 * write_letter itself re-checks this server-side regardless of what
 * momentsQualified says here; this prop only controls the affordance.
 */
export default function MomentsComposer({
  correspondenceId,
  replyToId,
  momentsQualified,
  canSendPhoto,
  isFirstPhotoRequest,
  photoDecisionOutstandingForMe,
  reviewPhotoHref,
  recipientPseudonym,
  senderPseudonym,
  cancelHref,
  showPostcardIntro = false,
}: {
  correspondenceId: string
  /** Optional contextual ancestry only ("this letter was written in
   * response to that one") — never a turn-taking lock. Passed through
   * to write_letter's p_reply_to_id unchanged; omitted entirely for the
   * quill's "write a fresh letter" case. */
  replyToId?: string | null
  /** Whether Letter 2 has actually delivered — Moments here are
   * photo-only (Postcards have left Moments entirely), so this alone
   * gates the whole ⊕ affordance, ahead of and independent from
   * canSendPhoto's own photo-consent reasons below. */
  momentsQualified: boolean
  /** True when photo_consent_status is 'no_request' or 'enabled' — a
   * Photo can always be attempted from a fresh, never-asked
   * correspondence (that send IS the request); it's blocked only while
   * a decision is pending, deferred, or the correspondence was chosen
   * to stay photo-free. There is no separate "ask first" step anymore. */
  canSendPhoto: boolean
  /** True specifically when photo_consent_status is 'no_request' — this
   * would-be photo is the one whose send opens the request. Only then
   * does choosing a photo pass through the "Your first photo in this
   * correspondence" explanation before it's attached; once consent is
   * already 'enabled', later photos attach immediately like any other
   * Moment. */
  isFirstPhotoRequest: boolean
  /** The shared "outstanding photo decision" concept (see
   * isPhotoDecisionOutstandingForUser, lib/letters.ts) — true when this
   * viewer specifically owes a decision (pending's non-requester, or
   * deferred's resolver). Gets its own actionable message below instead
   * of the generic "not available right now" copy, which stays exactly
   * as-is for photo_free (resolved, not outstanding). */
  photoDecisionOutstandingForMe: boolean
  /** Href (with #locked-photo-<id> anchor) to the locked Moment this
   * viewer owes a decision on — see page.tsx. Undefined only in the
   * unlikely case none could be found, in which case no action renders. */
  reviewPhotoHref?: string
  recipientPseudonym: string
  /** Pre-migration audit correction (2026-09-14) — the CURRENT member's
   * own pseudonym, resolved by the caller (never a snapshot — see
   * resolveLetterPostcardDisplay's own doc comment, lib/moments.ts).
   * Used ONLY by the Postcard editor/Preview's own "— <name>" signature
   * line on the attached Postcard's back; unrelated to anything else in
   * this composer. */
  senderPseudonym: string
  /** Where "Back" returns to — always the person's archive
   * (/letters/with/[userId]), a real navigation now that this composer
   * is its own dedicated route rather than an overlay atop the reader. */
  cancelHref: string
  /** Onboarding & First-Use checkpoint (Checkpoint 2B) — server-resolved
   * !hasCompletedGuide(...,'postcard') (app/letters/with/[userId]/write/
   * page.tsx), the SAME shared guide key the Dispatch composer's own
   * Postcard slot uses (app/board/dispatch-composer.tsx) — Postcard
   * teaches itself once, on whichever surface a member reaches it
   * first. */
  showPostcardIntro?: boolean
}) {
  const router = useRouter()
  // Two SEPARATE, statically-configured inputs rather than one shared
  // input with `capture` toggled on/off right before each click. The
  // latter is a known-unreliable pattern: several mobile browsers decide
  // which picker UI to show based on the input's state at a point that
  // doesn't reliably line up with "immediately before this specific
  // click," so a late-added `capture` attribute can silently be ignored
  // and fall through to the ordinary library picker — exactly the bug
  // this fixes. A `capture="environment"` input that has always had that
  // attribute, never mutated, is the safe, standard approach.
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTargetRef = useRef<number | null>(null)

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Account enforcement messaging (pre-beta UX polish batch 1) — see
  // lib/account-status.ts's own doc comment. Fetched once on mount,
  // purely to pick a calmer message when a send this status actually
  // blocks fails — write_letter/reply_to_letter remain the sole
  // authority on whether the attempt itself succeeds.
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
  // WRITE → PREVIEW → SEND (2026-09-08): the composer's own primary
  // action no longer sends directly — it opens this full reading state
  // instead. Live-repair checkpoint (2026-09-08), Part D: opening it is
  // no longer a synchronous toggle. A restored draft's Photo Moments
  // only carry a durable `imagePath` (see stripTransientPhotoPreviews),
  // so Preview must resolve every one of them to a real display URL
  // BEFORE it opens — `previewMoments` is null while Preview is closed
  // or still resolving, and holds the fully-resolved `Moment[]` once
  // ready; Preview is never opened text-only while resolution is
  // pending (Part D's explicit requirement). Opening/closing this still
  // never touches the editor or its draft in any way (see LetterPreview's
  // own doc comment) — resolution only ever READS the live document.
  const [previewMoments, setPreviewMoments] = useState<Moment[] | null>(null)
  const [preparingPreview, setPreparingPreview] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [openPicker, setOpenPicker] = useState<{ index: number; anchorRect: DOMRect } | null>(null)
  // A photo that's been uploaded and is awaiting the member's
  // confirmation on the "first photo" explanation before it's actually
  // inserted as a Moment — only ever populated when isFirstPhotoRequest.
  const [pendingFirstPhoto, setPendingFirstPhoto] = useState<
    { index: number; imagePath: string; previewUrl: string } | null
  >(null)
  // Letter-Level Postcards V1 (2026-09-13) — the whole letter's one
  // optional Postcard, held entirely SEPARATE from the editor document
  // (see lib/moments.ts's own LetterPostcardDraft doc comment). null
  // means no Postcard attached. postcardPickerOpen serves BOTH the
  // empty slot's "+ Add a postcard" and the editor's own "Change
  // postcard" — there is only ever one picker, never two independently-
  // maintained instances of it.
  const [postcardDraft, setPostcardDraft] = useState<LetterPostcardDraft | null>(null)
  const [postcardPickerOpen, setPostcardPickerOpen] = useState(false)
  const [postcardEditorOpen, setPostcardEditorOpen] = useState(false)
  // Admin Phase 2A-2 — the live, ACTIVE DB-backed catalogue
  // (lib/postcards.ts), fetched once on mount. This, not the static
  // POSTCARD_CATALOG, is now the source of truth for what the picker
  // offers and what the composer-slot/editor/Preview resolve
  // draft.postcardKey against.
  const [activePostcards, setActivePostcards] = useState<PostcardCatalogEntry[]>([])
  // Production back-editing UX defect (2026-09-15) — true only when the
  // editor is opened via Preview's own blocked-Send control/thumbnail
  // (the sender specifically needs to write the back right now); reset
  // to false for the ordinary composer-slot edit, so that path keeps
  // opening on the front exactly as before.
  const [postcardEditorStartOnBack, setPostcardEditorStartOnBack] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    // Send-button reactivity audit (2026-09-05, following the same
    // fix already applied to first-letter-composer.tsx) —
    // @tiptap/react's useEditor() does not re-render its host
    // component on typing/formatting by default; the editor mutates
    // the contenteditable DOM directly via ProseMirror, entirely
    // outside React's render cycle. Without this, canSend/
    // the toolbar's Bold/Italic active state (all derived from
    // editor.getJSON()/editor.isActive() in the render body) would be
    // frozen at whatever they were on first render.
    shouldRerenderOnTransaction: true,
    extensions: [
      ...baseWritingExtensions(),
      Placeholder.configure({ placeholder: `Write back to ${recipientPseudonym}…` }),
      PhotoMoment,
      PostcardMoment,
      MomentAffordance.configure({
        enabled: momentsQualified && canSendPhoto,
        onRequestPhoto: (index, anchorRect) => setOpenPicker({ index, anchorRect }),
      }),
    ],
    content: EMPTY_LETTER_DOC,
    editorProps: {
      attributes: {
        class:
          'min-h-32 w-full rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-4',
      },
    },
    onUpdate({ editor: current }) {
      writeLetterEditorDraft(correspondenceId, current.getJSON() as LetterDocJSON)
    },
  })

  // Restore a saved draft once, after mount — deliberately not passed
  // as the editor's initial `content` (which would read localStorage
  // during the very first render and risk a server/client hydration
  // mismatch, since this composer can be the initial mode via
  // ?compose=1). Trades a fast flash from blank to restored content for
  // correctness, same as the previous composer.
  useEffect(() => {
    if (!editor) return
    const richDraft = readLetterEditorDraft(correspondenceId)
    if (richDraft) {
      // Pre-migration audit correction (2026-09-14), Part 2 — a draft
      // saved before Letter-Level Postcards V1 may still carry an old
      // inline postcardMoment node. The server no longer accepts a
      // 'postcard'-type p_moments entry at all, so this is migrated
      // gracefully, once, on restore: the node is stripped from the
      // document (never re-sent as a Moment) and its postcardKey
      // becomes the seed of the new, separate letter-level draft —
      // no member action required, and nothing is silently lost. Never
      // overwrites a Postcard the member has already chosen separately
      // (the functional updater checks the LATEST state, not a value
      // captured at effect-setup time, so this is correct regardless of
      // exactly when the separate postcard-draft-restore effect below
      // happens to run relative to this one).
      const legacyPostcard = extractLegacyPostcardMoment(richDraft)
      if (legacyPostcard) {
        editor.commands.setContent(stripPostcardMoments(richDraft))
        queueMicrotask(() => {
          setPostcardDraft((current) => {
            if (current) return current
            const migrated: LetterPostcardDraft = {
              postcardKey: legacyPostcard.postcardKey,
              revealLine: '',
              backMessage: '',
            }
            writeLetterPostcardDraft(correspondenceId, migrated)
            return migrated
          })
        })
      } else {
        editor.commands.setContent(richDraft)
      }
      return
    }
    // One-time fallback for a letter already in progress under the OLD
    // plain-text-only draft format at the moment this shipped, so it
    // isn't silently lost — that format never stored Moments, so there
    // is nothing to restore beyond the words themselves.
    const legacyDraft = readLetterDraft(correspondenceId)
    if (legacyDraft) {
      editor.commands.setContent(plainBodyToLetterDoc(legacyDraft))
      clearLetterDraft(correspondenceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Letter-Level Postcards V1 — restored once on mount, from its own
  // separate key, completely independent of the editor's own restore
  // effect above: a Postcard surviving refresh must never depend on the
  // ProseMirror document restoring successfully, and vice versa. This
  // ONLY calls setPostcardDraft, never writeLetterPostcardDraft — see
  // setPostcardDraftAndPersist below for why persistence is wired to
  // actual edits alone, exactly mirroring how the editor's own
  // autosave is wired to onUpdate rather than to "content changed for
  // any reason including being restored." queueMicrotask defers the
  // actual setState call out of the effect's own synchronous body —
  // functionally identical (it still applies before the next paint),
  // but keeps this a genuine one-time hydration read rather than the
  // synchronous-setState-in-effect pattern React's own lint rule flags.
  useEffect(() => {
    const restored = readLetterPostcardDraft(correspondenceId)
    queueMicrotask(() => setPostcardDraft(restored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Admin Phase 2A-2 — fetched once on mount, independent of the
  // Postcard draft's own restore above: the picker/composer-slot/editor
  // all need the live active catalogue regardless of whether a Postcard
  // is already attached. A key that's since been deactivated simply
  // won't be found in this list (handled by postcardCatalogEntry below),
  // never a crash.
  useEffect(() => {
    let cancelled = false
    getActivePostcards(createClient()).then((postcards) => {
      if (!cancelled) setActivePostcards(postcards)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The ONE place a Postcard edit is both applied to state AND
  // persisted — deliberately not a `useEffect` keyed on `postcardDraft`
  // changing, which would ALSO fire the instant the restore effect
  // above calls setPostcardDraft, momentarily re-writing (and, worse,
  // transiently deleting-then-rewriting) a draft that was simply being
  // loaded, not edited. Every real mutation (add, edit, change, remove)
  // goes through this single function, so state and storage can never
  // drift apart. Writing `null` removes the stored draft entirely (see
  // writeLetterPostcardDraft's own doc comment).
  function setPostcardDraftAndPersist(next: LetterPostcardDraft | null) {
    setPostcardDraft(next)
    writeLetterPostcardDraft(correspondenceId, next)
  }

  // The SAME editor.getJSON() call feeds the button's enable state and
  // (in handleSend) the actual submitted body/Moments — one canonical
  // source, never a separately-maintained string. canSendLetter is the
  // same helper first-letter-composer.tsx uses; the extra
  // !uploadingIndex/!pendingFirstPhoto gates are specific to this
  // composer's photo-attachment flow, layered on top rather than
  // duplicating the generic eligibility rule.
  //
  // aboveMax is always false here, unlike first-letter-composer.tsx:
  // TEMPA has no product-level maximum length for an ordinary letter
  // once a correspondence is established (Write Anytime, Letter 3+) —
  // the stranger/discovery-writing cap exists specifically to stop an
  // unsolicited first letter from being enormous, a concern that
  // doesn't apply once both participants have chosen to correspond.
  // Never derived from character count here, so an intentionally very
  // long established letter can never be blocked by a length gate that
  // no longer exists as product policy.
  const docJSON = (editor?.getJSON() as LetterDocJSON | undefined) ?? EMPTY_LETTER_DOC
  const canSend =
    Boolean(editor) &&
    canSendLetter(docJSON, { aboveMax: false, submitting: sending }) &&
    !uploadingIndex &&
    !pendingFirstPhoto

  // Pre-migration audit correction (2026-09-14), Part 4 — "The front is
  // the atmosphere. The back is written for this particular sending."
  // Draft state may absolutely have a blank back while composing (the
  // Postcard editor never forces one), but SEND requires a real,
  // sender-written message — mirrored server-side in write_letter/
  // reply_to_letter's own non-blank check. Deliberately NOT folded into
  // `canSend`/the "Preview letter" button: Preview is still draft-time
  // reading, not the send action itself, so a blank back never blocks
  // opening it — only the actual Send button inside LetterPreview.
  const postcardNeedsMessage = Boolean(postcardDraft && postcardDraft.backMessage.trim().length === 0)

  // Admin Phase 2A-2 — resolved once here, passed down to the
  // composer-slot/editor/Preview so none of them repeat this lookup
  // against the live catalogue independently. Null when nothing is
  // attached, or when the attached key is no longer active.
  const postcardCatalogEntry = postcardDraft
    ? (activePostcards.find((p) => p.key === postcardDraft.postcardKey) ?? null)
    : null

  // Inserts a real photoMoment node at the end of the paragraph at
  // `paragraphIndex`, found fresh in the CURRENT document — the upload
  // that precedes this call is async, so the writer may have kept
  // typing in the meantime; re-walking the live document (rather than
  // trusting a position captured before the upload started) is what
  // keeps this correct regardless of what changed while it was in
  // flight. The writer's own selection is explicitly preserved by
  // mapping it through the same insertion, so a cursor further down the
  // letter never jumps back to the attachment point.
  function insertPhotoMomentAtParagraphEnd(
    paragraphIndex: number,
    attrs: { imagePath: string; previewUrl: string }
  ) {
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
    // The paragraph this was meant for no longer exists (e.g. merged
    // away while the upload was in flight) — drop silently rather than
    // attach to the wrong paragraph.
    if (targetPos === null) return

    const momentNode = schema.nodes.photoMoment.create(attrs)
    const tr = state.tr.insert(targetPos, momentNode)
    const mappedSelectionPos = tr.mapping.map(state.selection.from)
    tr.setSelection(TextSelection.near(tr.doc.resolve(mappedSelectionPos)))
    editor.view.dispatch(tr)
    editor.view.focus()
  }

  // Letter-Level Postcards V1 — the picker is now shared by BOTH the
  // empty slot's "+ Add a postcard" and the editor's own "Change
  // postcard," distinguished only by whether postcardDraft already
  // exists: a fresh selection starts revealLine/backMessage blank; a
  // replacement keeps whatever the sender already wrote, since changing
  // the front image is never a reason to discard their own words.
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

  function chooseSource(useCamera: boolean) {
    if (openPicker === null) return
    pendingTargetRef.current = openPicker.index
    setOpenPicker(null)
    // selectPhotoSourceRef (photo-source-inputs.tsx) is the one place
    // this mapping is decided — never re-decided inline here, so it
    // can't quietly diverge from what's actually under test.
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
      const path = `${correspondenceId}/${crypto.randomUUID()}.jpg`
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('letter-photos')
        .upload(path, blob, { contentType: 'image/jpeg' })

      if (uploadError) throw uploadError

      const previewUrl = URL.createObjectURL(blob)
      if (isFirstPhotoRequest) {
        // Don't attach yet — the member sees the explanation screen
        // first and must actively continue before this becomes a real
        // Moment on the letter.
        setPendingFirstPhoto({ index, imagePath: path, previewUrl })
      } else {
        insertPhotoMomentAtParagraphEnd(index, { imagePath: path, previewUrl })
      }
    } catch {
      setError('Could not add that photo. Please try again.')
    } finally {
      setUploadingIndex(null)
    }
  }

  function confirmFirstPhoto() {
    if (!pendingFirstPhoto) return
    insertPhotoMomentAtParagraphEnd(pendingFirstPhoto.index, {
      imagePath: pendingFirstPhoto.imagePath,
      previewUrl: pendingFirstPhoto.previewUrl,
    })
    setPendingFirstPhoto(null)
  }

  function cancelFirstPhoto() {
    if (!pendingFirstPhoto) return
    URL.revokeObjectURL(pendingFirstPhoto.previewUrl)
    setPendingFirstPhoto(null)
  }

  async function handleSend() {
    if (!editor || !canSend || postcardNeedsMessage) return
    setSending(true)
    setError(null)

    const finalDoc = editor.getJSON() as LetterDocJSON
    const body = docToPlainBody(finalDoc)
    const momentDrafts = docToMomentDrafts(finalDoc)
    // Letter-Level Postcards V1 — a SEPARATE payload from p_moments,
    // never inserted into it: p_moments carries Photo Moments only for
    // new composition. Blank revealLine/backMessage are sent as null,
    // never an empty string, matching this RPC boundary's existing
    // convention of an explicit null over an empty-but-present value
    // (see toMomentRpcPayload's own doc comment for the same principle
    // applied to a Moment's opposite field).
    const postcardPayload = postcardDraft
      ? {
          postcard_key: postcardDraft.postcardKey,
          reveal_line: postcardDraft.revealLine.trim().length > 0 ? postcardDraft.revealLine : null,
          back_message: postcardDraft.backMessage.trim().length > 0 ? postcardDraft.backMessage : null,
        }
      : null

    // try/finally so a thrown rejection (network failure, etc.) —
    // never just an RPC-level {error} response, which was already
    // handled below regardless — can't leave `sending` stuck true
    // forever, which would otherwise permanently disable Send for the
    // rest of this composer's lifetime (submitting is part of
    // canSendLetter's own eligibility check).
    try {
      const supabase = createClient()
      const { error: sendError } = await supabase.rpc('write_letter', {
        p_correspondence_id: correspondenceId,
        p_body: body,
        p_reply_to_id: replyToId ?? null,
        // toMomentRpcPayload (lib/moments.ts) translates the internal
        // camelCase MomentDraft into the RPC's actual snake_case wire
        // contract right at this boundary.
        p_moments: momentDrafts.map(toMomentRpcPayload),
        p_postcard: postcardPayload,
      })

      if (sendError) {
        // Logged in full regardless of environment, so a real failure
        // can be diagnosed from devtools/error reporting.
        console.error('[moments] send failed', {
          message: sendError.message,
          code: sendError.code,
          details: sendError.details,
          hint: sendError.hint,
          correspondenceId,
          replyToId: replyToId ?? null,
          momentCount: momentDrafts.length,
          hasPostcard: Boolean(postcardPayload),
        })
        // Account enforcement messaging (pre-beta UX polish batch 1) —
        // priority order matters here:
        //  1. suspended/banned fully block Write Anytime — the
        //     caller's OWN already-known status (never decoded from
        //     the RPC's shared message) is entitled to a calm, direct
        //     explanation.
        //  2. write_letter's own 'Correspondence not found.' text is
        //     deliberately shared by blocked-pair AND suspended/banned
        //     AND genuine not-found, so it can never be decoded to
        //     reveal WHICH — mapped to equally neutral TEMPA wording
        //     instead of the generic retry-implying fallback.
        //  3. restricted blocks ONLY a Moment/Postcard attachment here
        //     (see write_letter's own restricted-only checks), never
        //     plain text — so this is the one status that must NOT use
        //     accountBlockedMessage's "restricted from sending
        //     letters" claim, which would be inaccurate for this
        //     composer.
        //  4. anything else keeps the existing generic fallback (with
        //     dev-only detail), unchanged.
        let enforcedMessage: string | null = null
        if (myStatus === 'suspended' || myStatus === 'banned') {
          enforcedMessage = accountBlockedMessage(myStatus)
        } else if (sendError.message === 'Correspondence not found.') {
          enforcedMessage = CORRESPONDENCE_CLOSED_MESSAGE
        } else if (myStatus === 'restricted' && (momentDrafts.length > 0 || postcardPayload)) {
          enforcedMessage = RESTRICTED_ATTACHMENT_MESSAGE
        }

        // The user-facing copy stays generic in production — same
        // established convention as question-answer.tsx's handlePublish
        // and profile-form.tsx — but in development the actual
        // code/message/details/hint are appended right on screen so a
        // live-test failure doesn't require opening devtools to
        // diagnose. This is instrumentation only: it changes nothing
        // about write_letter, its RAISE EXCEPTION paths, or what gets
        // sent.
        setError(
          (enforcedMessage ?? 'Could not send your letter. Please try again.') +
            (process.env.NODE_ENV === 'development'
              ? ` (${sendError.code ?? 'no code'}: ${sendError.message}${
                  sendError.details ? ` — ${sendError.details}` : ''
                }${sendError.hint ? ` — hint: ${sendError.hint}` : ''})`
              : '')
        )
        return
      }

      clearLetterEditorDraft(correspondenceId)
      clearLetterPostcardDraft(correspondenceId)
      router.push(cancelHref)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[moments] send threw', {
        message,
        correspondenceId,
        replyToId: replyToId ?? null,
      })
      setError(
        'Could not send your letter. Please try again.' +
          (process.env.NODE_ENV === 'development' ? ` (threw: ${message})` : '')
      )
    } finally {
      setSending(false)
    }
  }

  // This composer is now its own dedicated route, not an overlay atop
  // the reader — "Review photo" is always a real navigation to wherever
  // the locked Moment actually lives (see
  // getFirstLockedPhotoLetterMoment, lib/letters.ts), never a same-page
  // scroll.
  function handleReviewPhoto() {
    if (!reviewPhotoHref) return
    router.push(reviewPhotoHref)
  }

  // Part B/D: the SAME canonical resolveLetterPhotoUrl the editor's own
  // restored-photo NodeView uses (photo-moment-node.tsx) — Preview never
  // invents a second signing path. Descriptors are extracted fresh from
  // the live document at the moment Preview letter is pressed, so this
  // always reflects exactly what's on screen, including anything typed
  // or attached since the last render.
  async function handleOpenPreview() {
    if (!editor || preparingPreview) return
    setPreparingPreview(true)
    try {
      const descriptors = docToDraftMomentDescriptors(editor.getJSON() as LetterDocJSON)
      const supabase = createClient()
      const resolved = await resolveDraftPreviewMoments(descriptors, (imagePath) =>
        resolveLetterPhotoUrl(supabase, imagePath)
      )
      setPreviewMoments(resolved)
    } finally {
      setPreparingPreview(false)
    }
  }

  return (
    <div className="space-y-4">
      <PhotoSourceInputs
        libraryInputRef={libraryInputRef}
        cameraInputRef={cameraInputRef}
        onChange={handleFileChosen}
      />

      {/* Onboarding & First-Use checkpoint (Checkpoint 2B) — shown once,
          at the point of first encountering the Postcard slot, and only
          once it's actually usable (momentsQualified) — never on every
          composer render before Postcards have genuinely been
          approached. Same shared 'postcard' guide key as the Dispatch
          composer's own introduction; completing/dismissing it on
          either surface prevents it reappearing on the other. */}
      {momentsQualified && showPostcardIntro && !postcardDraft && (
        <FeatureIntroduction guideKey="postcard" title="Send something from somewhere" ctaLabel="Choose a Postcard">
          <p>
            Postcards are little keepsakes you can tuck into a Letter or Dispatch. Choose one,
            write something on the front, then leave something more on the back for the reader
            to discover.
          </p>
        </FeatureIntroduction>
      )}

      {/* Letter-Level Postcards V1 — the letterhead enclosure slot, sitting
          above the writing surface and entirely outside the ProseMirror
          document, never inline prose. */}
      <PostcardComposerSlot
        draft={postcardDraft}
        catalogEntry={postcardCatalogEntry}
        disabled={!momentsQualified}
        onAdd={() => setPostcardPickerOpen(true)}
        onEdit={() => {
          setPostcardEditorStartOnBack(false)
          setPostcardEditorOpen(true)
        }}
      />

      <div className="space-y-2">
        <WritingToolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>

      {uploadingIndex !== null && <p className={helperTextClass}>Adding photo…</p>}

      {/* Moment menu anchoring fix (pre-beta UX polish batch 1) —
          spatially anchored to the tapped ⊕ itself (see
          moment-source-menu.tsx) rather than pinned to the bottom of a
          possibly very long letter, where a mobile writer could tap ⊕
          far up the page and never notice anything opened. */}
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
          senderPseudonym={senderPseudonym}
          onChange={setPostcardDraftAndPersist}
          onChangePostcard={() => {
            setPostcardEditorOpen(false)
            setPostcardPickerOpen(true)
          }}
          onRemove={removePostcard}
          onDone={() => setPostcardEditorOpen(false)}
          startOnBack={postcardEditorStartOnBack}
        />
      )}

      {pendingFirstPhoto && (
        <div className="space-y-3 rounded-md border border-foreground/10 p-4">
          <img
            src={pendingFirstPhoto.previewUrl}
            alt=""
            className="max-h-40 w-full rounded-md object-contain"
          />
          <p className="text-[14px] font-semibold text-foreground">
            Your first photo in this correspondence
          </p>
          <p className={helperTextClass}>
            You can include this photo now. Before it becomes visible, {recipientPseudonym} will be
            asked whether they&apos;re comfortable exchanging photos with you. Your letter will still
            be delivered normally.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmFirstPhoto} className={secondaryButtonClass}>
              Include this photo
            </button>
            <button type="button" onClick={cancelFirstPhoto} className={helperTextClass}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!momentsQualified && (
        <TempaNote>Moments aren&apos;t available in this correspondence yet.</TempaNote>
      )}
      {momentsQualified && !canSendPhoto && photoDecisionOutstandingForMe && (
        <div className="space-y-1.5">
          <p className={helperTextClass}>
            A photo is waiting for your decision before you can share photos here.
          </p>
          {reviewPhotoHref && (
            <button type="button" onClick={handleReviewPhoto} className={`${helperTextClass} underline`}>
              Review photo
            </button>
          )}
        </div>
      )}
      {momentsQualified && !canSendPhoto && !photoDecisionOutstandingForMe && (
        <TempaNote>Photo sharing isn&apos;t available in this correspondence right now.</TempaNote>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Link href={cancelHref} className={secondaryButtonClass}>
          Back
        </Link>
        {/* WRITE → PREVIEW → SEND: the composer's own primary/final
            action is now Preview, never a direct send — Send itself
            only ever happens from inside LetterPreview below, which
            calls this exact same handleSend, never a second
            implementation. */}
        <button
          type="button"
          onClick={handleOpenPreview}
          disabled={!canSend || preparingPreview}
          className={primaryButtonClass}
        >
          {preparingPreview ? 'Preparing…' : 'Preview letter'}
        </button>
      </div>

      {previewMoments && (
        <LetterPreview
          body={docToPlainBody(docJSON)}
          moments={previewMoments}
          postcard={postcardDraft}
          postcardCatalogEntry={postcardCatalogEntry}
          senderPseudonym={senderPseudonym}
          recipientPseudonym={recipientPseudonym}
          onClose={() => setPreviewMoments(null)}
          onSend={handleSend}
          sending={sending}
          sendBlockedReason={
            postcardNeedsMessage ? 'Write something on the back of your postcard before sending.' : null
          }
          onEditPostcard={() => {
            setPostcardEditorStartOnBack(true)
            setPostcardEditorOpen(true)
          }}
          error={error}
        />
      )}
    </div>
  )
}
