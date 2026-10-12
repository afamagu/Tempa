'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { BoardFeedItem, BoardFeedCursor } from '@/lib/dispatches'
import { nextRoomLetters } from '@/lib/room-browse'
import { loadRoomLetterWindow } from './room-browse-actions'
import RoomLetterCard from './room-letter-card'

type State = {
  shown: BoardFeedItem[]
  pool: BoardFeedItem[]
  cursor: BoardFeedCursor | null
}

const BATCH=6
const stateFor=(pool:BoardFeedItem[],cursor:BoardFeedCursor|null,viewerId:string):State=>{
  const first=nextRoomLetters(pool,viewerId,new Set<string>(),new Set<string>())
  return {shown:first.added,pool:first.remaining,cursor}
}

export default function RoomBrowser({
  viewerId,startedAt,seed,initialPool,initialCursor,restore,
}:{
  viewerId:string
  startedAt:string
  seed:string
  initialPool:BoardFeedItem[]
  initialCursor:BoardFeedCursor|null
  restore:boolean
}){
  const [state,setState]=useState<State>(()=>stateFor(initialPool,initialCursor,viewerId))
  const stateRef=useRef(state)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const busy=useRef(false)
  const alive=useRef(true)
  const returnKey=`tempa.board.browse:${viewerId}`
  const origin=`/board?s=${encodeURIComponent(startedAt)}&seed=${encodeURIComponent(seed)}`
  const returnTo=`${origin}&restore=1`

  useEffect(()=>{
    alive.current=true
    return ()=>{alive.current=false}
  },[])

  useEffect(()=>{
    if(!restore)return
    try {
      const raw=sessionStorage.getItem(returnKey)
      if(!raw)return
      const saved=JSON.parse(raw) as {at:number;origin:string;state:State;scrollY:number}
      if(saved.origin!==origin||Date.now()-saved.at>30*60*1000||
        !Array.isArray(saved.state?.shown)||!Array.isArray(saved.state?.pool))return
      stateRef.current=saved.state
      requestAnimationFrame(()=>{
        if(!alive.current)return
        setState(saved.state)
        requestAnimationFrame(()=>{if(alive.current)window.scrollTo(0,saved.scrollY)})
      })
    }catch{ /* sessionStorage is optional */ }
    // Hydrate just once after return from a profile or letter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  const saveReturn=()=>{
    try {
      sessionStorage.setItem(returnKey,JSON.stringify({
        at:Date.now(),origin,state:stateRef.current,scrollY:window.scrollY,
      }))
    }catch{ /* navigation still works without session storage */ }
  }

  async function keepLooking() {
    if(busy.current)return
    busy.current=true
    setPending(true)
    setError(null)
    try {
      let current=stateRef.current
      let pool=current.pool
      let cursor=current.cursor
      const previousIds=new Set(current.shown.map(x=>x.id))
      const previousAuthors=new Set(current.shown.map(x=>x.authorId))
      let batch:BoardFeedItem[]=[]
      let requests=0
      while(batch.length<BATCH){
        const pick=nextRoomLetters(pool,viewerId,
          new Set([...previousIds,...batch.map(x=>x.id)]),
          new Set([...previousAuthors,...batch.map(x=>x.authorId)]))
        batch=[...batch,...pick.added.slice(0,BATCH-batch.length)]
        pool=pick.remaining
        if(batch.length>=BATCH || !cursor || requests>=2)break
        const page=await loadRoomLetterWindow({startedAt,seed,cursor})
        if(!alive.current)return
        if(page.error){setError(page.error);return}
        cursor=page.nextCursor
        pool=[...pool,...page.items.filter(x=>!previousIds.has(x.id)&&!pool.some(y=>y.id===x.id))]
        requests++
      }
      if(!alive.current)return
      current={shown:[...current.shown,...batch],pool,cursor}
      stateRef.current=current
      setState(current)
    }catch{
      if(alive.current)setError('Could not load more letters. Please try again.')
    }finally{
      busy.current=false
      if(alive.current)setPending(false)
    }
  }

  const canContinue=state.pool.length>0||Boolean(state.cursor)
  return <section aria-label="Open letters on The Board" className="mt-9 space-y-9">
    {state.shown.length ? (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {state.shown.map((letter,index)=>(
          <div key={letter.id} onClickCapture={saveReturn} className={index===0?'md:col-span-2':''}>
            <RoomLetterCard
              letter={letter}
              featured={index===0}
              returnTo={returnTo}
            />
          </div>
        ))}
      </div>
    ):(
      <div className="mx-auto max-w-lg py-16 text-center">
        <h2 className="font-serif text-2xl">That’s what has been left here for now.</h2>
        <p className="mt-3 text-[14px] text-foreground/65">There may be more another day. You can also leave something of your own.</p>
        <Link href="/board/write" className="mt-5 inline-block text-sm underline underline-offset-4">Pin a letter</Link>
      </div>
    )}
    <div className="flex justify-center" aria-live="polite">
      {error ? <div className="space-y-2 text-center">
        <p role="alert" className="text-sm text-foreground/70">{error}</p>
        <button type="button" onClick={()=>void keepLooking()} className="text-sm underline underline-offset-4">Try again</button>
      </div> : canContinue ? <button type="button" disabled={pending}
          onClick={()=>void keepLooking()}
          className="min-h-11 rounded-md border border-foreground/20 px-7 py-3 text-[14px] font-medium hover:bg-foreground/[.035] disabled:opacity-60">
          {pending?'Looking a little further…':'Keep looking →'}
        </button> : state.shown.length > 0 ? <p className="text-sm text-foreground/60">That’s everyone here for now.</p> : null}
    </div>
  </section>
}
