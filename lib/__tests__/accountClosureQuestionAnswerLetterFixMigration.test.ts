// Forward-only fix for the second production account-deletion failure:
// P0001 "Letters are immutable except for their lifecycle status fields."
// close_my_account deletes the member's Question answers; the 2026-08-30
// FK letters.question_answer_id ON DELETE SET NULL then updates other
// members' letters, which the 2026-09-04 immutability trigger rejected.
// CI cannot run Postgres, so the SQL contract is pinned to the tracked
// text; behaviour was proven on real PostgreSQL (PGlite) with the real
// trigger and FKs — see the PR description.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const fix = read('2026-10-19-account-closure-question-answer-letter-fix.sql')
const verify = read('2026-10-19-account-closure-question-answer-letter-fix-verify.sql')
const letters = read('2026-08-30-letters.sql')
const mailCall = read('2026-09-04-mail-call-atomic-deployment.sql')

function fn(src: string, header: string): string {
  const start = src.indexOf(header)
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('$function$;', src.indexOf('$function$', start) + 10)
  return src.slice(start, end + '$function$;'.length)
}
const code = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '').trimEnd()).filter((l) => l.trim() !== '')
const TRIGGER = 'create or replace function public.enforce_letter_immutability()'

describe('2026-10-19 account closure: Question answers referenced by letters', () => {
  it('reproduces the production premise: the FK asks for SET NULL, the live trigger forbids it', () => {
    expect(letters).toMatch(/question_answer_id uuid\n\s+references public\.question_answers\(id\)\n\s+on delete set null/)
    expect(fn(mailCall, TRIGGER)).toContain('or new.question_answer_id is distinct from old.question_answer_id')
  })

  it('is one forward-only transaction, not yet executed, and leaves close_my_account alone', () => {
    expect((fix.match(/^begin;/m) ?? []).length).toBe(1)
    expect((fix.match(/^commit;/m) ?? []).length).toBe(1)
    expect(fix).toContain('STATUS: NOT EXECUTED')
    const body = code(fix).join('\n')
    expect(body).not.toMatch(/close_my_account|drop trigger|drop function|alter table|disable trigger|drop constraint/i)
  })

  it('the trigger differs from the live 2026-09-04 definition ONLY by the narrow early exception', () => {
    const live = code(fn(mailCall, TRIGGER))
    const fixed = code(fn(fix, TRIGGER))
    const removed = live.filter((l) => !fixed.includes(l))
    expect(removed).toEqual([])
    expect(fixed.filter((l) => !live.includes(l))).toEqual([
      '        old.question_answer_id is not null',
      '    and new.question_answer_id is null',
      "    and (to_jsonb(new) - 'question_answer_id' - 'body_search')",
      "        = (to_jsonb(old) - 'question_answer_id' - 'body_search')",
      '    and tempa_private.letter_question_answer_is_deleted(old.question_answer_id)',
      '    return new;',
    ])
    // the exception runs before, and does not replace, every original rule
    const joined = fixed.join('\n')
    expect(joined.indexOf('letter_question_answer_is_deleted')).toBeLessThan(joined.indexOf('new.sender_id <> old.sender_id'))
  })

  it('the helper is SECURITY DEFINER, pinned search_path, answer-absence only, not client-callable', () => {
    const helper = fn(fix, 'create or replace function tempa_private.letter_question_answer_is_deleted(')
    expect(helper).toContain('security definer')
    expect(helper).toContain("set search_path to 'pg_catalog'")
    expect(helper).toContain('not exists (select 1 from public.question_answers qa where qa.id = p_question_answer_id)')
    expect(fix).toContain('revoke all on function tempa_private.letter_question_answer_is_deleted(uuid) from public, anon, authenticated;')
    expect(fix).not.toMatch(/grant execute on function tempa_private\.letter_question_answer_is_deleted/)
  })

  it('verifier is one read-only SELECT with overall_pass and the fix-specific checks', () => {
    const v = code(verify).join('\n').replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public|trigger)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of [
      'immutability_trigger_installed',
      'exception_is_null_only_whole_row_and_answer_deleted',
      'original_field_rules_intact',
      'terminal_state_rule_intact',
      'helper_not_client_callable',
      'members_cannot_update_letters',
      'question_answer_fk_on_delete_set_null',
      'closure_function_keeps_10_18_fix',
      'overall_pass',
    ]) {
      expect(verify).toContain(col)
    }
  })
})
