// Same convention as the other migration tests — CI cannot execute
// Postgres, so the tracked SQL is inspected directly. The migration +
// verifier were also executed on real PostgreSQL (PGlite, outside the
// repo) with the real discover_people, get_member_introductions,
// publish_dispatch/update_dispatch and letters_for_participant; see the PR.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (n: string) => readFileSync(path.join(SQL_DIR, n), 'utf8').replace(/\r\n/g, '\n')
const migration = read('2026-10-16-account-lifecycle.sql')
const verify = read('2026-10-16-account-lifecycle-verify.sql')
const code = migration.replace(/^\s*--.*$/gm, '')

const fn = (name: string, end = '$function$;') => {
  const start = code.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf(end, start))
}
const close = () => fn('public.close_my_account')
const deactivate = () => fn('public.deactivate_my_account')
const reactivate = () => fn('public.reactivate_my_account')

describe('forward-only', () => {
  it('one transaction, NOT EXECUTED, never deletes auth users; only signature-replacing drops', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT EXECUTED')
    expect(code).not.toMatch(/delete from auth\.users/i)
    const drops = (code.match(/\bdrop\b[^;]*;/gi) ?? []).map((d) => d.replace(/\s+/g, ' '))
    // get_shared_dispatch keeps its exact signature/return shape, so it is
    // CREATE OR REPLACE'd with no drop.
    expect(drops).toEqual([
      'drop function if exists public.close_my_account();',
      'drop constraint letters_closed_fields_consistent;',
      'drop function if exists public.close_letter(uuid, text);',
    ])
  })

  it('lifecycle tables: RLS on, no member policy, no member privilege', () => {
    for (const t of ['account_closures', 'account_deactivations', 'letter_close_feedback']) {
      expect(code).toContain(`alter table public.${t} enable row level security;`)
      expect(code).toContain(`revoke all on public.${t} from public, anon, authenticated;`)
      expect(code).not.toMatch(new RegExp(`create policy[^;]*${t}`))
      expect(code).not.toMatch(new RegExp(`grant [^;]* on public\\.${t}`))
    }
  })
})

describe('permanent deletion — PR #19 rules unchanged, optional feedback added', () => {
  it('no TARGET account argument (only the optional reason); caller is auth.uid(); anon rejected', () => {
    expect(close()).toContain('public.close_my_account(\n  p_reason_code text default null,\n  p_reason_detail text default null\n)\nreturns jsonb')
    expect(close()).toContain('v_uid uuid := auth.uid();')
    expect(close()).toContain("if v_uid is null then\n    raise exception 'Authentication required.';")
    expect(code).toContain('revoke all on function public.close_my_account(text, text) from public, anon;')
    expect(code).toContain('grant execute on function public.close_my_account(text, text) to authenticated;')
  })

  it('reason validated before anything changes; detail only with something_else; stored with the closure', () => {
    const c = close()
    expect(c.indexOf("raise exception 'Unknown reason.'")).toBeLessThan(c.indexOf('insert into public.account_closures'))
    expect(c).toContain("if v_reason_code is distinct from 'something_else' then\n    v_reason_detail := null;")
    expect(c).toContain('insert into public.account_closures (user_id, storage_objects, reason_code, reason_detail)')
  })

  it('retry returns the recorded state; staff/official creators refused; closure recorded first', () => {
    const c = close()
    expect(c.indexOf("'already_closed', true")).toBeLessThan(c.indexOf('insert into public.account_closures'))
    expect(c).toContain('from public.staff_roles sr where sr.user_id = v_uid')
    expect(c).toContain("d.author_id = v_uid and d.published_as <> 'member'")
    const firstDestructive = Math.min(...['delete from public.', 'update public.'].map((x) => c.indexOf(x)).filter((i) => i > -1))
    expect(c.indexOf('insert into public.account_closures')).toBeLessThan(firstDestructive)
  })

  it('Safety / legal / correspondence records never deleted or modified; only member Dispatches', () => {
    for (const t of ['reports', 'safety_cases', 'safety_evaluations', 'safety_signals', 'safety_attempt_evidence', 'account_enforcement_state', 'admin_audit_log', 'legal_acceptances', 'letters', 'blocked_users', 'member_notices']) {
      expect(close()).not.toMatch(new RegExp(`(delete from|update)\\s+public\\.${t}\\b`))
    }
    expect(close()).toContain("set status = 'unpublished'\n  where author_id = v_uid and published_as = 'member'")
    expect(close()).not.toContain('letter-photos')
  })
})

describe('Part 5 — private closure helper', () => {
  it('account_is_closed is revoked from public, anon AND authenticated and never granted back', () => {
    expect(code).toContain('revoke all on function tempa_private.account_is_closed(uuid) from public, anon, authenticated;')
    expect(code).not.toMatch(/grant execute on function tempa_private\.account_is_closed/)
  })
})

