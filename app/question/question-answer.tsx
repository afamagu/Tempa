'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePublicMentions } from '@/app/use-public-mentions'
import { mentionPublicationRpc } from '@/lib/public-mentions'
import CorrespondentPicker from '@/app/correspondent-picker'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import {
  sectionLabelClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  proseSubheadingClass,
  contextQuestionClass,
} from '@/app/profile/ui'
import AuthoredProse from '@/app/authored-prose'
import ContinueLater from '@/app/profile/question/continue-later'
import { WRITING_STYLE_ONBOARDING_HREF } from '@/lib/onboarding'
import { questionSaveConfirmationCopy, QUESTION_ANSWER_MAX_CHARS, type LibraryQuestion } from '@/lib/questions'
import { insertAtCursor } from '@/lib/textarea-insert'
import EmojiPicker from '@/app/letters/emoji-picker'
import { evaluateSafety, SAFETY_FINANCIAL_REQUEST_COPY_KEY } from '@/lib/safety/send-with-safety'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import SafetyBlockedDialog from '@/app/safety-blocked-dialog'

const MAX_CHARS = QUESTION_ANSWER_MAX_CHARS
const CHAR_WARNING_THRESHOLD = 1750

function charLength(text: string) { return Array.from(text).length }
function draftKey(questionId: string, userId: string) { return `tempa-question-draft:${questionId}:${userId}` }
function readDraft(questionId: string, userId: string): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(draftKey(questionId, userId)) } catch { return null }
}

