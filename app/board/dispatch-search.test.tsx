// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DispatchSearch from './dispatch-search'
const router=vi.hoisted(()=>({push:vi.fn(),refresh:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>router}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
let dispose=()=>{}
function mount(query=''){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 act(()=>root.render(<DispatchSearch initialQuery={query} sessionStartedAt="session" seed="seed" />))
 dispose=()=>{act(()=>root.unmount());host.remove()};return host
}
afterEach(()=>{dispose();vi.clearAllMocks()})
function type(host:HTMLElement,value:string){const input=host.querySelector('input')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
describe('Board search controls',()=>{
 it('offers an explicit Search button and submits trimmed input with browsing state intact',()=>{
  const host=mount();type(host,'  God  ');act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(router.push).toHaveBeenCalledWith('/board?q=God&s=session&seed=seed')
  expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Search')
 })
 it('clearing the text restores the Board without navigating away',()=>{
  const host=mount('God');type(host,'');expect(router.push).toHaveBeenCalledWith('/board?s=session&seed=seed')
 })
 it('provides a clear button and permits retrying an unchanged query',()=>{
  const host=mount('God');act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(router.refresh).toHaveBeenCalledOnce()
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());expect(router.push).toHaveBeenCalledWith('/board?s=session&seed=seed')
 })
})
