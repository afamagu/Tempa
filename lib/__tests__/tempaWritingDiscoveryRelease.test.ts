import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const at=(p:string)=>readFileSync(path.join(process.cwd(),p),'utf8')
const sql=at('docs/sql/2026-10-23-profile-introduction-discovery.sql')

describe('Tempa open-letter activation and profile-introduction release safety',()=>{
 it('uses the existing saved open-letter draft and never publishes directly from the wizard',()=>{
   const guide=at('app/board/write/guide/guided-writing.tsx')
   expect(guide).toContain('writeDispatchDraft(authorId')
   expect(guide).toContain('readDispatchDraft(authorId)')
   expect(guide).toContain('existingDraft && !replaceConfirmed')
   expect(guide).not.toContain('publishDispatch(')
   expect(guide).toContain('Nothing has been published.')
 })
 it('keeps Board publishing opt-in and an actual composer operation',()=>{
   const guide=at('app/board/write/guide/guided-writing.tsx')
   const arrival=at('app/welcome/people/auto-match-arrival.tsx')
   expect(guide).toContain("router.push('/board/write')")
   expect(arrival).toContain("finish('/board/write/guide')")
   expect(arrival).toContain("finish('/board/write')")
   expect(arrival).toContain("finish('/you/introduction')")
   expect(arrival).toContain("finish('/board')")
 })
 it('uses dedicated QA as an approved and revocable introduction source, not a fabricated Board letter',()=>{
   expect(sql).toContain("'tempa-profile-introduction'")
   expect(sql).toContain('is_current,moderation_status')
   expect(sql).toContain("values(auth.uid(),v_id,btrim(p_body),false,'pending')")
   expect(sql).toContain('approved_at is not null')
   expect(sql).toContain('qa.moderation_status = \'visible\'')
   expect(sql).toContain('public.room_answer_can_start_letter')
   expect(sql).not.toContain('CREATE OR REPLACE FUNCTION tempa_private.send_first_letter_core')
   expect(sql).not.toContain('UPDATE public.dispatches')
 })
 it('requires explicit consent, moderation, block checks and visibility before a stranger can read or write',()=>{
   for(const k of [
     'alter table public.profile_introductions enable row level security',
     'profile_intro_approved_read','approved_profile_intro_answer_read',
     'profile_intro_review_audit','public.is_staff(\'admin\')',
     'tempa_private.is_blocked_pair',
     'tempa_private.hidden_from_discovery',
     'tempa_private.author_content_publicly_visible',
     'invalidate_profile_intro_on_answer_change',
     'moderation_status=\'pending\'',
   ]) expect(sql).toContain(k)
   expect(sql).toContain('is_published=false, approved_at=null')
 })
 it('keeps discovery restricted to published, approved writing and six people per page',()=>{
   expect(sql).toContain('profile_intro.id IS NOT NULL')
   expect(sql).toContain("latest_writing_kind")
   expect(sql).toContain('v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 6)')
   expect(sql).toContain('AND NOT tempa_private.is_blocked_pair(v_viewer,p.id)')
 })
 it('preserves existing first-letter evaluation and correspondence limits',()=>{
   const write=at('app/write/[recipientId]/page.tsx')
   const first=at('app/write/[recipientId]/first-letter-composer.tsx')
   expect(write).toContain('getRelationshipCapacity')
   expect(write).toContain('getFirstContactAttempts')
   expect(first).toContain("surface: 'first_letter'")
   expect(first).toContain("'send_first_letter'")
 })
 it('makes the premium card release independent of the app bundle',()=>{
   const uploader=at('app/admin/content/postcards/premium-batch-upload.tsx')
   expect(uploader).toContain("supabase.storage.from('postcard-artwork')")
   expect(uploader).toContain('47 reviewed designs')
 })
})