export default function QuestionAnswer({
  userId,
  questionId,
  prompt,
  initialAnswer,
  isFlagship = false,
  isActive = true,
  editable,
  nextQuestion = null,
  onboarding = false,
  writingStyleId = null,
}: {
  userId: string
  questionId: string
  prompt: string
  initialAnswer: string | null
  isFlagship?: boolean
  isActive?: boolean
  /** UI permission hint. The RPC remains the authority. False for a
   * retired Question or a moderation-frozen existing response. */
  editable?: boolean
  /** Retained temporarily for call-site compatibility while the old
   * three-slot Question model is retired. */
  nextQuestion?: LibraryQuestion | null
  onboarding?: boolean
  writingStyleId?: string | null
}) {
  void nextQuestion
  const t = useTranslations('Question')
  const router = useRouter()
  const canEditResponse = editable ?? isActive
  const [mode, setMode] = useState<'view' | 'edit'>(initialAnswer || !canEditResponse ? 'view' : 'edit')
  const [publishedBody, setPublishedBody] = useState(initialAnswer)
  const hadExistingAnswer = initialAnswer !== null
  const [body, setBody] = useState(() => readDraft(questionId, userId) ?? initialAnswer ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [pendingWarning, setPendingWarning] = useState<{ evaluationId: string; copyKey?: string } | null>(null)
  const [financialBlocked, setFinancialBlocked] = useState(false)

  const mentions = usePublicMentions(`${draftKey(questionId, userId)}:public`)
  const charCount = charLength(body)
  const hasContent = body.trim().length > 0
  const aboveMax = charCount > MAX_CHARS
  const canPublish = canEditResponse && hasContent && !aboveMax && !saving
  const showCharCount = charCount >= CHAR_WARNING_THRESHOLD
  const hasPublishedView = mode === 'view' && Boolean(publishedBody)
  const promptClass = hasPublishedView ? contextQuestionClass : proseSubheadingClass
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  function updateBody(next: string) {
    setBody(next)
    try { window.localStorage.setItem(draftKey(questionId, userId), next) } catch { /* ignore */ }
  }
  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    const { value: next, cursor } = insertAtCursor(body, start, end, emoji)
    updateBody(next)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(cursor, cursor) })
  }

  async function handlePublish() {
    if (!canPublish) return
    setSaving(true); setError(null)
    const trimmed = body.trim()
    const outcome = await evaluateSafety({ surface: 'question_answer', questionId, body: trimmed })
    if (outcome.status === 'error') { setError(t('saveFailed')); setSaving(false); return }
    if (outcome.status === 'cannot_send') {
      if (outcome.copyKey === SAFETY_FINANCIAL_REQUEST_COPY_KEY) setFinancialBlocked(true)
      else setError(t('saveFailed'))
      setSaving(false); return
    }
    if (outcome.status === 'warning_required') {
      setPendingWarning({ evaluationId: outcome.evaluationId, copyKey: outcome.copyKey })
      setSaving(false); return
    }
    await saveAnswer(outcome.evaluationId, false)
  }

  async function saveAnswer(safetyEvaluationId: string, warningAcknowledged: boolean) {
    if (!canEditResponse) return
    setSaving(true)
    setError(null)

    const trimmed = body.trim()
    const { error: publishError } = await createClient().rpc(...mentionPublicationRpc('publish_question_answer', {
      p_question_id: questionId,
      p_body: trimmed,
      p_safety_evaluation_id: safetyEvaluationId,
      p_warning_acknowledged: warningAcknowledged,
    }, mentions.retained(trimmed)))
    setSaving(false)
    if (publishError) {
      console.error('[question] publish failed', { code: publishError.code })
      setError(t('saveFailed'))
      return
    }
    try { window.localStorage.removeItem(draftKey(questionId, userId)) } catch { /* ignore */ }
    setPendingWarning(null)
    setConfirmation(questionSaveConfirmationCopy(isFlagship, hadExistingAnswer))
    setPublishedBody(trimmed)
    setBody(trimmed)
    setMode('view')
    mentions.clear()
    if (!onboarding) router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <div className="space-y-3">
          <p className={sectionLabelClass}>{isFlagship ? t('firstQuestion') : t('question')}</p>
          <h1 className={promptClass}>{prompt}</h1>
        </div>

        {onboarding && mode === 'edit' && !publishedBody && <ContinueLater disabled={saving} />}

        {mode === 'view' && publishedBody && onboarding && confirmation ? (
          <div className="space-y-8">
            <div className="space-y-4">
              <h2 className={proseSubheadingClass}>{t('roomHeading')}</h2>
              <p className={helperTextClass}>{t('roomIntro')}</p>
              <div className="rounded-md bg-surface-shell p-4 sm:p-5"><AuthoredProse styleId={null}><p className="whitespace-pre-wrap">{publishedBody}</p></AuthoredProse></div>
            </div>
            <div className="flex flex-wrap gap-3"><Link href={WRITING_STYLE_ONBOARDING_HREF} className={primaryButtonClass}>{t('continue')}</Link></div>
          </div>
        ) : mode === 'view' && publishedBody ? (
          <div className="space-y-8">
            <div className="space-y-4">
              {confirmation && <p className={helperTextClass}>{confirmation}</p>}
              <p className={helperTextClass}>{isActive ? t('published') : t('closed')}</p>
              <div className="rounded-md bg-surface-shell p-4 sm:p-5"><AuthoredProse styleId={writingStyleId}><p className="whitespace-pre-wrap">{publishedBody}</p></AuthoredProse></div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={isFlagship ? '/room' : '/you/archive?tab=responses'} className={secondaryButtonClass}>
                {isFlagship ? t('enterRoom') : t('backResponses')}
              </Link>
              {canEditResponse && (
                <button
                  type="button"
                  onClick={() => { setConfirmation(null); setMode('edit') }}
                  className={secondaryButtonClass}
                >
                  {t('editResponse')}
                </button>
              )}
            </div>
          </div>
        ) : mode === 'view' && !canEditResponse ? (
          <div className="space-y-8">
            <p className={helperTextClass}>{t('unansweredClosed')}</p>
            <Link href="/room" className={secondaryButtonClass}>{t('backRoom')}</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {onboarding && !hadExistingAnswer && <div className="space-y-2 border-l-2 border-clay/50 pl-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">{t('oneLastThing')}</p>
              <div className={`italic ${helperTextClass}`}><p>{t('onboardingIntro')}</p><p className="mt-2"><strong className="font-semibold text-foreground/75">{t('specificity')}</strong></p></div>
            </div>}
            <div className="flex items-center gap-1 border-b border-foreground/10 pb-2"><EmojiPicker onSelect={insertEmoji} /></div>
            <CorrespondentPicker onChange={updateBody} maxLength={MAX_CHARS} onSelect={mentions.select}><textarea ref={textareaRef} value={body} onChange={(e) => updateBody(e.target.value)} rows={16} placeholder={t('beginWriting')} className="w-full resize-y rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors placeholder:font-sans placeholder:text-base placeholder:text-muted focus:border-accent" /></CorrespondentPicker>
            {showCharCount && <p className={helperTextClass}>{charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-3">
              {!(onboarding && !hadExistingAnswer) && (
                <Link href={isFlagship ? '/room' : '/you/archive?tab=responses'} className={secondaryButtonClass}>
                  {isFlagship ? t('backRoom') : t('backResponses')}
                </Link>
              )}
              <button type="button" onClick={handlePublish} disabled={!canPublish} className={primaryButtonClass}>
                {saving ? t('saving') : t('saveResponse')}
              </button>
            </div>
          </div>
        )}
      </div>
      <SafetyWarningDialog open={pendingWarning !== null} copyKey={pendingWarning?.copyKey} onCancel={() => setPendingWarning(null)} onAcknowledgeAndSend={() => pendingWarning && saveAnswer(pendingWarning.evaluationId, true)} sending={saving} actionLabel={t('saveAnyway')} sendingLabel={t('saving')} />
      <SafetyBlockedDialog open={financialBlocked} onClose={() => setFinancialBlocked(false)} />
    </main>
  )
}

