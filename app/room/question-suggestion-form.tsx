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
      <div className="border-t border-foreground/10 pt-6">
        <p className="font-serif text-lg text-foreground">{t('thanks')}</p>
        <p className={`mt-1 ${helperTextClass}`}>Your question is saved. Manage it on your profile. Questions awaiting review appear there only to you.</p>
      </div>
    )
  }

  return (
    <section className="border-t border-foreground/10 pt-6">
      <p className="font-serif text-lg text-foreground">{t('suggestHeading')}</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${secondaryButtonClass} mt-3`}>
          {t('suggestOne')}
        </button>
      ) : (
        <div className="mt-4 space-y-3">
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
          <p className={helperTextClass}>Your question will also appear on your profile, inviting people to write to you. You can hide or remove it there.</p>
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
