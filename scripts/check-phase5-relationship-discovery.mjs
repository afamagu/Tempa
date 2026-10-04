import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []

function expect(name, condition) {
  checks.push([name, Boolean(condition)])
}

const sql = read('docs/sql/2026-10-04-phase5-familiar-faces.sql')
const diagnostic = read('docs/sql/2026-10-04-phase5-familiar-faces-diagnostic.sql')
const discoverPage = read('app/letters/discover/page.tsx')
const discoverBrowser = read('app/letters/discover/discover-browser.tsx')
const discoverActions = read('app/letters/discover/actions.ts')
const introductionActions = read('app/introduction-actions.ts')
const familiarReader = read('lib/familiar-faces.ts')
const familiarSurface = read('app/familiar-faces.tsx')
const homeSignal = read('app/home/familiar-faces-home.tsx')
const homeSeam = read('app/home/room-invitations.tsx')
const room = read('app/room/page.tsx')
const discoverState = read('lib/discover-browser-state.ts')

// Finite passive Discover: six people, encounter-backed, no paging.
expect('passive_discover_uses_introduction_authority', discoverActions.includes("rpc('get_member_introductions', { p_limit: 6 })"))
expect('passive_discover_is_hard_bounded_to_six', discoverActions.includes('entries.slice(0, 6)'))
expect('blank_discover_uses_passive_reader', discoverPage.includes('loadPassiveIntroductions()'))
expect('intentional_discover_keeps_broad_reader', discoverPage.includes('await getDiscoveryPage(supabase, request)'))
expect('intentional_criteria_are_explicit', discoverState.includes('hasIntentionalDiscoverCriteria'))
expect('passive_discover_never_pages', discoverBrowser.includes('if (!intentional && !reset) return'))
expect('broad_paging_requires_intent', discoverBrowser.includes('if (!intentional || !el || !hasMore'))
expect('full_correspondence_suppresses_passive_set', discoverActions.includes('capacity?.canStartFirstContact === false'))

// Encounter semantics: fetching is not enough; substantial visibility records
// the same existing encounter ledger that Familiar Faces later reads.
expect('passive_cards_require_viewport_encounter', discoverBrowser.includes('record.intersectionRatio < 0.6'))
expect('passive_cards_record_existing_ledger', introductionActions.includes("rpc('mark_member_introduction_presented'"))
expect('shared_presentation_action_is_authenticated', introductionActions.includes('supabase.auth.getUser()'))
expect('familiar_faces_reuses_shared_presentation_action', familiarSurface.includes("from '@/app/introduction-actions'"))
expect('familiar_faces_reencounter_requires_viewport', familiarSurface.includes('record.intersectionRatio < 0.6'))

// Familiar Faces eligibility: same history ledger, cooldown, safety/visibility,
// relationship exclusions, capacity gate, deterministic bounded order.
expect('familiar_faces_reuses_introduction_history', sql.includes('public.member_introduction_history'))
expect('familiar_faces_requires_real_presentation', sql.includes('h.presented_count >= 1'))
expect('familiar_faces_has_seven_day_cooldown', sql.includes("interval '7 days'"))
expect('familiar_faces_excludes_active_correspondents', sql.includes("c.status = 'active'"))
expect('familiar_faces_excludes_sent_first_letters', sql.includes('l.reply_to_id is null'))
expect('familiar_faces_uses_visible_profiles', sql.includes('public.public_profiles'))
expect('familiar_faces_uses_capacity_authority', sql.includes('public.get_relationship_capacity()'))
expect('familiar_faces_hard_max_three', sql.includes('least(greatest(coalesce(p_limit, 3), 1), 3)'))
expect('familiar_faces_is_deterministic', sql.includes('order by h.last_encountered_at asc, p.id asc'))
expect('familiar_faces_has_no_random_rank', !sql.includes('random()'))
expect('familiar_faces_reader_is_bounded', familiarReader.includes('Math.min(Math.max(Math.floor(limit), 1), 3)'))
expect('familiar_faces_reader_fails_closed_ambiently', familiarReader.includes('return []'))

// Placement and treatment: Home primary relationship signal, Room secondary;
// no popup/modal revival and no later-phase mechanics.
expect('home_has_familiar_faces_signal', homeSignal.includes('getFamiliarFaces(supabase, 3)') && homeSeam.includes('<HomeFamiliarFaces />'))
expect('room_has_quiet_familiar_faces', room.includes('<FamiliarFaces entries={familiarFaces} returnTo={returnTo} quiet />'))
expect('familiar_faces_copy_is_quiet', familiarSurface.includes('You’ve crossed paths before.'))
expect('familiar_faces_is_inline_not_modal', !familiarSurface.includes('role="dialog"') && !familiarSurface.includes('fixed inset-0'))
expect('diagnostic_is_read_only', !/\b(insert|update|delete|create|alter|drop|truncate)\b/i.test(diagnostic.replace(/^\s*--.*$/gm, '')))

// Retired user-facing wording must not return in Phase 5 surfaces.
const phase5Ui = [discoverPage, discoverBrowser, familiarSurface, homeSignal, room].join('\n')
expect('retired_someone_in_mind_copy_absent', !phase5Ui.toLowerCase().includes('someone in mind'))

// Explicit later-phase boundaries.
for (const forbidden of ['return after silence', 'remind me', 'pause correspondence', 'end correspondence', 'plus expansion']) {
  expect(`phase_boundary_absent_${forbidden.replaceAll(' ', '_')}`, !phase5Ui.toLowerCase().includes(forbidden))
}

const failed = checks.filter(([, pass]) => !pass)
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n${checks.length - failed.length}/${checks.length} Phase 5 checks passed.`)
if (failed.length) process.exitCode = 1
