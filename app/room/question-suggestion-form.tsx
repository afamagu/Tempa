'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { publishMemberQuestion } from '@/app/member-questions/actions'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import { primaryButtonClass, secondaryButtonClass, helperTextClass, inputClass } from '@/app/profile/ui'

export default function QuestionSuggestionForm() {
  const t = useTranslations('RoomEngagement')
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [credit, setCredit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pendingReview, setPendingReview] = useState(false)
  const [warning, setWarning] = useState<{ copyKey?: string } | null>(null)

  async function submit(acknowledged = false) {
    if (busy) return
    const value = question.trim()
    if (value.length < 10) {
      setError(t('invalidSuggestion'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await publishMemberQuestion(value, credit, acknowledged)
      if (result.error) { setError(result.error); return }
      if (result.warning) { setWarning({ copyKey: result.copyKey }); return }
      setWarning(null)
      setPendingReview(result.pending === true)
      setSent(true)
      setQuestion('')
    } catch {
      setError(t('suggestFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-foreground/10 bg-surface-shell p-5 sm:p-6" role="status">
        <p className="font-serif text-xl text-foreground">{t('thanks')}</p>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/70">{pendingReview
          ? 'Your question is saved and awaiting review. Only you can see it until it is approved. Manage it on your profile.'
          : 'Your question is on your profile. Other members can write to you about it, and Tempa may select it for the Room. Manage it on your profile.'}</p>
      </div>
    )
  }

  return (
    <section className="space-y-3 border-t border-foreground/10 pt-8" aria-labelledby="suggest-question-heading">
      <h2 id="suggest-question-heading" className="max-w-lg font-serif text-xl leading-tight text-foreground sm:text-2xl">{t('suggestHeading')}</h2>
      <p className="max-w-prose text-sm leading-relaxed text-foreground/65">{t('suggestDescription')}</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
          {t('suggestOne')}
        </button>
      ) : (
        <div className="mt-4 space-y-4 rounded-lg border border-foreground/10 bg-surface-shell p-4 text-foreground sm:p-5">
          <textarea
            value={question}
            onChange={(event) => { setQuestion(event.target.value); setWarning(null) }}
            rows={4}
            maxLength={500}
            className={inputClass}
            placeholder={t('suggestPlaceholder')} aria-label={t('suggestHeading')}
            autoFocus
          />
          <label className="flex items-start gap-2 text-sm text-foreground/75">
            <input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} className="mt-1" />
            <span>Show my name and Mark if this becomes the Room question.</span>
          </label>
          <p className={helperTextClass}>Your question will also appear on your profile, inviting people to write to you. Up to three questions are shown; older questions stay saved. You can hide or remove a question on your profile.</p>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy} className={secondaryButtonClass}>
              {t('cancel')}
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy} className={primaryButtonClass}>
              {busy ? t('sending') : t('sendSuggestion')}
            </button>
          </div>
        </div>
      )}
      <SafetyWarningDialog open={warning !== null} copyKey={warning?.copyKey} onCancel={() => setWarning(null)} onAcknowledgeAndSend={() => void submit(true)} sending={busy} actionLabel="Publish anyway" />
    </section>
  )
}
