'use client'

import { refreshWrittenProfile } from './refresh-profile'


import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useEditor, EditorContent } from '@tiptap/react'
import { useKeyboardDismiss } from '@/app/letters/use-keyboard-dismiss'
import { useEditorVisualViewport } from '@/app/letters/use-editor-visual-viewport'
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
import { baseWritingExtensions, nativeWritingAttributes } from '@/app/letters/writing-extensions'
import WritingToolbar from '@/app/letters/writing-toolbar'
import { docToPlainBody, canSendLetter, EMPTY_LETTER_DOC, type LetterDocJSON } from '@/lib/letter-editor-doc'
import { QUESTION_ANSWER_MAX_CHARS } from '@/lib/questions'
import {
  readFirstContactDraft,
  writeFirstContactDraft,
  clearFirstContactDraft,
} from '@/lib/letter-editor-draft'
import { getMyAccountStatus, accountBlockedMessage, type AccountStatus } from '@/lib/account-status'
import { firstContactCapacityMessage } from '@/lib/relationship-capacity'
import {
  evaluateSafety,
  SAFETY_CANNOT_SEND_MESSAGE,
  SAFETY_CHECK_FAILED_MESSAGE,
  SAFETY_FINANCIAL_REQUEST_COPY_KEY,
} from '@/lib/safety/send-with-safety'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import SafetyBlockedDialog from '@/app/safety-blocked-dialog'

const MAX_CHARS = QUESTION_ANSWER_MAX_CHARS
const CHAR_WARNING_THRESHOLD = 1750

function charLength(text: string) {
  return Array.from(text).length
}

/** The very first letter to someone. Drafts are local to this recipient and
 * sending remains governed by the existing safety evaluation + RPC path. */
export default function FirstLetterComposer({
  recipientId,
  recipientPseudonym,
  questionAnswerId,
  questionPrompt,
  memberQuestionId,
  dispatchId,
  dispatchTitle,
  backHref = '/room',
  backLabel = 'The Room',
}: {
  recipientId: string
  recipientPseudonym: string
  questionAnswerId: string
  memberQuestionId?: string
  dispatchId?: string
  dispatchTitle?: string
  questionPrompt: string | null
  backHref?: string
  backLabel?: string
}) {
  const draftKey = memberQuestionId
    ? `${recipientId}:mq:${memberQuestionId}`
    : dispatchId
      ? `${recipientId}:dispatch:${dispatchId}`
      : recipientId
  const [sending, setSending] = useState(false)
  const composerRootRef = useRef<HTMLElement | null>(null)
  useKeyboardDismiss(composerRootRef)
  useEditorVisualViewport(composerRootRef)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [...baseWritingExtensions(), Placeholder.configure({ placeholder: 'Begin writing…' })],
    content: EMPTY_LETTER_DOC,
    editorProps: {
      attributes: {
        ...nativeWritingAttributes,
        class:
          'min-h-64 w-full rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-4',
      },
    },
    onUpdate({ editor: current }) {
      writeFirstContactDraft(draftKey, current.getJSON() as LetterDocJSON)
    },
  })

  useEffect(() => {
    if (!editor) return
    const draft = readFirstContactDraft(draftKey)
    if (draft) editor.commands.setContent(draft)
  }, [editor, draftKey])

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
    const outcome = await evaluateSafety({ surface: 'first_letter', recipientId, questionAnswerId, body })

    if (outcome.status === 'error') {
      setError(SAFETY_CHECK_FAILED_MESSAGE)
      setSending(false)
      return
    }
    if (outcome.status === 'cannot_send') {
      if (outcome.copyKey === SAFETY_FINANCIAL_REQUEST_COPY_KEY) setFinancialBlocked(true)
      else setError(SAFETY_CANNOT_SEND_MESSAGE)
      setSending(false)
      return
    }
    if (outcome.status === 'warning_required') {
      setPendingWarning({ evaluationId: outcome.evaluationId, copyKey: outcome.copyKey })
      setSending(false)
      return
    }

    await sendLetter(outcome.evaluationId, false)
  }

  function handleCancelWarning() {
    setPendingWarning(null)
  }

  async function handleAcknowledgeWarning() {
    if (!pendingWarning) return
    await sendLetter(pendingWarning.evaluationId, true)
  }

  async function sendLetter(safetyEvaluationId: string, warningAcknowledged: boolean) {
    if (!editor) return
    setSending(true)
    setError(null)
    const body = docToPlainBody(editor.getJSON() as LetterDocJSON)

    try {
      const supabase = createClient()
      const rpcName = memberQuestionId
        ? 'send_first_letter_from_member_question'
        : dispatchId
          ? 'send_first_letter_from_dispatch'
          : 'send_first_letter'

      const { error: sendError } = await supabase.rpc(rpcName, {
        ...(memberQuestionId ? { p_member_question_id: memberQuestionId } : {}),
        ...(dispatchId ? { p_dispatch_id: dispatchId } : {}),
        p_recipient_id: recipientId,
        p_question_answer_id: questionAnswerId,
        p_body: body,
        p_safety_evaluation_id: safetyEvaluationId,
        p_warning_acknowledged: warningAcknowledged,
      })

      if (sendError) {
        console.error('[letters] send failed', {
          message: sendError.message,
          code: sendError.code,
        })
        const capacityMessage = firstContactCapacityMessage(sendError, recipientPseudonym)
        if (capacityMessage) {
          setError(capacityMessage)
        } else if (sendError.code === '23505') {
          setError(`You've already written to ${recipientPseudonym}.`)
        } else {
          setError(accountBlockedMessage(myStatus) ?? 'Could not send your letter. Please try again.')
        }
        return
      }

      clearFirstContactDraft(draftKey)
      setPendingWarning(null)
      await refreshWrittenProfile(recipientId).catch(() => {})
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
      <main className="min-h-screen flex items-start justify-center p-4 sm:items-center sm:p-6">
        <div className="w-full max-w-md space-y-6 py-10 text-center">
          <p className={sectionLabelClass}>Sent</p>
          <p className="text-lg leading-relaxed">
            Your letter to {recipientPseudonym} has been sent.
          </p>
          <Link href={backHref} className={secondaryButtonClass}>
            Back to {backLabel}
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main ref={composerRootRef} className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <div className="space-y-2">
          <p className={sectionLabelClass}>Writing to</p>
          <h1 className={proseSubheadingClass}>{recipientPseudonym}</h1>
          {dispatchId && dispatchTitle ? (
            <div className="space-y-1">
              <p className={helperTextClass}>In response to their Dispatch:</p>
              <p className={contextQuestionClass}>{dispatchTitle}</p>
            </div>
          ) : questionPrompt ? (
            <div className="space-y-1">
              <p className={helperTextClass}>{memberQuestionId ? `A question from ${recipientPseudonym}` : 'In response to their answer to:'}</p>
              <p className={contextQuestionClass}>{questionPrompt}</p>
            </div>
          ) : null}
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
            <Link href={backHref} className={secondaryButtonClass}>
              Back to {backLabel}
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
      <SafetyWarningDialog
        open={pendingWarning !== null}
        copyKey={pendingWarning?.copyKey}
        onCancel={handleCancelWarning}
        onAcknowledgeAndSend={handleAcknowledgeWarning}
        sending={sending}
      />
      <SafetyBlockedDialog open={financialBlocked} onClose={() => setFinancialBlocked(false)} />
    </main>
  )
}