'use client'

import { useState, useTransition } from 'react'
import type { TranslationReadiness, TranslationUsage } from '@/lib/translation/diagnostic'
import { sectionTitleClass, secondaryButtonClass, helperTextClass } from '@/app/profile/ui'
import { adminBodyClass, adminTableTextClass, adminTableSecondaryClass, adminBadgeClass } from '../../admin-ui'
import { runTranslationConnectionTest, type TranslationConnectionTestResult } from './actions'

const FAILURE_LABELS = {
  missing_configuration: 'Missing configuration',
  quota_exhausted: 'Quota exhausted',
  provider_failure: 'Azure / provider failure',
  database_failure: 'Database / quota failure',
} as const

const number = new Intl.NumberFormat('en-US')

function yesNo(value: boolean) {
  return value ? 'yes' : 'no'
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-foreground/10 py-2 last:border-b-0">
      <dt className={adminTableSecondaryClass}>{label}</dt>
      <dd className={adminTableTextClass}>{value}</dd>
    </div>
  )
}

function UsageRows({ usage }: { usage: TranslationUsage | null }) {
  if (!usage) return <Row label="Usage this month" value="Unavailable" />
  return (
    <>
      <Row label={`Reserved this month (from ${usage.monthStart}, UTC)`} value={number.format(usage.reservedCharacters)} />
      <Row label="Tempa monthly ceiling" value={number.format(usage.monthlyLimit)} />
      <Row label="Remaining" value={number.format(usage.remainingCharacters)} />
      <Row label="Used" value={`${usage.percentUsed}%`} />
    </>
  )
}

export function DiagnosticResult({ result }: { result: TranslationConnectionTestResult }) {
  if (result.status === 'forbidden') {
    return <p className="text-sm text-red-600">Only Tempa admins can run the translation connection test.</p>
  }

  const connected = result.status === 'connected'
  return (
    <div className="space-y-3 rounded-md border border-foreground/10 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className={adminBodyClass}>Translator status: {connected ? 'Connected' : 'Failed'}</p>
        <span className={adminBadgeClass}>{connected ? 'connected' : FAILURE_LABELS[result.failure]}</span>
      </div>
      {!connected && <p className="text-sm text-red-600">{result.message}</p>}
      <dl>
        {connected && <Row label="Provider" value={result.provider} />}
        <Row label="Source language" value={result.sourceLanguage} />
        <Row label="Target language" value={result.targetLanguage} />
        {connected && <Row label="Test sentence" value={result.testSentence} />}
        {connected && <Row label="Translation" value={result.translatedText} />}
        <Row label="Response time" value={result.responseTimeMs == null ? '—' : `${result.responseTimeMs} ms`} />
        <UsageRows usage={result.usage} />
        <Row label="Tested at" value={new Date(result.testedAt).toLocaleString()} />
      </dl>
    </div>
  )
}

export default function TranslationDiagnosticView({ readiness }: { readiness: TranslationReadiness }) {
  const [result, setResult] = useState<TranslationConnectionTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleRun() {
    setError(null)
    startTransition(async () => {
      try {
        setResult(await runTranslationConnectionTest())
      } catch {
        setError('The connection test could not be run. Please try again.')
      }
    })
  }

  return (
    <div className="space-y-6">
      <h1 className={sectionTitleClass}>Translation</h1>

      <div className="space-y-2">
        <p className={helperTextClass}>Environment readiness — checked without contacting Azure.</p>
        <dl className="rounded-md border border-foreground/10 px-4 py-1">
          <Row label="Translator key configured" value={yesNo(readiness.keyConfigured)} />
          <Row label="Translator endpoint configured" value={yesNo(readiness.endpointConfigured)} />
          <Row
            label="Monthly character limit"
            value={
              !readiness.monthlyLimitValid
                ? 'invalid'
                : readiness.monthlyLimitConfigured
                  ? 'configured'
                  : 'default'
            }
          />
          <Row label="Database service credentials configured" value={yesNo(readiness.databaseConfigured)} />
        </dl>
      </div>

      <div className="space-y-3">
        <p className={helperTextClass}>
          Runs one fixed English sentence through Tempa&rsquo;s private translation path into Spanish. It reserves a few
          dozen characters against this month&rsquo;s quota and stores nothing in the translation cache.
        </p>
        <button type="button" onClick={handleRun} disabled={pending} className={secondaryButtonClass}>
          {pending ? 'Testing…' : 'Run connection test'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <DiagnosticResult result={result} />}
      </div>
    </div>
  )
}
