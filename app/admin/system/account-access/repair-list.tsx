'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { repairDeletedAccountAccess } from './actions'
import { secondaryButtonClass } from '@/app/profile/ui'

export default function RepairList({candidates}:{candidates:{user_id:string;closed_at:string}[]}) {
 const [busy,setBusy]=useState<string|null>(null)
 const [messages,setMessages]=useState<Record<string,{ok:boolean;message:string}>>({})
 const router=useRouter()
 async function repair(id:string) {
  if(busy) return
  setBusy(id)
  try {
   const result=await repairDeletedAccountAccess(id)
   setMessages(previous=>({...previous,[id]:result}))
   if(result.ok) router.refresh()
  } catch {setMessages(previous=>({...previous,[id]:{ok:false,message:'Could not complete the repair. Please try again.'}}))}
  finally {setBusy(null)}
 }
 return <div className="space-y-4">
  {candidates.map(c=><article key={c.user_id} className="space-y-3 rounded-lg border border-foreground/10 p-4">
   <p className="break-all text-sm">Account {c.user_id}</p>
   <p className="text-sm text-foreground/65">Closed {new Date(c.closed_at).toLocaleDateString('en-GB',{timeZone:'UTC'})}</p>
   <button disabled={busy!==null||messages[c.user_id]?.ok} className={secondaryButtonClass} onClick={()=>void repair(c.user_id)}>{busy===c.user_id?'Repairing…':'Repair sign-up access'}</button>
  </article>)}
  {Object.entries(messages).map(([id,result])=><p key={id} role={result.ok?'status':'alert'} className="text-sm">{result.message}</p>)}
 </div>
}
