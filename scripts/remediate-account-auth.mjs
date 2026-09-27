#!/usr/bin/env node
// ONE-TIME REMEDIATION — NOT RUN. For the owner, after review and approval.
//
// Brings EXISTING Auth users in line with Tempa's account state
// (docs/sql/2026-10-25-account-auth-state.sql), for an explicit list of
// user ids taken from docs/sql/2026-10-25-account-auth-state-remediation-list.sql:
//   state 'deleted'            -> Supabase soft delete (the same call a
//                                 voluntary deletion now makes): the old
//                                 account stays unrecoverable, and the same
//                                 email / Google account can sign up anew.
//   state 'permanently_banned' -> Auth ban (~100 years), identity kept.
//   anything else              -> SKIPPED (never touched).
// Every id is re-checked against the database immediately before acting.
//
// DRY RUN BY DEFAULT: prints what it would do and changes nothing.
// Nothing happens without --apply.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/remediate-account-auth.mjs --ids <id,id,...> [--apply]
//
// Output: ids, states and outcomes only — never emails.

import { createClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const idsArg = args[args.indexOf('--ids') + 1]
if (!args.includes('--ids') || !idsArg) {
  console.error('Usage: node scripts/remediate-account-auth.mjs --ids <id,id,...> [--apply]')
  process.exit(2)
}
const ids = [...new Set(idsArg.split(',').map((s) => s.trim()).filter(Boolean))]
const invalid = ids.filter((id) => !UUID.test(id))
if (invalid.length) {
  console.error(`Not user ids: ${invalid.join(', ')}`)
  process.exit(2)
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(2)
}
const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

console.log(apply ? 'APPLYING changes.' : 'DRY RUN — nothing will change. Re-run with --apply to act.')
let failures = 0
for (const id of ids) {
  const { data: state, error } = await service.rpc('account_auth_state', { p_user_id: id })
  if (error) {
    failures++
    console.log(`${id}  state=?  FAILED to read state: ${error.message}`)
    continue
  }
  const action = state === 'deleted' ? 'soft-delete Auth identity' : state === 'permanently_banned' ? 'Auth-ban (identity kept)' : null
  if (!action) {
    console.log(`${id}  state=${state}  SKIPPED (not eligible)`)
    continue
  }
  if (!apply) {
    console.log(`${id}  state=${state}  would ${action}`)
    continue
  }
  const { error: authError } =
    state === 'deleted'
      ? await service.auth.admin.deleteUser(id, true)
      : await service.auth.admin.updateUserById(id, { ban_duration: '876000h' })
  if (authError) failures++
  console.log(`${id}  state=${state}  ${authError ? `FAILED: ${authError.message}` : `done: ${action}`}`)
}
process.exit(failures ? 1 : 0)
