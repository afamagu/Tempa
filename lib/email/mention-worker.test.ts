import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderMentionEmail, runMentionEmailWorker, type MentionEmailSnapshot } from './mention-worker'
const snapshot: MentionEmailSnapshot = { from:'Tempa <hello@example.test>',to:'reader@example.test',pseudonym:'Mia <script>',kind:'answer',mentionId:'00000000-0000-4000-8000-000000000010',siteOrigin:'https://jointempa.com',idempotencyKey:'public-mention/test' }
afterEach(()=>vi.unstubAllEnvs())
describe('mention email delivery',()=>{
  it('escapes the public name and links to the exact recipient-only event and preferences',()=>{
    const result=renderMentionEmail(snapshot)
    expect(result.html).toContain('Mia &lt;script&gt;')
    expect(result.html).not.toContain('<script>')
    expect(result.text).toContain(`/mentions/${snapshot.mentionId}`)
    expect(result.text).toContain('/you/notifications#mention-emails')
    expect(()=>renderMentionEmail({...snapshot,siteOrigin:'https://evil.test'})).toThrow()
    expect(()=>renderMentionEmail({...snapshot,mentionId:'../admin'})).toThrow()
  })
  it('does not claim work with missing or invalid sender configuration',async()=>{
    vi.stubEnv('ARRIVAL_EMAIL_FROM','')
    const rpc=vi.fn(),sendEmail=vi.fn()
    await runMentionEmailWorker({supabase:{rpc} as unknown as SupabaseClient,sendEmail,siteOrigin:snapshot.siteOrigin})
    expect(rpc).not.toHaveBeenCalled();expect(sendEmail).not.toHaveBeenCalled()
  })
  it('uses the exact frozen request and records the provider identifier',async()=>{
    vi.stubEnv('ARRIVAL_EMAIL_FROM',snapshot.from)
    const frozen={from:snapshot.from,to:snapshot.to,...renderMentionEmail(snapshot),html:'Old frozen template',idempotencyKey:snapshot.idempotencyKey}
    const rpc=vi.fn(async(fn:string)=>{
      if(fn==='claim_mention_emails')return {data:[{mention_id:snapshot.mentionId,claim_token:'lease'}],error:null}
      if(fn==='prepare_mention_email')return {data:{...snapshot,providerRequest:frozen},error:null}
      if(fn==='freeze_mention_email')return {data:frozen,error:null}
      return {data:true,error:null}
    })
    const sendEmail=vi.fn(async()=>({ok:true as const,providerMessageId:'provider-id'}))
    expect(await runMentionEmailWorker({supabase:{rpc} as unknown as SupabaseClient,sendEmail,siteOrigin:snapshot.siteOrigin})).toEqual({claimed:1,sent:1,failed:0})
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith(frozen)
    expect(rpc).toHaveBeenCalledWith('complete_mention_email',expect.objectContaining({p_ok:true,p_provider_message_id:'provider-id',p_claim_token:'lease'}))
  })
  it('never sends a job rejected by final eligibility checks',async()=>{
    vi.stubEnv('ARRIVAL_EMAIL_FROM',snapshot.from)
    const rpc=vi.fn(async(fn:string)=>({error:null,data:fn==='claim_mention_emails'?[{mention_id:snapshot.mentionId,claim_token:'lease'}]:fn==='prepare_mention_email'?snapshot:null}))
    const sendEmail=vi.fn()
    await runMentionEmailWorker({supabase:{rpc} as unknown as SupabaseClient,sendEmail,siteOrigin:snapshot.siteOrigin})
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('records transient provider failures as retryable without exposing provider error details',async()=>{
    vi.stubEnv('ARRIVAL_EMAIL_FROM',snapshot.from)
    const rpc=vi.fn(async(fn:string)=>({error:null,data:fn==='claim_mention_emails'?[{mention_id:snapshot.mentionId,claim_token:'lease'}]:fn==='prepare_mention_email'?snapshot:fn==='freeze_mention_email'?{}:true}))
    const sendEmail=vi.fn(async()=>({ok:false as const,retryable:true,error:'private provider details'}))
    const summary=await runMentionEmailWorker({supabase:{rpc} as unknown as SupabaseClient,sendEmail,siteOrigin:snapshot.siteOrigin})
    expect(summary.failed).toBe(1)
    expect(rpc).toHaveBeenCalledWith('complete_mention_email',expect.objectContaining({p_ok:false,p_retryable:true}))
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('private provider details')
  })
})
it('uses sender-scoped claims for immediate attempts, never the global queue', async () => {
 vi.stubEnv('ARRIVAL_EMAIL_FROM',snapshot.from)
 const rpc=vi.fn().mockResolvedValue({data:[],error:null})
 await runMentionEmailWorker({supabase:{rpc} as unknown as SupabaseClient,sendEmail:vi.fn(),siteOrigin:snapshot.siteOrigin,senderId:'sender'})
 expect(rpc).toHaveBeenCalledExactlyOnceWith('claim_immediate_mention_emails',{p_sender_id:'sender'})
})
