// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import DispatchPreview from './dispatch-preview'
import { WEB_PUBLIC_COPY } from '@/lib/public-dispatches'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

// Integration of Writing Style with public-by-default Dispatches
// (merged from main): the Preview shows BOTH the author's style on the
// words and the web-audience choice beside Publish, and neither leaks
// into the other.

const dom = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
const composer = readFileSync(path.join(__dirname, 'dispatch-composer.tsx'), 'utf8').replace(/\r\n/g, '\n')

function render(props: Partial<Parameters<typeof DispatchPreview>[0]> = {}) {
  return dom(
    renderToStaticMarkup(
      <DispatchPreview
        authorId="u1"
        authorPseudonym="Evening Quill"
        title="A list of small things"
        body={'I keep a list of small things.\n\nSecond paragraph.'}
        topics={[]}
        moments={[{ id: 'd1', position: 0, imageUrl: 'https://example.test/x.jpg' } as never]}
        postcardDraft={null}
        postcardCatalogEntry={null}
        onBack={() => {}}
        onPublish={() => {}}
        publishing={false}
        {...props}
      />
    )
  )
}

describe('DispatchPreview — Writing Style alongside the web-audience choice', () => {
  it('renders the author’s style on the words and the public-web notice in interface type', () => {
    const d = render({ writingStyleId: 'ink', webPublic: true })
    const prose = d.querySelector('.authored-prose')!
    expect(prose.getAttribute('data-writing-style')).toBe('ink')
    const notice = [...d.querySelectorAll('p')].find((p) => p.textContent === WEB_PUBLIC_COPY.label)!
    expect(notice).toBeDefined()
    expect(notice.closest('.authored-prose')).toBeNull()
    expect(d.querySelector('h1')!.closest('.authored-prose')).toBeNull()
    expect(d.querySelector('[aria-label="Open this photo"]')!.closest('.wp-interface')).not.toBeNull()
  })

  it('Tempa-only choice and no style still render correctly', () => {
    const d = render({ webPublic: false })
    expect(d.body.textContent).toContain('Tempa only')
    expect(d.querySelector('.authored-prose')!.getAttribute('data-writing-style')).toBe('tempa')
  })

  it('the composer passes both props; official Dispatches never take a personal style; new Dispatches still default public', () => {
    expect(composer).toContain('writingStyleId={official ? null : writingStyleId}')
    expect(composer).toContain('webPublic={showWebChoice ? webPublic : undefined}')
    expect(composer).toContain('const initialWebPublic = isEdit ? existingDispatch?.webPublic ?? null : true')
  })
})
