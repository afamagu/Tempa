import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []

function expect(name, condition) {
  checks.push([name, Boolean(condition)])
}

const sql = read('docs/sql/2026-10-05-phase6-relationship-lifecycle.sql')
const diagnostic = read('docs/sql/2026-10-05-phase6-relationship-lifecycle-diagnostic.sql')
const phase1 = read('docs/sql/2026-10-04-phase1-relationship-capacity.sql')
const phase5 = read('docs/sql/2026-10-04-phase5-familiar-faces.sql')
const letters = read('lib/letters.ts')

// Phase 1 contract must remain the foundation: pending first, active only on
// reciprocal reply, outgoing pending reserves capacity, incoming does not.
expect('pending_is_phase1_prerequisite', phase1.includes("column_default = '''pending''::text'"))
expect('establishment_is_pending_to_active', phase1.includes("old.status = 'pending'") && phase1.includes("new.status = 'active'"))
expect('outgoing_pending_reserves_capacity', phase1.includes('est.n + outp.n'))
expect('incoming_pending_does_not_reserve_active_capacity', phase1.includes('Incoming first letters deliberately do not consume recipient active'))

// Expiry is now correspondence-aware.
expect('expiry_only_selects_pending_unestablished', sql.includes("c.status = 'pending'") && sql.includes('c.established_at is null'))
expect('expiry_locks_correspondence_before_resolution', sql.includes('for update;'))
expect('expiry_rechecks_state_after_lock', sql.includes("v_locked.status <> 'pending'") && sql.includes('v_locked.established_at is not null'))
expect('expiry_closes_only_stale_sent_roots', sql.includes("l.status = 'sent'") && sql.includes('l.expires_at <= now()'))
expect('expiry_preserves_live_crossed_root', sql.includes('live.expires_at > now()'))
expect('expiry_never_targets_active_established', !sql.includes("where c.status = 'active'\n      and c.established_at is not null\n      and l.reply_to_id is null"))
expect('expiry_returns_root_count_not_correspondence_count', sql.includes('v_expired := v_expired + v_changed'))

// Discovery must exclude the whole open episode, not only established active.
expect('phase6_patches_three_discovery_readers', [
  'public.discover_people(text,text,text,integer,integer)',
  'public.get_member_introductions(integer)',
  'public.get_familiar_faces(integer)',
].every((signature) => sql.includes(signature)))
expect('open_partner_predicate_is_pending_or_active', sql.includes("'where c.status in (''pending'', ''active'')'"))
expect('patch_preserves_live_function_bodies', sql.includes('pg_get_functiondef(v_signature)'))
expect('patch_fails_if_expected_predicate_missing', sql.includes('expected active-partner predicate was not found'))
expect('phase5_active_only_gap_is_documented_by_predecessor', phase5.includes("c.status = 'active'"))

// No Phase 7+ mechanics should sneak into lifecycle completion.
for (const forbidden of ['return after silence', 'remind me', 'pause correspondence', 'end correspondence', 'plus expansion']) {
  expect(`phase_boundary_absent_${forbidden.replaceAll(' ', '_')}`, !sql.toLowerCase().includes(forbidden))
}

// Diagnostic must remain read-only and expose the exact lifecycle seams.
expect('diagnostic_is_read_only', !/\b(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/i.test(diagnostic.replace(/^\s*--.*$/gm, '')))
expect('diagnostic_checks_open_discovery_predicate', diagnostic.includes("excludes_all_open_correspondence"))
expect('diagnostic_checks_crossed_root_state', diagnostic.includes('live_roots') && diagnostic.includes('stale_sent_roots'))
expect('diagnostic_surfaces_established_sent_roots_without_mutation', diagnostic.includes('sent_root_count'))

// Existing viewer-level expiration guard remains correspondence-aware: ordinary
// rootless Write Anytime letters in an established episode are never mistaken
// for expired first contact.
expect('client_expiry_requires_unestablished_correspondence', letters.includes('!established &&') && letters.includes('letter.replyToId === null'))

const failed = checks.filter(([, pass]) => !pass)
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n${checks.length - failed.length}/${checks.length} Phase 6 checks passed.`)
if (failed.length) process.exitCode = 1
