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
  dispatchBodyToDoc,
  canSendLetter,
  stripRichBodyMarker,
  EMPTY_LETTER_DOC,
  type LetterDocJSON,
} from '@/lib/letter-editor-doc'
import { readDispatchDraft, writeDispatchDraft, clearDispatchDraft } from '@/lib/letter-editor-draft'
import {
  dispatchTitleError,
  normalizeTopics,
  publishDispatch,
  updateDispatch,
  type DispatchMomentDraft,
  type PublishDispatchError,
} from '@/lib/dispatches'
import { processImageForUpload } from '@/lib/image-processing'
import { DispatchPhotoMoment } from './dispatch-photo-moment-node'
import { MomentAffordance } from '@/app/letters/[letterId]/moment-affordance-extension'
import PhotoSourceInputs, { selectPhotoSourceRef } from '@/app/letters/[letterId]/photo-source-inputs'
import TopicInput from './topic-input'

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
}

/**
 * The Dispatch composer — title, body (Bold/Italic/Emoji via the same
 * shared Tiptap schema every letter composer uses), up to 3 topics, and
 * optional still-image Moments. No length UI anywhere: Dispatches carry
 * no product-facing character cap (see dispatchTitleError for the one
 * genuine, visible limit — the title). No Postcard entry point here —
 * Postcards remain private-correspondence-only.
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
  mode = 'create',
  existingDispatch,
}: {
  authorId: string
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
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null)

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
        onRequestPhoto: (index) => setOpenPickerIndex(index),
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
  const canSubmit =
    Boolean(editor) &&
    titleError === null &&
    canSendLetter(docJSON, { aboveMax: false, submitting: publishing }) &&
    !uploadingIndex

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
    if (openPickerIndex === null) return
    pendingTargetRef.current = openPickerIndex
    setOpenPickerIndex(null)
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
    if (!editor || !canSubmit) return
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
      const { data, error: submitError } =
        isEdit && existingDispatch
          ? await updateDispatch(createClient(), existingDispatch.id, { title, body, topics, moments })
          : await publishDispatch(createClient(), { title, body, topics, moments })

      if (submitError || !data) {
        console.error(isEdit ? '[board] edit failed' : '[board] publish failed', {
          code: submitError?.code,
          message: submitError?.message,
          details: submitError?.details,
          hint: submitError?.hint,
        })
        const devDetail = process.env.NODE_ENV === 'development' ? formatDevErrorDetail(submitError) : ''
        setError(`${genericErrorMessage}${devDetail}`)
        return
      }

      if (!isEdit) clearDispatchDraft(authorId)
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

        <div className="space-y-2">
          <WritingToolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>

        {uploadingIndex !== null && <p className={helperTextClass}>Adding photo…</p>}

        {openPickerIndex !== null && (
          <div className="fixed inset-x-0 bottom-0 z-50 space-y-2 rounded-t-lg border-t border-foreground/10 bg-background p-4 shadow-lg">
            <button type="button" onClick={() => chooseSource(false)} className={secondaryButtonClass}>
              Choose from library
            </button>
            <button type="button" onClick={() => chooseSource(true)} className={secondaryButtonClass}>
              Take a photo
            </button>
            <button type="button" onClick={() => setOpenPickerIndex(null)} className={helperTextClass}>
              Cancel
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          <p className={sectionLabelClass}>Topics (optional, up to 3)</p>
          <TopicInput topics={topics} onChange={handleTopicsChange} />
        </div>

        {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <Link href={backHref} className={secondaryButtonClass}>
            Back
          </Link>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit} className={primaryButtonClass}>
            {publishing ? (isEdit ? 'Saving…' : 'Publishing…') : isEdit ? 'Save changes' : 'Publish Dispatch'}
          </button>
        </div>
      </div>
    </main>
  )
}
