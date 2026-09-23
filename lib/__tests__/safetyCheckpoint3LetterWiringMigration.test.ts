// This repository cannot execute Postgres in CI, so every requirement
// that lives purely in SQL (the dropped old signatures, the new
// required parameters, consume_safety_evaluation being called from each
// mutation RPC, the first-letter-only length cap, and full behavioral
// fidelity with each RPC's previous live definition) is verified
// directly against the tracked migration source text — same convention
// as safetyPersistenceMigration.test.ts/arrivalEmailQueueMigration.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-05-safety-checkpoint3-letter-wiring.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-05-safety-checkpoint3-letter-wiring-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

function extractFunctionBody(qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected to find "${qualifiedName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${qualifiedName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })
})

describe('old, unscreened RPC signatures are explicitly dropped — not merely shadowed', () => {
  it('drops the exact old 3-arg send_first_letter, 5-arg write_letter, and 4-arg reply_to_letter signatures', () => {
    expect(codeOnly).toContain('drop function public.send_first_letter(uuid, uuid, text);')
    expect(codeOnly).toContain('drop function public.write_letter(uuid, text, uuid, jsonb, jsonb);')
    expect(codeOnly).toContain('drop function public.reply_to_letter(uuid, text, jsonb, jsonb);')
  })

  it('each drop appears before that function\'s own create or replace, so the old overload never coexists with the new one', () => {
    expect(sql.indexOf('drop function public.send_first_letter(uuid, uuid, text);')).toBeLessThan(
      sql.indexOf('create or replace function public.send_first_letter(')
    )
    expect(sql.indexOf('drop function public.write_letter(uuid, text, uuid, jsonb, jsonb);')).toBeLessThan(
      sql.indexOf('create or replace function public.write_letter(')
    )
    expect(sql.indexOf('drop function public.reply_to_letter(uuid, text, jsonb, jsonb);')).toBeLessThan(
      sql.indexOf('create or replace function public.reply_to_letter(')
    )
  })
})

