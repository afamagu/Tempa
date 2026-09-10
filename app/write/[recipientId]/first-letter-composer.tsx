'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { createClient } from '@/lib/supabase/client'
import {
  sectionLabelClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  proseSubheadingClass,
  contextQuestionClass,
} from '@/app/profile/ui'
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
import WritingToolbar from '@/app/letters/writing-toolbar'
import { docToPlainBody, canSendLetter, EMPTY_LETTER_DOC, type LetterDocJSON } from '@/lib/letter-editor-doc'
import { QUESTION_ANSWER_MAX_CHARS } from '@/lib/questions'
import {
  readFirstContactDraft,
  writeFirstContactDraft,
  clearFirstContactDraft,
} from '@/lib/letter-editor-draft'
import { getMyAccountStatus, accountBlockedMessage, type AccountStatus } from '@/lib/account-status'

// Length-policy audit (2026-09-05): was a locally hard-coded 4000,
// independent of the Question-answer cap — now the SAME canonical
// constant (see its own doc comment, lib/questions.ts) so the two
// values can never silently drift. A stranger's unsolicited first
// letter is capped the same as their Minds answer, and only for that
// reason — this is not a coincidence to be re-derived independently.
const MAX_CHARS = QUESTION_ANSWER_MAX_CHARS
const CHAR_WARNING_THRESHOLD = 1750

function charLength(text: string) {
  return Array.from(text).length
}

/**
 * The very first letter to someone — always text-only (no Moments;
 * that rule is about photo/postcard eligibility, not editor
 * technology). Built on the SAME shared Tiptap schema as the other two
 * letter composers (writing-extensions.ts) so Bold/Italic/Emoji work
 * identically everywhere a member writes to another person.
 *
 * Draft persistence (added in the writing-essentials compatibility
 * audit — this composer previously had none at all): reuses the exact
 * same rich-JSON draft architecture the Write Anytime composer already
 * has (lib/letter-editor-draft.ts), scoped by recipientId rather than
 * correspondenceId, since no correspondence exists yet before Letter 1
 * is sent. A different recipientId is a genuinely different
 * localStorage key, so a draft begun for one recipient can never
 * surface in a different recipient's composer. Cleared only on a
 * successful send to THIS recipient — never touches any other
 * recipient's own draft.
 */
