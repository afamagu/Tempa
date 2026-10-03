// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach,beforeEach,it,expect,vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import MentionEmailPreference from './mention-email-preference'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc})}))
let root:Root,host:HTMLDivElement
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});rpc.mockReset()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>root.render(<NextIntlClientProvider locale="en" messages={en}><MentionEmailPreference initialAudience="everyone"/></NextIntlClientProvider>))
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('saves only the selected audience without accepting an arbitrary recipient id',async()=>{
  rpc.mockResolvedValue({error:null})
  await act(async()=>{const select=host.querySelector('select')!;select.value='off';select.dispatchEvent(new Event('change',{bubbles:true}))})
  await act(async()=>host.querySelector('button')!.click())
  expect(rpc).toHaveBeenCalledWith('set_mention_email_preference',{p_audience:'off'})
  expect(host.textContent).toContain(en.MentionEmails.saved)
})
it('keeps a failed setting editable and does not claim success',async()=>{
  rpc.mockRejectedValue(new Error('offline'))
  await act(async()=>host.querySelector('button')!.click())
  expect(host.textContent).toContain(en.MentionEmails.failed)
  expect(host.querySelector('button')!.disabled).toBe(false)
})
