import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Source contracts for the authenticated surfaces that previously assumed
// author_id == public identity. For Tempa/Sponsored rows author_id is the
// creating admin — none of these may ever target that admin personally.
// (The repo's convention for async Server Component pages is source
// inspection; behaviour of the shared pieces is rendered in
// dispatch-identity-label.test.tsx and lib/official-dispatches.test.ts.)

const read = (...p: string[]) => readFileSync(path.join(__dirname, ...p), 'utf8')
const reader = read('[dispatchId]', 'page.tsx')
const composer = read('dispatch-composer.tsx')
const editPage = read('[dispatchId]', 'edit', 'page.tsx')
const authorMenu = read('[dispatchId]', 'author-actions-menu.tsx')

describe('authenticated reader', () => {
  it('derives one isMemberDispatch flag from the canonical identity', () => {
    expect(reader).toContain("const isMemberDispatch = dispatch.identity.kind === 'member'")
  })

  it('no Keep in Mind against a Tempa/Sponsored identity', () => {
    expect(reader).toContain('{isMemberDispatch && (\n                      <KeepButton')
    expect(reader).toContain('isAuthor || !isMemberDispatch ? Promise.resolve(false) : isKeepingMind(')
  })

  it('no "Write to this mind" / correspondence lookups against the admin', () => {
    expect(reader).toContain('const showWriteToAuthor = isMemberDispatch && canWriteToMind({')
    expect(reader).toContain('const alreadyCorrespondingWithAuthor = isMemberDispatch && activePartnerIds.has(dispatch.authorId)')
  })

  it('member header (Mark, pseudonym, country, profile link) is untouched; official rows use DispatchIdentityLabel', () => {
    expect(reader).toContain('{isMemberDispatch ? (\n                <Link\n                  href={`/minds/${dispatch.authorId}`}')
    expect(reader).toContain('<DispatchIdentityLabel identity={dispatch.identity} size="md" />')
  })

  it('Sponsored shows its restrained CTA; share text is identity-aware', () => {
    expect(reader).toContain('<SponsorCta identity={dispatch.identity} />')
    expect(reader).toContain('shareText={dispatchShareText(dispatch.title, dispatch.identity)}')
  })

  it('never pinned to the admin profile; edits route to Admin Content', () => {
    expect(reader).toContain('allowPin={isMemberDispatch}')
    expect(reader).toContain('editHref={officialEditHref}')
    expect(authorMenu).toContain('{allowPin && (')
    expect(authorMenu).toContain('href={editHref ?? `/board/${dispatchId}/edit`}')
  })

  it('member edit route refuses official rows (redirects to the staff editor)', () => {
    expect(editPage).toContain("if (dispatch.publishedAs === 'tempa') redirect(`/admin/content/dispatches/${dispatch.id}/edit`)")
    expect(editPage).toContain("if (dispatch.publishedAs === 'sponsored') redirect(`/admin/content/sponsored/${dispatch.id}/edit`)")
  })
})

describe('Board lists', () => {
  it('Keep in Mind on Board cards only for member Dispatches', () => {
    expect(read('board-feed.tsx')).toContain("dispatch.identity.kind === 'member' && dispatch.authorId !== viewerId ? (")
    expect(read('page.tsx')).toContain("dispatch.identity.kind === 'member' && dispatch.authorId !== user.id ? (")
  })
})

describe('DispatchComposer — one editor, two publishing paths', () => {
  it('member path is unchanged: Safety evaluation first, then publish_dispatch/update_dispatch', () => {
    expect(composer).toContain("surface: 'dispatch_publish'")
    expect(composer).toContain("surface: 'dispatch_update'")
    expect(composer).toContain('await publishDispatch(createClient(), {')
    expect(composer).toContain('await updateDispatch(createClient(), existingDispatch.id, {')
  })

  it('official path skips member Safety screening and calls only the staff RPC wrappers', () => {
    const officialBranch = composer.slice(composer.indexOf('    if (official) {\n      await performSubmit(null, false)'), composer.indexOf('    const outcome ='))
    expect(officialBranch).toContain('await performSubmit(null, false)')
    expect(composer).toContain('await publishOfficialDispatch(createClient(), {')
    expect(composer).toContain('await updateOfficialDispatch(createClient(), existingDispatch.id, {')
    // a member (no publication prop) can never reach publish_dispatch without an evaluation
    expect(composer).toContain("? { data: null, error: { message: 'A Safety evaluation is required.' } }")
  })

  it('official drafts never overwrite the admin’s own member draft', () => {
    expect(composer).toContain('const draftKey = official ? `${authorId}:${official.publishedAs}` : authorId')
    expect(composer).not.toMatch(/(read|write|clear)Dispatch(Postcard)?Draft\(authorId/)
  })

  it('Postcard sender preview: Tempa / sponsor / member pseudonym', () => {
    expect(composer).toContain('? TEMPA_IDENTITY_NAME')
    expect(composer).toContain("sponsor.sponsorName.trim() || 'Sponsor'")
    expect(composer).toContain('senderPseudonym={postcardSenderName}')
  })
})
