import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isStaff } from '@/lib/admin'
import { sectionTitleClass } from '@/app/profile/ui'
import RepairList from './repair-list'

export default async function AccountAccessPage() {
 const client=await createClient()
 if(!(await isStaff(client,'admin'))) redirect('/admin')
 let candidates:{user_id:string;closed_at:string}[]=[]
 let unavailable=false
 try {
  const {data,error}=await createServiceClient().rpc('closed_account_auth_repair_candidates')
  unavailable=Boolean(error)
  // Storage paths and Auth metadata never enter the client component.
  candidates=(data??[]).map((r:{user_id:string;closed_at:string})=>({user_id:r.user_id,closed_at:r.closed_at}))
 } catch {unavailable=true}
 return <div className="space-y-5">
  <h1 className={sectionTitleClass}>Account access</h1>
  <p className="max-w-2xl text-sm text-foreground/70">Repair older self-deleted accounts whose email or Google identity still belongs to the closed account. This lets the person join afresh; it does not restore their old profile, letters or account.</p>
  <p className="text-sm text-foreground/70">Permanently banned members are excluded. Each repair checks eligibility again before it runs.</p>
  {unavailable?<p role="alert">The repair queue could not be loaded. Check that the deleted-member-return migration is installed.</p>:candidates.length?<RepairList candidates={candidates}/>:<p>No self-deleted accounts need this repair.</p>}
  {candidates.length===50&&<p className="text-sm">Showing the first 50 accounts. Repaired accounts leave the queue, making room for the next ones.</p>}
 </div>
}
