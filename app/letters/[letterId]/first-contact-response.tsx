'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { createClient } from '@/lib/supabase/client'
import ChoiceGroup from '@/app/profile/choice-group'
import { helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import { CLOSE_REASONS } from '@/lib/letters'
import { readLetterDraft, writeLetterDraft, clearLetterDraft } from '@/lib/letter-draft'
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
import WritingToolbar from '@/app/letters/writing-toolbar'
import {
  docToPlainBody,
  canSendLetter,
  markupBodyToLetterDoc,
  EMPTY_LETTER_DOC,
  type LetterDocJSON,
} from '@/lib/letter-editor-doc'
import {
  getMyAccountStatus,
  accountBlockedMessage,
  ACCOUNT_ACTION_UNAVAILABLE_CODE,
  ACCOUNT_RESTRICTED_MESSAGE,
  type AccountStatus,
} from '@/lib/account-status'
import {
  evaluateSafety,
  SAFETY_CANNOT_SEND_MESSAGE,
  SAFETY_CHECK_FAILED_MESSAGE,
  SAFETY_FINANCIAL_REQUEST_COPY_KEY,
} from '@/lib/safety/send-with-safety'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import SafetyBlockedDialog from '@/app/safety-blocked-dialog'
import type { Moment } from '@/lib/moments'
import type { PhotoConsentStatus } from '@/lib/letters'
import SourceLetterPanel from './source-letter-panel'

type Mode = 'choose' | 'reply' | 'close'

/**
 * The one place the OLD strict-alternation mechanism still lives:
 * accepting or declining a first-contact letter, before any
 * correspondence exists to write into (Part D — initial establishment
 * remains special). This is always Letter 2, always plain text — the
 * Letter 1/2 text-only rule holds regardless of Write Anytime — sent
 * through reply_to_letter directly, never write_letter (which only
 * works once established_at is already set, and this call is what
 * sets it). Only ever rendered by page.tsx for the un-replied
 * first-contact letter, viewed by its recipient.
 */
export default function FirstContactResponse({
  letterId,
  correspondenceId,
  recipientPseudonym,
  viewerId,
  sourceLetterBody,
  sourceLetterMoments,
  sourceLetterPhotoConsent,
}: {
  letterId: string
  correspondenceId: string
  recipientPseudonym: string
  /** The current viewer's own id — needed only to key the "View
   * [pseudonym]'s letter" reference panel's reading-position state
   * (lib/reading-places.ts), never sent anywhere; the actual reply
   * still authenticates via auth.uid() inside reply_to_letter, same as
   * before. */
  viewerId: string
  /** The exact source Letter (letterId) being replied to — already
   * fetched by the parent page for its own LetterBody render just
   * above this component, passed through here rather than re-fetched,
   * so "View [pseudonym]'s letter" opens instantly with no extra
   * round-trip. */
  sourceLetterBody: string
  sourceLetterMoments: Moment[]
  sourceLetterPhotoConsent?: {
    correspondenceId: string
    status: PhotoConsentStatus
    requestedBy: string | null
    resolvedBy: string | null
    userId: string
    otherPseudonym: string
  }
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('choose')
  const [sendingReply, setSendingReply] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [showSourceLetter, setShowSourceLetter] = useState(false)
  // Safety 2, Checkpoint 3 — see first-letter-composer.tsx's own
  // identical field for the full explanation.
  const [pendingWarning, setPendingWarning] = useState<{ evaluationId: string; copyKey?: string } | null>(null)
  // Phase 1 — a confirmed financial solicitation is not sendable and has
  // no override; this only ever opens the calm SafetyBlockedDialog.
  const [financialBlocked, setFinancialBlocked] = useState(false)

  const [reason, setReason] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  // Account enforcement messaging (pre-beta UX polish batch 1) — see
  // lib/account-status.ts. Only suspended/banned block this establishing
  // reply (reply_to_letter); restricted does not.
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

  // Same shared Tiptap schema as the other two letter composers
  // (writing-extensions.ts) — Letter 2 stays text-only (no Moments,
  // that rule is about photo eligibility, not editor technology). The
  // draft itself is UNCHANGED: still the plain string lib/letter-
  // draft.ts has always stored, keyed the same way — only the string
  // it may now contain has changed (docToPlainBody's bold/italic
  // markup instead of always-bare text), so an existing plain draft
  // from before this feature shipped still restores correctly via
  // markupBodyToLetterDoc (see that function's own doc comment).
  const editor = useEditor({
    immediatelyRender: false,
    // Send-button reactivity audit (2026-09-05, following the same fix
    // already applied to first-letter-composer.tsx) — see that file's
    // comment for the full explanation. Without this, canSendReply/
    // the toolbar's Bold/Italic active state would be frozen at
    // whatever they were on first render.
    shouldRerenderOnTransaction: true,
    extensions: [
      ...baseWritingExtensions(),
      Placeholder.configure({ placeholder: `Write back to ${recipientPseudonym}…` }),
    ],
    content: EMPTY_LETTER_DOC,
    editorProps: {
      attributes: {
        class:
          'min-h-64 w-full rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-4',
      },
    },
    onUpdate({ editor: current }) {
      writeLetterDraft(correspondenceId, docToPlainBody(current.getJSON() as LetterDocJSON))
    },
  })

  // Restored after mount, not as the editor's initial `content` — same
  // SSR-hydration-mismatch reasoning as moments-composer.tsx.
  useEffect(() => {
    if (!editor) return
    const draft = readLetterDraft(correspondenceId)
    if (draft) editor.commands.setContent(markupBodyToLetterDoc(draft))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Same canonical derivation as first-letter-composer.tsx and
  // moments-composer.tsx: one editor.getJSON() call feeds the button's
  // enable state and the actual submitted body.
  //
  // aboveMax is always false: this reply is the act that ESTABLISHES
  // the correspondence — the same reply_to_letter transaction that
  // inserts it also sets established_at, so it is the correspondence's
  // first established letter, not a "still a stranger" first-contact
  // artifact. The anti-pestering rationale for capping Letter 1 (an
  // unsolicited letter to someone who hasn't agreed to hear from you)
  // doesn't apply here — this person was invited by Letter 1's sender
  // and is choosing to accept. Treated identically to every later
  // Write Anytime letter (moments-composer.tsx), never the
  // stranger/discovery-writing cap first-letter-composer.tsx uses.
  const replyDocJSON = (editor?.getJSON() as LetterDocJSON | undefined) ?? EMPTY_LETTER_DOC
  const canSendReply =
    Boolean(editor) && canSendLetter(replyDocJSON, { aboveMax: false, submitting: sendingReply })

  // Safety 2, Checkpoint 3 — evaluates before ever calling
  // reply_to_letter. Never a Postcard here — this reply is always
  // text-only (see this component's own header comment) — so
  // evaluateSafety's own payload for this surface never carries one. A
  // failed evaluation (status: error) never falls back to an unscreened
  // send.
  async function handleReply() {
    if (!editor || !canSendReply) return
    setSendingReply(true)
    setReplyError(null)

    const body = docToPlainBody(editor.getJSON() as LetterDocJSON)
    const outcome = await evaluateSafety({ surface: 'reply', letterId, body })

    if (outcome.status === 'error') {
      setReplyError(SAFETY_CHECK_FAILED_MESSAGE)
      setSendingReply(false)
      return
    }
    if (outcome.status === 'cannot_send') {
      if (outcome.copyKey === SAFETY_FINANCIAL_REQUEST_COPY_KEY) setFinancialBlocked(true)
      else setReplyError(SAFETY_CANNOT_SEND_MESSAGE)
      setSendingReply(false)
      return
    }
    if (outcome.status === 'warning_required') {
      setPendingWarning({ evaluationId: outcome.evaluationId, copyKey: outcome.copyKey })
      setSendingReply(false)
      return
    }

    await sendReply(outcome.evaluationId, false)
  }

  function handleCancelWarning() {
    setPendingWarning(null)
  }

  async function handleAcknowledgeWarning() {
    if (!pendingWarning) return
    await sendReply(pendingWarning.evaluationId, true)
  }

  async function sendReply(safetyEvaluationId: string, warningAcknowledged: boolean) {
    if (!editor) return
    setSendingReply(true)
    setReplyError(null)

    // Re-read fresh, never a value captured before the warning dialog
    // opened — same reasoning as first-letter-composer.tsx's own
    // sendLetter.
    const body = docToPlainBody(editor.getJSON() as LetterDocJSON)

    // try/finally so a thrown rejection (never just an RPC-level
    // {error} response, already handled below) can't leave
    // sendingReply stuck true forever — canSendLetter treats submitting
    // as part of its own eligibility check, so a stuck sendingReply
    // would otherwise permanently disable Send.
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('reply_to_letter', {
        p_letter_id: letterId,
        p_body: body,
        p_safety_evaluation_id: safetyEvaluationId,
        p_warning_acknowledged: warningAcknowledged,
      })

      if (error) {
        console.error('[letters] first-contact reply failed', { message: error.message, code: error.code })
        // suspended/banned fully block this reply, sharing one
        // deliberately vague RPC message with "not found"/blocked-pair
        // (see reply_to_letter's own comment) — accountBlockedMessage
        // only fires from the caller's OWN already-known status, never
        // by decoding that shared message, so an unrelated failure
        // still shows the existing generic copy.
        setReplyError(
          accountBlockedMessage(myStatus) ??
            (error.code === ACCOUNT_ACTION_UNAVAILABLE_CODE ? ACCOUNT_RESTRICTED_MESSAGE : 'Could not send your reply. Please try again.')
        )
        return
      }

      clearLetterDraft(correspondenceId)
      setPendingWarning(null)
      router.refresh()
    } catch (err) {
      console.error('[letters] first-contact reply threw', {
        message: err instanceof Error ? err.message : String(err),
        letterId,
      })
      setReplyError('Could not send your reply. Please try again.')
    } finally {
      setSendingReply(false)
    }
  }

  async function handleClose() {
    if (!reason) return
    setClosing(true)
    setCloseError(null)

    const supabase = createClient()
    const { error } = await supabase.rpc('close_letter', {
      p_letter_id: letterId,
      p_reason: reason,
    })

    setClosing(false)

    if (error) {
      console.error('[letters] close failed', { message: error.message, code: error.code })
      setCloseError('Could not pass on this letter. Please try again.')
      return
    }

    router.refresh()
  }

  let content: React.ReactNode

  if (mode === 'choose') {
    content = (
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setMode('reply')} className={primaryButtonClass}>
          Reply
        </button>
        <button type="button" onClick={() => setMode('close')} className={secondaryButtonClass}>
          Pass on this letter
        </button>
      </div>
    )
  } else if (mode === 'reply') {
    content = (
      <div className="space-y-4">
        <div>
          {/* Restrained secondary action, never "Quick view" — always
              references THIS specific source letter (letterId), never
              merely the sender's newest one. Opens SourceLetterPanel as
              a sibling overlay; the Tiptap editor below is untouched by
              this open/close, so nothing already typed is ever lost. */}
          <button
            type="button"
            onClick={() => setShowSourceLetter(true)}
            className="text-[13px] text-foreground/60 underline decoration-foreground/20 underline-offset-4 transition-colors hover:text-foreground/90 hover:decoration-foreground/50"
          >
            View {recipientPseudonym}&rsquo;s letter
          </button>
        </div>
        <div className="space-y-2">
          <WritingToolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>
        {replyError && <p className="text-sm text-red-600">{replyError}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setMode('choose')} className={secondaryButtonClass}>
            Back
          </button>
          <button type="button" onClick={handleReply} disabled={!canSendReply} className={primaryButtonClass}>
            {sendingReply ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
    )
  } else {
    content = (
      <div className="space-y-4">
        <div className="space-y-1">
          <p className={helperTextClass}>Why are you passing on this letter?</p>
          <p className={helperTextClass}>This ends this correspondence request.</p>
        </div>
        <ChoiceGroup
          ariaLabel="Reason for passing on this letter"
          options={CLOSE_REASONS.map((r) => ({ value: r, label: r }))}
          selected={reason ? [reason] : []}
          onToggle={setReason}
          layout="card"
        />
        {closeError && <p className="text-sm text-red-600">{closeError}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setMode('choose')} className={secondaryButtonClass}>
            Back
          </button>
          <button type="button" onClick={handleClose} disabled={!reason || closing} className={primaryButtonClass}>
            {closing ? 'Passing…' : 'Pass on this letter'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {content}
      <SourceLetterPanel
        open={showSourceLetter}
        onClose={() => setShowSourceLetter(false)}
        pseudonym={recipientPseudonym}
        viewerId={viewerId}
        letterId={letterId}
        body={sourceLetterBody}
        moments={sourceLetterMoments}
        photoConsent={sourceLetterPhotoConsent}
      />
      <SafetyWarningDialog
        open={pendingWarning !== null}
        copyKey={pendingWarning?.copyKey}
        onCancel={handleCancelWarning}
        onAcknowledgeAndSend={handleAcknowledgeWarning}
        sending={sendingReply}
      />
      <SafetyBlockedDialog open={financialBlocked} onClose={() => setFinancialBlocked(false)} />
    </>
  )
}