export default function FirstLetterComposer({
  recipientId,
  recipientPseudonym,
  questionAnswerId,
  questionPrompt,
}: {
  recipientId: string
  recipientPseudonym: string
  questionAnswerId: string
  questionPrompt: string | null
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Account enforcement messaging (pre-beta UX polish batch 1) — the
  // CALLER's own status only (see getMyAccountStatus's own doc
  // comment), fetched once on mount purely so a blocked send can show
  // calm, accurate copy instead of the generic retry-implying fallback.
  // Never used to gate rendering the composer itself — send_first_letter
  // remains the actual authority on whether the attempt succeeds.
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

  const editor = useEditor({
    immediatelyRender: false,
    // Root cause of the Send-button regression: @tiptap/react's
    // useEditor() does NOT re-render its host component on typing/
    // formatting by default — the editor mutates the contenteditable
    // DOM directly via ProseMirror, entirely outside React's render
    // cycle, which is exactly why typing/Bold/Italic/Emoji all LOOKED
    // like they worked while canSend (computed from editor.getJSON()
    // in the render body) stayed frozen at its first-render value.
    // shouldRerenderOnTransaction is Tiptap's own officially supported
    // opt-in for this — re-renders on every transaction (content AND
    // selection), which is also what keeps the toolbar's Bold/Italic
    // aria-pressed state correctly in sync as the caret moves.
    shouldRerenderOnTransaction: true,
    extensions: [...baseWritingExtensions(), Placeholder.configure({ placeholder: 'Begin writing…' })],
    content: EMPTY_LETTER_DOC,
    editorProps: {
      attributes: {
        class:
          'min-h-64 w-full rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-4',
      },
    },
    onUpdate({ editor: current }) {
      writeFirstContactDraft(recipientId, current.getJSON() as LetterDocJSON)
    },
  })

  // Restored after mount, not as the editor's initial `content` — same
  // SSR-hydration-mismatch reasoning as moments-composer.tsx. Keyed by
  // recipientId, so navigating between two different first-contact
  // composers never shows the wrong draft.
  useEffect(() => {
    if (!editor) return
    const draft = readFirstContactDraft(recipientId)
    if (draft) editor.commands.setContent(draft)
  }, [editor, recipientId])

  // The SAME editor.getJSON() call feeds the button's enable state,
  // the character count, and (in handleSend) the actual submitted
  // body — one canonical source, never a separately-maintained string.
  const docJSON = (editor?.getJSON() as LetterDocJSON | undefined) ?? EMPTY_LETTER_DOC
  const charCount = charLength(docToPlainBody(docJSON))
  const aboveMax = charCount > MAX_CHARS
  const canSend = Boolean(editor) && canSendLetter(docJSON, { aboveMax, submitting: sending })
  const showCharCount = charCount >= CHAR_WARNING_THRESHOLD

  async function handleSend() {
    if (!editor || !canSend) return
    setSending(true)
    setError(null)

    const body = docToPlainBody(editor.getJSON() as LetterDocJSON)

    // try/finally so a thrown rejection (never just an RPC-level
    // {error} response, already handled below) can't leave `sending`
    // stuck true forever — canSendLetter treats submitting as part of
    // its own eligibility check, so a stuck `sending` would otherwise
    // permanently disable Send.
    try {
      const supabase = createClient()
      const { error: sendError } = await supabase.rpc('send_first_letter', {
        p_recipient_id: recipientId,
        p_question_answer_id: questionAnswerId,
        p_body: body,
      })

      if (sendError) {
        console.error('[letters] send failed', {
          message: sendError.message,
          code: sendError.code,
        })
        if (sendError.code === '23505') {
          setError(`You've already written to ${recipientPseudonym}.`)
        } else {
          // restricted/suspended/banned all fully block a first-contact
          // letter (send_first_letter), sharing one deliberately vague
          // RPC message with "recipient does not exist"/blocked-pair so
          // none of those is distinguishable from the others (see that
          // RPC's own comment) — accountBlockedMessage only ever fires
          // here from the caller's OWN already-known status, never by
          // decoding that shared message, so it can't affect what a
          // genuinely unrelated failure (recipient truly gone, or
          // blocked) still shows.
          setError(accountBlockedMessage(myStatus) ?? 'Could not send your letter. Please try again.')
        }
        return
      }

      clearFirstContactDraft(recipientId)
      setSent(true)
    } catch (err) {
      console.error('[letters] send threw', {
        message: err instanceof Error ? err.message : String(err),
        recipientId,
      })
      setError('Could not send your letter. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 py-10 text-center">
          <p className={sectionLabelClass}>Sent</p>
          <p className="text-lg leading-relaxed">
            Your letter to {recipientPseudonym} has been sent.
          </p>
          <Link href="/minds" className={secondaryButtonClass}>
            Back to Minds
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <div className="space-y-2">
          <p className={sectionLabelClass}>Writing to</p>
          <h1 className={proseSubheadingClass}>{recipientPseudonym}</h1>
          {/* Explicit framing — a live-test report described this
              screen as "answering a Question" (it isn't; it's a letter
              to recipientPseudonym, prompted by THEIR answer). This
              screen and the Question-answer screen (app/question/
              question-answer.tsx) both show a Question prompt, which
              is exactly what made them easy to conflate — this label
              is the fix, not a button-text change, since "Send letter"
              is correct for what this screen actually does. */}
          {questionPrompt && (
            <div className="space-y-1">
              <p className={helperTextClass}>In response to their answer to:</p>
              <p className={contextQuestionClass}>{questionPrompt}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <WritingToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>

          {showCharCount && (
            <p className={helperTextClass}>
              {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Link href="/minds" className={secondaryButtonClass}>
              Back to Minds
            </Link>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={primaryButtonClass}
            >
              {sending ? 'Sending…' : 'Send letter'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
