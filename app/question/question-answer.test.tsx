import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import QuestionAnswer from './question-answer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: vi.fn() }) }))

function renderQuestion(props: Partial<React.ComponentProps<typeof QuestionAnswer>> = {}) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      <QuestionAnswer
        userId="user-1"
        questionId="q-1"
        prompt="A prompt"
        initialAnswer={null}
        {...props}
      />
    </NextIntlClientProvider>
  )
}

describe('QuestionAnswer — localized current behaviour', () => {
  it('keeps Question writing separate from the Letter composer', () => {
    const html = renderQuestion()
    expect(html).toContain('Save response')
    expect(html).toContain('Back to my responses')
    expect(html).toContain('href="/you/responses"')
    expect(html).not.toContain('Send letter')
    expect(html).not.toContain('Publish answer')
    expect(html).not.toMatch(/>Send<\/button>/)
  })

  it('keeps Questions plain-text with Emoji but no rich-text toolbar', () => {
    const html = renderQuestion()
    expect(html).toContain('aria-label="Insert emoji"')
    expect(html).not.toContain('aria-label="Bold"')
    expect(html).not.toContain('aria-label="Italic"')
  })

  it('does not allow a brand-new answer to an inactive Question', () => {
    const html = renderQuestion({ isActive: false })
    expect(html).toContain(en.Question.unansweredClosed)
    expect(html).not.toContain('<textarea')
    expect(html).toContain('href="/room"')
  })

  it('preserves a historical answer after the Question closes', () => {
    const html = renderQuestion({ initialAnswer: 'My historical answer.', isActive: false })
    expect(html).toContain('My historical answer.')
    expect(html).toContain('This Question is no longer open')
  })

  it('keeps edit controls for an existing answer', () => {
    const html = renderQuestion({ initialAnswer: 'My existing answer.' })
    expect(html).toContain('Edit response')
    expect(html).toContain('Back to my responses')
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*My existing answer\./)
  })

  it('shows the current First Question onboarding education and no escape hatch', () => {
    const html = renderQuestion({ isFlagship: true, onboarding: true })
    expect(html).toContain(en.Question.oneLastThing)
    expect(html).toContain(en.Question.onboardingIntro)
    expect(html).toContain(en.Question.specificity)
    expect(html).not.toContain('Back to my responses')
    expect(html).toContain('Save response')
    expect(html).toMatch(/border-l-2 border-clay\/50/)
    expect(html.toLowerCase()).not.toContain('audio')
  })
})

describe('QuestionAnswer — post-first-save onboarding contract', () => {
  const source = readFileSync(new URL('./question-answer.tsx', import.meta.url), 'utf8')

  it('requires onboarding plus a fresh confirmation for the completion branch', () => {
    expect(source).toContain("mode === 'view' && publishedBody && onboarding && confirmation ?")
  })

  it('uses localized completion copy and continues to Writing Style', () => {
    expect(source).toContain("t('roomHeading')")
    expect(source).toContain("t('roomIntro')")
    expect(source).toContain('<Link href={WRITING_STYLE_ONBOARDING_HREF}')
    expect(source).toContain("{t('continue')}")
  })

  it('does not revive the retired three-Question chain', () => {
    expect(source).toContain('void nextQuestion')
    expect(source).not.toContain('Answer another Question')
    expect(source).not.toContain('/you/responses?tab=new')
  })
})
