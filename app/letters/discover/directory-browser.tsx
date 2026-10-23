'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import type { DirectoryFilters as DirectoryFilterValues, DirectoryPerson } from '@/lib/room-directory'
import { directoryUrl, parseDirectoryFilters } from '@/lib/directory-state'
import { loadDirectoryPeople } from './directory-actions'
import DirectoryFilters from './directory-filters'

type DirectoryBrowserProps = {
  initialFilters: DirectoryFilterValues
  initialEntries: DirectoryPerson[]
  initialHasMore: boolean
  initialError: string | null
  viewerId: string
  seed: string
  restore: boolean
}

export default function DirectoryBrowser({
  initialFilters, initialEntries, initialHasMore, initialError, viewerId, seed, restore,
}: DirectoryBrowserProps) {
  const [filters, setFilters] = useState(initialFilters)
  const [entries, setEntries] = useState(initialEntries)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(initialError)
  const visitSeed = useRef(seed)
  const generation = useRef(0)
  const mounted = useRef(true)
  const state = useRef({ filters:initialFilters, entries:initialEntries, hasMore:initialHasMore })
  const returnKey = `tempa.directory.return:${viewerId}`

  useEffect(()=>{
    mounted.current = true
    return ()=>{ mounted.current=false }
  },[])

  useEffect(()=>{
    if(!restore) return
    try {
      const raw = sessionStorage.getItem(returnKey)
      if(!raw) return
      const saved=JSON.parse(raw) as { at:number;url:string;seed:string;entries:DirectoryPerson[];hasMore:boolean;scrollY:number }
      if(saved.url!==directoryUrl(initialFilters) || Date.now()-saved.at>30*60*1000 ||
        !Array.isArray(saved.entries) || !/^[a-zA-Z0-9-]{1,80}$/.test(saved.seed)) return
      visitSeed.current=saved.seed
      state.current={filters:initialFilters,entries:saved.entries,hasMore:saved.hasMore}
      requestAnimationFrame(()=>{
        if(!mounted.current)return
        setEntries(saved.entries)
        setHasMore(saved.hasMore)
        setError(null)
        requestAnimationFrame(()=>{if(mounted.current) window.scrollTo(0,saved.scrollY)})
      })
    } catch { /* Browsing remains usable when storage is disabled. */ }
    // Rehydrate only on the profile-return mount; never wipe live filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  const load=useCallback(async (nextFilters:DirectoryFilterValues, reset:boolean)=>{
    const version=++generation.current
    const previous=reset ? [] : state.current.entries
    if(reset){
      state.current={filters:nextFilters,entries:[],hasMore:false}
      setFilters(nextFilters)
      setEntries([])
      setHasMore(false)
    }
    setPending(true)
    setError(null)
    try {
      const page=await loadDirectoryPeople({
        filters:nextFilters, seed:visitSeed.current,
        ...(previous.length && !reset ? {afterUserId:previous[previous.length-1].userId}:{}),
      })
      if(!mounted.current||version!==generation.current)return
      if(page.error){setError(page.error);return}
      const seen=new Set(previous.map(p=>p.userId))
      const combined=[...previous,...page.entries.filter(p=>!seen.has(p.userId))]
      state.current={filters:nextFilters,entries:combined,hasMore:page.hasMore}
      setEntries(combined)
      setHasMore(page.hasMore)
    } catch {
      if(mounted.current && version===generation.current) setError('Could not load people right now. Please try again.')
    } finally {
      if(mounted.current&&version===generation.current) setPending(false)
    }
  },[])

  function change(nextFilters:DirectoryFilterValues) {
    visitSeed.current=crypto.randomUUID()
    window.history.replaceState(null,'',directoryUrl(nextFilters))
    void load(nextFilters,true)
  }

  useEffect(()=>{
    const back=()=>{
      const next=parseDirectoryFilters(Object.fromEntries(new URLSearchParams(window.location.search)))
      visitSeed.current=crypto.randomUUID()
      void load(next,true)
    }
    window.addEventListener('popstate',back)
    return ()=>window.removeEventListener('popstate',back)
  },[load])

  function saveReturn() {
    try {
      sessionStorage.setItem(returnKey,JSON.stringify({
        at:Date.now(),url:directoryUrl(state.current.filters),entries:state.current.entries,
        hasMore:state.current.hasMore,seed:visitSeed.current,scrollY:window.scrollY,
      }))
    } catch { /* Session storage is optional. */ }
  }

  const hasApplied=Object.entries(filters).some(([key,value])=>Boolean(value)&&!(key==='letters'&&value!=='all'))
  return <div className="space-y-7">
    <DirectoryFilters values={filters} onChange={change} />
    <section aria-label="Discover people" aria-busy={pending} aria-live="polite">
      {entries.length>0 && <div className="space-y-3">
        {entries.map((person)=>{
          const target=`/board/people/${person.userId}?returnTo=${encodeURIComponent(directoryUrl(filters,true))}`
          return <article key={person.userId} className="min-w-0 rounded-[5px] border border-[#ded3c3] bg-[#fffdf8] shadow-[0_7px_22px_rgba(65,49,34,.035)]">
            <Link href={target} onClick={saveReturn} className="flex min-w-0 items-start gap-4 rounded-[5px] px-5 py-5 transition-colors hover:bg-[#faf6ee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:px-7 sm:py-6">
              <ProfileIdentityMark identifier={person.userId} markUrl={person.markUrl} label={person.markUrl ? `${person.pseudonym}'s Mark` : undefined} size="lg"/>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h2 className="font-serif text-[23px] leading-tight text-[#302b25]">{person.pseudonym}</h2>
                  {person.country && <span className="text-[12px] text-[#786f63]">· {person.country}</span>}
                </div>
                {person.latestLetter ? <>
                  <p className="mt-2 text-[10px] font-medium uppercase tracking-[.14em] text-[#9b7b66]">{person.latestLetter.kind === 'introduction' ? 'From their introduction' : 'From a letter'}</p>
                  <p className="mt-1 line-clamp-2 text-[15px] leading-[1.7] text-[#51483d]">{person.latestLetter.excerpt || person.latestLetter.title}</p>
                </> : <p className="mt-2 text-[13px] text-[#8b8072]">No letter left yet</p>}
                <span className="mt-3 inline-block text-[12px] font-medium text-[#606052]">Read profile <span aria-hidden="true">→</span></span>
              </div>
            </Link>
          </article>
        })}
      </div>}

      {pending && !entries.length && <div aria-label="Finding people" className="space-y-3">
        {[0,1,2].map(i=><div key={i} className="flex gap-4 rounded border border-foreground/10 bg-surface-shell p-5">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-foreground/10" />
          <div className="flex-1 space-y-3"><div className="h-4 w-1/3 animate-pulse rounded bg-foreground/10"/><div className="h-3 w-4/5 animate-pulse rounded bg-foreground/10"/></div>
        </div>)}
      </div>}

      <div className="flex justify-center py-8" aria-live="polite">
        {pending && entries.length ? <p className="text-[13px] text-foreground/60">Looking a little further…</p> :
         error ? <div className="space-y-3 text-center">
           <p role="alert" className="text-sm text-foreground/70">{error}</p>
           <button type="button" className="text-sm underline underline-offset-4" onClick={()=>void load(filters,entries.length===0)}>Try again</button>
         </div> :
         !entries.length ? <div className="max-w-sm space-y-3 text-center">
           <p className="font-serif text-[21px]">No one matches just now.</p>
           <p className="text-[13px] leading-relaxed text-foreground/60">Try a wider place—or leave a letter on The Board.</p>
           {hasApplied && <button type="button" className="text-[13px] underline underline-offset-4" onClick={()=>change({})}>Clear filters</button>}
           <p><Link href="/board/write" className="text-[13px] underline underline-offset-4">Leave a letter</Link></p>
         </div> :
         hasMore ? <button type="button" onClick={()=>void load(filters,false)} className="min-h-11 rounded-md border border-foreground/20 px-7 py-3 text-[14px] font-medium hover:bg-foreground/[.035]">Keep looking <span aria-hidden="true">→</span></button> :
         <p className="text-[13px] text-foreground/55">That’s everyone here for now.</p>}
      </div>
    </section>
  </div>
}
