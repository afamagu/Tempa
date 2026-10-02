'use server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isStaff } from '@/lib/admin'
import { finalizeAccountClosure, type ClosureStorageObjects } from '@/lib/account-deletion'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function repairDeletedAccountAccess(userId: string): Promise<{ok:boolean;message:string}> {
 if(typeof userId!=='string'||!uuid.test(userId)) return {ok:false,message:'Invalid account.'}
 const client=await createClient()
 if(!(await isStaff(client,'admin'))) return {ok:false,message:'Administrator access required.'}
 try {
  const service=createServiceClient()
  const {data,error}=await service.rpc('closed_account_auth_repair_candidates',{p_user_id:userId})
  const candidate=(data as {user_id:string;storage_objects:ClosureStorageObjects}[]|null)?.find(r=>r.user_id===userId)
  if(error) return {ok:false,message:'Could not check account eligibility. Please try again.'}
  if(!candidate) return {ok:false,message:'This account is already repaired or is not eligible.'}
  // finalize re-reads authoritative enforcement immediately before Auth retirement.
  const result=await finalizeAccountClosure(service,userId,candidate.storage_objects)
  if(result.authMode==='retired') return {ok:true,message:result.error ? 'Sign-up access repaired. Some cleanup needs another check.' : 'Repaired. This person can join again with a new account.'}
  return {ok:false,message:'Repair did not finish. The account remains closed; please retry.'}
 } catch {
  return {ok:false,message:'Could not complete the repair. Please try again.'}
 }
}
