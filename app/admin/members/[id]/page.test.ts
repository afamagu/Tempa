import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const contact = readFileSync(path.join(__dirname, 'admin-contact-member.tsx'), 'utf8')

describe('Admin member workspace', () => {
  it('retains moderation context and adds safe member identity/account context', () => {
    expect(page).toContain('<ProfileIdentityMark')
    expect(page).toContain('member.email')
    expect(page).toContain('member.ageRange')
    expect(page).toContain('Reports where this member is the target')
    expect(page).toContain('Reports submitted by this member')
    expect(page).toContain('Admin history')
    expect(page).not.toMatch(/access_token|refresh_token|encrypted_password/)
  })

  it('shows only the staff caller\'s real participant correspondence and routes readers through Letters', () => {
    expect(page).toContain('getLetterArchiveWithUser(supabase, staffUser.id, id)')
    expect(page).toContain('getActiveCorrespondencePartnerIds(supabase, staffUser.id)')
    expect(page).toContain('href={`/letters/${letter.id}`}')
    expect(page).toContain('href={`/letters/with/${member.id}`}')
  })

  it('uses the dedicated first-contact RPC, shares the canonical first-contact cap, and refreshes the workspace', () => {
    expect(contact).toContain('sendAdminFirstLetter(createClient(), memberId, trimmed)')
    expect(contact).toContain("import { QUESTION_ANSWER_MAX_CHARS } from '@/lib/questions'")
    expect(contact).toContain('maxLength={QUESTION_ANSWER_MAX_CHARS}')
    expect(contact).not.toContain('4000')
    expect(contact).toContain('router.refresh()')
    expect(contact).not.toContain('.from(\'letters\')')
    expect(contact).not.toContain('.from(\'correspondences\')')
  })
})