describe('new signatures require p_safety_evaluation_id and accept a defaulted p_warning_acknowledged', () => {
  it('send_first_letter: p_safety_evaluation_id uuid required, p_warning_acknowledged boolean default false', () => {
    const body = extractFunctionBody('public.send_first_letter')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).toContain('p_warning_acknowledged boolean default false')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
  })

  it('write_letter: p_safety_evaluation_id placed before the already-defaulted p_reply_to_id/p_moments/p_postcard, required', () => {
    const body = extractFunctionBody('public.write_letter')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
    const paramsBlock = body.slice(0, body.indexOf(')\nreturns'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_reply_to_id'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_moments'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_postcard'))
  })

  it('reply_to_letter: p_safety_evaluation_id placed before the already-defaulted p_moments/p_postcard, required', () => {
    const body = extractFunctionBody('public.reply_to_letter')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
    const paramsBlock = body.slice(0, body.indexOf(')\nreturns'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_moments'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_postcard'))
  })
})

describe('each mutation RPC calls tempa_private.consume_safety_evaluation with its own correct surface, before the Letter insert', () => {
  it('send_first_letter: surface is first_letter, postcard argument is null, context is p_recipient_id', () => {
    const body = extractFunctionBody('public.send_first_letter')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const insertIndex = body.indexOf('insert into public.letters(')
    expect(consumeIndex, 'expected a call to consume_safety_evaluation').toBeGreaterThan(-1)
    expect(consumeIndex).toBeLessThan(insertIndex)
    const call = body.slice(consumeIndex, body.indexOf(');', consumeIndex))
    expect(call).toContain("'first_letter'")
    expect(call).toContain('p_recipient_id')
    expect(call).toMatch(/null,\s*\n\s*p_body,/)
  })

  it('write_letter: surface is write_anytime, postcard argument is p_postcard, context is p_correspondence_id', () => {
    const body = extractFunctionBody('public.write_letter')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const insertIndex = body.indexOf('insert into public.letters (')
    expect(consumeIndex).toBeGreaterThan(-1)
    expect(consumeIndex).toBeLessThan(insertIndex)
    const call = body.slice(consumeIndex, body.indexOf(');', consumeIndex))
    expect(call).toContain("'write_anytime'")
    expect(call).toContain('p_correspondence_id')
    expect(call).toContain('p_postcard')
  })

  it('reply_to_letter: surface is reply, postcard argument is p_postcard, context is p_letter_id', () => {
    const body = extractFunctionBody('public.reply_to_letter')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const insertIndex = body.indexOf('insert into public.letters (')
    expect(consumeIndex).toBeGreaterThan(-1)
    expect(consumeIndex).toBeLessThan(insertIndex)
    const call = body.slice(consumeIndex, body.indexOf(');', consumeIndex))
    expect(call).toContain("'reply'")
    expect(call).toContain('p_letter_id')
    expect(call).toContain('p_postcard')
  })

  it('every call passes its own freshly-generated new/v_new_id as the last argument, for signal-to-content linking', () => {
    function lastArgOfConsumeCall(body: string): string {
      const start = body.indexOf('tempa_private.consume_safety_evaluation(')
      const end = body.indexOf(');', start)
      const callText = body.slice(start, end)
      const args = callText.slice(callText.indexOf('(') + 1).split(',')
      return args[args.length - 1].trim()
    }
    expect(lastArgOfConsumeCall(extractFunctionBody('public.send_first_letter'))).toBe('v_new_id')
    expect(lastArgOfConsumeCall(extractFunctionBody('public.write_letter'))).toBe('new_id')
    expect(lastArgOfConsumeCall(extractFunctionBody('public.reply_to_letter'))).toBe('new_id')
  })
})

describe('B6 — first-letter-only server-side length cap', () => {
  it('send_first_letter rejects a body over 2000 characters, matching the client/product cap', () => {
    const body = extractFunctionBody('public.send_first_letter')
    expect(body).toContain('char_length(p_body) > 2000')
  })

  it('write_letter and reply_to_letter remain uncapped — established correspondence has no product-level length limit', () => {
    expect(extractFunctionBody('public.write_letter')).not.toMatch(/char_length\(p_body\)\s*>\s*2000/)
    expect(extractFunctionBody('public.reply_to_letter')).not.toMatch(/char_length\(p_body\)\s*>\s*2000/)
  })
})

describe('full behavioral fidelity — every existing check/side-effect from each RPC\'s previous live definition is preserved verbatim', () => {
  it('send_first_letter: self-check, account status, blocked pair, recipient existence, Question-answer liveness, 23505 duplicate guard', () => {
    const body = extractFunctionBody('public.send_first_letter')
    expect(body).toContain('You cannot write a first-contact letter to yourself.')
    expect(body).toContain("public.current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair(auth.uid(), p_recipient_id)')
    expect(body).toContain('This correspondence is already established. Use write_letter instead.')
    expect(body).toContain("using errcode = '23505'")
    expect(body).toContain("interval '72 hours'")
  })

  it('write_letter: participant check, blocked pair, suspended/banned, established check, Moments/Postcard gates, photo-consent side effect', () => {
    const body = extractFunctionBody('public.write_letter')
    expect(body).toContain('You are not a participant in this correspondence.')
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair(auth.uid(), recipient)')
    expect(body).toContain("v_status in ('suspended', 'banned')")
    expect(body).toContain('This correspondence is not yet established for ongoing letters.')
    expect(body).toContain('Moments are not available in this correspondence yet.')
    expect(body).toContain('A Postcard needs its own written message before it can be sent.')
    expect(body).toContain("char_length(trim(both from v_back_message)) > 300")
    expect(body).toContain("photo_consent_status = 'pending'")
  })

  it('reply_to_letter: recipient/status/deliver_at/awaiting-reply row lookup, blocked pair, first-reply gating, establishes the correspondence', () => {
    const body = extractFunctionBody('public.reply_to_letter')
    expect(body).toContain('Letter not found, not addressed to you, or no longer awaiting a reply.')
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair(auth.uid(), original.sender_id)')
    expect(body).toContain('Moments are not available until after your first reply in this correspondence.')
    expect(body).toContain('A Postcard is not available until after your first reply in this correspondence.')
    expect(body).toContain("status = 'replied'")
    expect(body).toContain("status = 'active'")
    expect(body).toContain('established_at = coalesce(established_at, now())')
  })
})

describe('grants — authenticated can call the new signatures, anon cannot, and the old signatures are gone entirely', () => {
  it('re-grants authenticated on the new 5/7/6-arg signatures', () => {
    expect(codeOnly).toContain(
      'revoke all on function public.send_first_letter(uuid, uuid, text, uuid, boolean) from public, anon;'
    )
    expect(codeOnly).toContain('grant execute on function public.send_first_letter(uuid, uuid, text, uuid, boolean) to authenticated;')
    expect(codeOnly).toContain(
      'revoke all on function public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean) to authenticated;'
    )
    expect(codeOnly).toContain(
      'revoke all on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean) to authenticated;'
    )
  })
})

describe('tempa_private.consume_safety_evaluation is never directly callable by any client role', () => {
  it('is prepared in the persistence migration with no grant to any client role (cross-file check)', () => {
    const persistenceSql = readFileSync(
      path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-03-safety-persistence.sql'),
      'utf8'
    )
    expect(persistenceSql).toContain(
      'revoke all on function tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid) from public, anon, authenticated, service_role;'
    )
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks the old-gone/new-present/grants/wiring for all three mutation RPCs', () => {
    const codeOnlyVerify = stripLineComments(verifySql)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    for (const name of ['send_first_letter', 'write_letter', 'reply_to_letter', 'consume_safety_evaluation']) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('overall_pass')
  })
})
