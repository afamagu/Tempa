import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
const entry: DiscoveryEntry = { userId:'u1',pseudonym:'Mia',country:'France',genderDisplay:null,ageRange:'',markUrl:null,response:{id:'a1',body:'My ordinary answer about kindness.',prompt:'What stays with you?'},intent:['Unique intent label'] }
describe('writing-led compact discovery cards', () => {
  it('shows the answer excerpt rather than intent in both the grid and suggestion rail', () => {
    for (const horizontal of [false,true]) {
      const html = renderToStaticMarkup(<DiscoveryResults entries={[entry]} profileLed horizontal={horizontal} />)
      expect(html).toContain(entry.response.body)
      expect(html).toContain('line-clamp-2')
      expect(html).not.toContain('Unique intent label')
    }
  })
})
