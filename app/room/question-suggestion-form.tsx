'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass, secondaryButtonClass, helperTextClass, inputClass } from '@/app/profile/ui'

export default function QuestionSuggestionForm() {
  const t = useTranslations('RoomEngagement')
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [credit, setCredit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit() {
    if (busy) return
    const value = question.trim()
    if (value.length < 10) {
      setError(t('invalidSuggestion'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error: submitError } = await createClient().rpc('submit_room_question_suggestion', {
        p_question: value,
        p_credit_if_used: credit,
      })
      if (submitError) {
        setError(t('suggestFailed'))
        return
      }
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
        <p className={`mt-1 ${helperTextClass}`}>{t('reviewNote')}</p>
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
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            maxLength={500}
            className={inputClass}
            placeholder={t('suggestPlaceholder')} aria-label={t('suggestHeading')}
            autoFocus
          />
          <label className="flex items-start gap-2 text-sm text-foreground/75">
            <input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} className="mt-1" />
            <span>{t('creditMe')}</span>
          </label>
          <p className={helperTextClass}>{t('suggestNote')}</p>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy} className={secondaryButtonClass}>
              {t('cancel')}
            </button>
            <button type="button" onClick={submit} disabled={busy} className={primaryButtonClass}>
              {busy ? t('sending') : t('sendSuggestion')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
