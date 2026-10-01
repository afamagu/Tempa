import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LandingPage from './landing-page'

describe('Approved landing page',()=>{
  const html=renderToStaticMarkup(<LandingPage />)
  it('uses the revised introduction and real entry links',()=>{
    expect(html).toContain('Meet people through')
    expect(html).toContain('what they write.')
    expect(html).toContain('Let what you say come first.')
    expect(html).not.toContain('People are easy to find.')
    expect(html.match(/href="\/sign-in\?intent=join"/g)).toHaveLength(2)
    expect(html).toContain('href="#read"')
    expect(html).toContain('id="read"')
  })
  it('keeps the mobile editorial sections as accessible text and optimized illustration assets',()=>{
    for(const text of ['Questions worth answering.','Places carry stories too.','Find someone worth writing to.','Evening Quill']) expect(html).toContain(text)
    expect(html).toContain('hero-collage.webp')
    expect(html).toContain('moment-photo.webp')
    expect(html).not.toContain('.pdf')
    expect(html).toContain('aria-label="Legal links"')
  })
})
