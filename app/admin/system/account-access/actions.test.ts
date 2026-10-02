import {beforeEach,describe,expect,it,vi} from 'vitest'
const {staff,rpc,finalize,service}=vi.hoisted(()=>({staff:vi.fn(),rpc:vi.fn(),finalize:vi.fn(),service:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({})}))
vi.mock('@/lib/admin',()=>({isStaff:staff}))
vi.mock('@/lib/supabase/service',()=>({createServiceClient:service}))
vi.mock('@/lib/account-deletion',()=>({finalizeAccountClosure:finalize}))
import {repairDeletedAccountAccess} from './actions'
const uid='00000000-0000-4000-8000-000000000001'
beforeEach(()=>{vi.clearAllMocks();staff.mockResolvedValue(true);service.mockReturnValue({rpc});rpc.mockResolvedValue({data:[{user_id:uid,storage_objects:{}}],error:null});finalize.mockResolvedValue({authMode:'retired',error:null})})
describe('administrator-only closed identity repair',()=>{
 it('uses the fresh database candidate and existing closure finalizer',async()=>{
  expect((await repairDeletedAccountAccess(uid)).ok).toBe(true)
  expect(staff).toHaveBeenCalledWith({},'admin')
  expect(rpc).toHaveBeenCalledWith('closed_account_auth_repair_candidates',{p_user_id:uid})
  expect(finalize).toHaveBeenCalledWith({rpc},uid,{})
 })
 it('rejects non-admin callers before creating a privileged client',async()=>{
  staff.mockResolvedValue(false);expect((await repairDeletedAccountAccess(uid)).ok).toBe(false)
  expect(service).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled()
 })
 it.each([{data:[]},{data:[{user_id:'different-user',storage_objects:{}}]}])('never retires a non-candidate or different account',async ({data})=>{
  rpc.mockResolvedValue({data,error:null});expect((await repairDeletedAccountAccess(uid)).ok).toBe(false);expect(finalize).not.toHaveBeenCalled()
 })
 it('fails closed when eligibility cannot be read',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'private SQL detail'}})
  const result=await repairDeletedAccountAccess(uid);expect(result.ok).toBe(false);expect(result.message).not.toContain('SQL');expect(finalize).not.toHaveBeenCalled()
 })
 it('does not report success when finalization rechecks a newly imposed permanent ban',async()=>{
  finalize.mockResolvedValue({authMode:'banned',error:null});expect((await repairDeletedAccountAccess(uid)).ok).toBe(false)
 })
 it('rejects malformed ids before any database access',async()=>{
  expect((await repairDeletedAccountAccess('bad-id')).ok).toBe(false);expect(staff).not.toHaveBeenCalled()
 })
})
