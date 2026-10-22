import { describe,expect,it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const read=(p:string)=>readFileSync(path.join(process.cwd(),p),'utf8')
describe('Profile introductions: safety, visibility and first contact',()=>{
 const sql=read('docs/sql/2026-10-22-profile-introduction-activation.sql')
 it('keeps answers private until an explicit publication switch, without inventing a Board letter',()=>{
  expect(sql).toContain('profile_intro_visible boolean NOT NULL DEFAULT false')
  expect(sql).toContain('set_my_profile_intro_visibility')
  expect(sql).toContain('ALTER POLICY "room_published_answer_read"')
  expect(sql).not.toContain('insert into public.dispatches')
 })
 it('denies hidden introductions through safety evaluation AND first-letter send',()=>{
  expect(sql).toMatch(/can_evaluate_safety_context[\s\S]*?qa\.profile_intro_visible/)
  expect(sql).toMatch(/send_first_letter_core[\s\S]*?qa\.profile_intro_visible/)
  expect(sql).toContain('room_answer_can_start_letter')
  expect(sql).toContain("q.slug='tempa-profile-introduction'")
 })
 it('keeps the existing safety-evaluated Question publication and first-letter composer',()=>{
  const editor=read('app/you/introduction/introduction-editor.tsx')
  expect(editor).toContain("evaluateSafety({surface:'question_answer'")
  expect(editor).toContain("rpc('publish_question_answer'")
  expect(editor).toContain("rpc('set_my_profile_intro_visibility'")
  expect(editor).toContain('window.localStorage.setItem(draftKey')
  expect(editor).toContain('window.localStorage.removeItem(draftKey)')
  expect(read('app/write/[recipientId]/first-letter-composer.tsx')).toContain('send_first_letter')
  expect(read('app/minds/[userId]/page.tsx')).toContain('introWriteHref')
 })
 it('adds introduction to discovery but not The Board',()=>{
  expect(sql).toContain('introduction_answer_id')
  expect(sql).toContain('introduction.id IS NOT NULL')
  expect(read('app/letters/discover/directory-browser.tsx')).toContain('person.introduction')
  expect(read('lib/room-directory.ts')).toContain('introduction_body')
  expect(read('app/board/open-letters-page.tsx')).not.toContain('profile_intro_visible')
 })
})
