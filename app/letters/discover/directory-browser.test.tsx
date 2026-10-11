// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryPerson } from '@/lib/room-directory'
import DirectoryBrowser from './directory-browser'
import { loadDirectoryPeople } from './directory-actions'

vi.mock('./directory-actions',()=>({ loadDirectoryPeople:vi.fn() }))
vi.mock('./directory-filters',()=>({
  default:({ onChange }:{onChange:(filters:Record<string,string>)=>void})=><button type="button" onClick={()=>onChange({country:'Japan'})}>Filter Japan</button>,
}))
vi.mock('@/app/profile-identity-mark',()=>({
  default:()=> <span aria-label="Member Mark">✧</span>,
}))
vi.mock('next/link',()=>({
  default:({href,children,onClick,...props}:{href:string;children:React.ReactNode;onClick?:()=>void})=><a href={href} onClick={onClick} {...props}>{children}</a>,
}))

const id=(n:number)=>`11111111-2222-4333-8444-${String(n).padStart(12,'0')}`
const person=(n:number,letter=true):DirectoryPerson=>({
  userId:id(n),pseudonym:`Writer ${n}`,country:'Japan',markUrl:null,languages:['English'],
  latestLetter:letter?{id:id(n+100),title:'Sunday',excerpt:'She knows which tea I buy.'}:null,
})
let host:HTMLDivElement
let root:ReturnType<typeof createRoot>
beforeEach(()=>{
  ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
  vi.clearAllMocks()
  vi.stubGlobal('crypto', { randomUUID: () => 'fresh-seed' })
  sessionStorage.clear()
  window.history.replaceState(null,'','/board/people')
  host=document.createElement('div')
  document.body.appendChild(host)
  root=createRoot(host)
})
afterEach(async()=>{
  await act(async()=>root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function mount(options:Partial<React.ComponentProps<typeof DirectoryBrowser>>={}) {
  await act(async()=>root.render(<DirectoryBrowser
    initialFilters={{}}
    initialEntries={[person(1),person(2),person(3),person(4),person(5),person(6)]}
    initialHasMore
    initialError={null}
    viewerId={id(99)}
    seed="test-seed"
    restore={false}
    {...options}
  />))
}

describe('Discover People: intentional finite writer directory',()=>{
  it('shows six letter-linked authors without dating-style or popularity UI',async()=>{
    await mount()
    expect(host.querySelectorAll('section[aria-label="Discover people"] article')).toHaveLength(6)
    expect(host.textContent).toContain('She knows which tea I buy.')
    expect(host.textContent).toContain('Keep looking')
    expect(host.textContent).not.toContain('compatible')
    expect(host.textContent).not.toContain('followers')
  })
  it('fetches only when Keep looking is activated and appends the next six without duplicating an author',async()=>{
    vi.mocked(loadDirectoryPeople).mockResolvedValue({entries:[person(6),person(7)],hasMore:false,error:null})
    await mount()
    expect(loadDirectoryPeople).not.toHaveBeenCalled()
    await act(async()=>{(Array.from(host.querySelectorAll('button')).find(e=>e.textContent?.includes('Keep looking'))!).click()})
    expect(loadDirectoryPeople).toHaveBeenCalledWith(expect.objectContaining({afterUserId:id(6)}))
    expect(host.querySelectorAll('section[aria-label="Discover people"] article')).toHaveLength(7)
    expect(host.textContent).not.toContain('Keep looking')
  })
  it('changes filters without a full page navigation and retains filter context in profile links',async()=>{
    vi.mocked(loadDirectoryPeople).mockResolvedValue({entries:[person(7)],hasMore:false,error:null})
    await mount()
    await act(async()=>{(Array.from(host.querySelectorAll('button')).find(e=>e.textContent==='Filter Japan')!).click()})
    expect(window.location.search).toContain('country=Japan')
    expect(host.querySelectorAll('section[aria-label="Discover people"] article')).toHaveLength(1)
    const href=host.querySelector('section[aria-label="Discover people"] article a')?.getAttribute('href')
    expect(href).toContain('/board/people/')
    expect(decodeURIComponent(href ?? '')).toContain('/board/people?country=Japan&restore=1')
  })
  it('shows honest no-letter copy only when people without letters are explicitly included',async()=>{
    await mount({initialFilters:{letters:'all'},initialEntries:[person(1,false)],initialHasMore:false})
    expect(host.textContent).toContain('No letter left yet')
  })
})