describe('Take a break (reversible deactivation)', () => {
  it('append-only history with at most one open break', () => {
    expect(code).toContain('create table if not exists public.account_deactivations (')
    expect(code).toMatch(/create unique index if not exists account_deactivations_one_open\s+on public\.account_deactivations \(user_id\)\s+where reactivated_at is null;/)
  })

  it('self only: no target argument, auth.uid(), anon/PUBLIC revoked', () => {
    expect(deactivate()).toContain('public.deactivate_my_account(\n  p_reason_code text default null,\n  p_reason_detail text default null\n)')
    expect(deactivate()).toContain('v_uid uuid := auth.uid();')
    expect(reactivate()).toContain('public.reactivate_my_account()\nreturns jsonb')
    expect(code).toContain('revoke all on function public.deactivate_my_account(text, text) from public, anon;')
    expect(code).toContain('revoke all on function public.reactivate_my_account() from public, anon;')
  })

  it('never writes Safety enforcement state; deletes/unpublishes nothing', () => {
    for (const f of [deactivate(), reactivate()]) {
      expect(f).not.toContain('account_enforcement_state')
      expect(f).not.toMatch(/delete from|update public\.(dispatches|profiles|letters)/)
    }
  })

  it('staff / official-content creators cannot take a break (official content stays visible)', () => {
    expect(deactivate()).toContain('from public.staff_roles sr where sr.user_id = v_uid')
    expect(deactivate()).toContain("d.author_id = v_uid and d.published_as <> 'member'")
  })

  it('write gate mapping: closed -> banned, deactivated -> suspended; proxy sees the real lifecycle', () => {
    expect(fn('public.current_account_status', '$$;')).toMatch(/account_closures[\s\S]*then 'banned'[\s\S]*account_deactivations[\s\S]*then 'suspended'/)
    expect(fn('public.current_account_entry_state')).toContain("case public.my_account_lifecycle()\n      when 'closed' then 'closed'\n      when 'deactivated' then 'deactivated'")
  })

  it('hidden from discovery, public content and share links; profile visible only to existing correspondents', () => {
    expect(fn('tempa_private.hidden_from_discovery', '$$;')).toContain('public.account_deactivations d')
    expect(fn('tempa_private.author_content_publicly_visible', '$$;')).toContain('public.account_deactivations d')
    expect(code).toMatch(/create or replace view public\.public_profiles[\s\S]*account_deactivations ad[\s\S]*from public\.letters l/)
    expect(fn('public.get_shared_dispatch')).toContain("(d.published_as <> 'member' or tempa_private.author_content_publicly_visible(d.author_id))")
  })

  it('no new correspondence with a member on a break; emails suppressed without touching the preference', () => {
    expect(code).toContain('before insert on public.correspondences')
    const arrival = fn('public.resolve_arrival_email_context', '$$;')
    expect(arrival).toContain("'recipient_on_break'")
    expect(arrival).not.toMatch(/update\s+public\.arrival_email_preferences/)
  })

  it('break status only answers for the caller’s own correspondents', () => {
    expect(fn('public.correspondents_on_break', '$$;')).toContain('l.sender_id = auth.uid() and l.recipient_id = d.user_id')
  })
})

describe('first contact "Something else" — private feedback to Tempa', () => {
  const closeLetter = () => fn('public.close_letter')
  it('only the fixed marker can reach letters.close_reason; free text only with Something else, bounded', () => {
    const c = closeLetter()
    expect(c).toContain("raise exception 'Choose one of the listed reasons.'")
    expect(c).toContain('A written explanation is only accepted with Something else.')
    expect(c).toContain('char_length(v_detail) > 1000')
    expect(c).toContain('insert into public.letter_close_feedback (letter_id, recipient_id, detail)')
    expect(c).toContain('and recipient_id = auth.uid()')
    expect(code).toContain('grant execute on function public.close_letter(uuid, text, text) to authenticated;')
  })

  it('constraint admits exactly the three presets plus the marker; the participant view is untouched', () => {
    expect(code).toContain("'I''m taking a break from new letters.',\n        'Something else'\n      )")
    expect(code).not.toContain('create or replace view public.letters_for_participant')
  })
})

describe('admin account-exit feedback', () => {
  it('staff gated, no identities returned', () => {
    const f = fn('public.admin_account_exit_feedback')
    expect(f).toContain("if not public.is_staff() then\n    raise exception 'Staff only.';")
    expect(f).not.toMatch(/'(user_id|recipient_id|email|date_of_birth)'\s*,/)
    expect(code).toContain('revoke all on function public.admin_account_exit_feedback(timestamptz) from public, anon;')
  })
})

describe('verifier', () => {
  it('read-only with a single overall_pass covering the key invariants', () => {
    const v = verify.replace(/^\s*--.*$/gm, '').replace(/'[^']*'/g, "''").toLowerCase()
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/)
    expect((v.match(/as overall_pass/g) ?? []).length).toBe(1)
    for (const c of ['no_target_account_argument', 'self_scoped', 'anon_cannot_call', 'no_public_execute', 'staff_protection', 'deletion_retains_safety_and_legal', 'deactivation_separate_from_safety', 'discovery_excludes_closed_and_deactivated', 'introductions_use_public_profiles', 'closed_helper_not_authenticated', 'closed_helper_not_anon', 'private_detail_not_in_participant_view', 'feedback_staff_gated', 'emails_suppressed_preference_kept']) {
      expect(v).toContain(c)
    }
  })
})
