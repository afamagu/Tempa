import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LandingPage from './landing-page'

describe('Approved landing page',()=>{
  const html=renderToStaticMarkup(<LandingPage />)
  it('is explicit that the controlled pilot is invitation-only',()=>{
    expect(html).toContain('Meet people through')
    expect(html).toContain('what they write.')
    expect(html).toContain('Founding Correspondents')
    expect(html).toContain('Tempa is currently invitation only.')
    expect(html.match(/>I have an invitation<\/a>/g)).toHaveLength(2)
    expect(html.match(/href="\/sign-in\?intent=join"/g)).toHaveLength(2)
    expect(html).toContain('href="#read"')
    expect(html).toContain('id="read"')
  })

  it('describes Postcards exactly as the product supports them today',()=>{
    expect(html).toContain('Send one with a letter or a Dispatch.')
    expect(html).not.toContain('or on its own')
  })
  it('keeps the mobile editorial sections as accessible text and optimized illustration assets',()=>{
    for(const text of ['Questions worth answering.','Places carry stories too.','Find someone worth writing to.','Evening Quill']) expect(html).toContain(text)
    expect(html).toContain('hero-collage.webp')
    expect(html).toContain('moment-photo.webp')
    expect(html).not.toContain('.pdf')
    expect(html).toContain('aria-label="Legal links"')
  })
})
