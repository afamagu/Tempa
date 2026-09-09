import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SystemMessage from './system-message'

describe('SystemMessage — quiet variant', () => {
  it('renders the title as real visible text, not an icon-only aria-label', () => {
    const html = renderToStaticMarkup(<SystemMessage variant="quiet" title="Mail on the way" />)
    expect(html).toContain('Mail on the way')
  })

  it('renders optional supporting text after a middot, on the same inline line', () => {
    const html = renderToStaticMarkup(
      <SystemMessage variant="quiet" title="Mail on the way">
        A letter is travelling to you.
      </SystemMessage>
    )
    expect(html).toContain('Mail on the way')
    expect(html).toContain('A letter is travelling to you.')
    expect(html).toContain('·')
  })

  it('omits the middot separator when there is no supporting text', () => {
    const html = renderToStaticMarkup(<SystemMessage variant="quiet" title="Mail on the way" />)
    expect(html).not.toContain('·')
  })

  it('has no border/background container — stays a single inline line', () => {
    const html = renderToStaticMarkup(<SystemMessage variant="quiet" title="Mail on the way" />)
    expect(html).not.toMatch(/class="[^"]*\bborder\b/)
  })
})

describe('SystemMessage — notice and warning variants', () => {
  it('notice renders as a bordered/background card with title and supporting text', () => {
    const html = renderToStaticMarkup(
      <SystemMessage variant="notice" title="A photo is waiting">
        Open the letter to see it.
      </SystemMessage>
    )
    expect(html).toMatch(/class="[^"]*\bborder\b[^"]*"/)
    expect(html).toContain('A photo is waiting')
    expect(html).toContain('Open the letter to see it.')
  })

  it('warning uses restrained accent emphasis, never red/destructive classes', () => {
    const html = renderToStaticMarkup(
      <SystemMessage variant="warning" title="This might not be them">
        Their activity looks like it is coming from somewhere new.
      </SystemMessage>
    )
    expect(html).toContain('border-accent')
    expect(html).not.toMatch(/\bred-/)
  })

  it('notice does not use the accent-tinted warning tone', () => {
    const html = renderToStaticMarkup(<SystemMessage variant="notice" title="A photo is waiting" />)
    expect(html).not.toContain('border-accent')
  })
})

describe('SystemMessage — icon support', () => {
  it('renders a passed icon and marks it decorative (aria-hidden)', () => {
    const html = renderToStaticMarkup(
      <SystemMessage variant="quiet" title="Mail on the way" icon={<svg data-testid="icon" />} />
    )
    expect(html).toContain('aria-hidden="true"')
  })

  it('renders with no icon at all without crashing', () => {
    const html = renderToStaticMarkup(<SystemMessage variant="notice" title="A photo is waiting" />)
    expect(html).toContain('A photo is waiting')
  })
})

describe('SystemMessage — optional action row (notice/warning only)', () => {
  it('renders an action row beneath the supporting text when provided', () => {
    const html = renderToStaticMarkup(
      <SystemMessage variant="notice" title="Share your answer when you're ready." action={<button>Answer a Question</button>}>
        It helps other minds discover you.
      </SystemMessage>
    )
    expect(html).toContain('Answer a Question')
  })

  it('omits the action row entirely when none is passed', () => {
    const html = renderToStaticMarkup(<SystemMessage variant="notice" title="A photo is waiting" />)
    expect(html).not.toContain('<button')
  })
})

// Home consolidation checkpoint — system voice must never visually
// masquerade as human-authored writing (a letter, a Question answer),
// on Home or anywhere else this primitive is reused. font-serif is
// this codebase's human-voice marker (see app/profile/ui.ts's prose*/
// context*/closure* family) — SystemMessage must never carry it, in
// any variant.
describe('SystemMessage — never renders in the human-writing (serif) voice', () => {
  it('quiet variant carries no font-serif class', () => {
    const html = renderToStaticMarkup(
      <SystemMessage variant="quiet" title="Mail on the way">
        A letter is travelling to you.
      </SystemMessage>
    )
    expect(html).not.toMatch(/class="[^"]*font-serif/)
  })

  it('notice/warning variants carry no font-serif class either', () => {
    const notice = renderToStaticMarkup(
      <SystemMessage variant="notice" title="A photo is waiting">
        Open the letter to see it.
      </SystemMessage>
    )
    const warning = renderToStaticMarkup(
      <SystemMessage variant="warning" title="This might not be them">
        Their activity looks like it is coming from somewhere new.
      </SystemMessage>
    )
    expect(notice).not.toMatch(/class="[^"]*font-serif/)
    expect(warning).not.toMatch(/class="[^"]*font-serif/)
  })
})
