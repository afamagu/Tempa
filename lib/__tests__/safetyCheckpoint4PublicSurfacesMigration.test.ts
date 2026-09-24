// Same convention as safetyCheckpoint3LetterWiringMigration.test.ts /
// safetyPersistenceMigration.test.ts — this repository cannot execute
// Postgres in CI, so every requirement that lives purely in SQL (the
// dropped old signatures, the new required parameters, consume_safety_
// evaluation being called from each mutation RPC with the right surface/
// context, the raw-table grant/policy closures, and full behavioral
// fidelity with each RPC's previous live definition) is verified
// directly against the tracked migration source text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-06-safety-checkpoint4-public-surfaces.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-06-safety-checkpoint4-public-surfaces-verify.sql')
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

describe('one BEGIN/COMMIT for the RPC wiring, not yet applied', () => {
  it('wraps the RPC wiring in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })

  it('the raw-grant revocations happen INSIDE the begin block (Checkpoint 10 preflight correction — the whole file is one all-or-nothing transaction, never partially-applied DDL run in autocommit mode)', () => {
    const beginIndex = sql.indexOf('\nbegin;')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(sql.indexOf('drop policy dispatches_insert_own')).toBeGreaterThan(beginIndex)
    expect(sql.indexOf('revoke insert on public.dispatches from authenticated;')).toBeGreaterThan(beginIndex)
    expect(sql.indexOf('drop policy dispatch_topics_insert_own')).toBeGreaterThan(beginIndex)
    expect(sql.indexOf('revoke insert on public.dispatch_topics from authenticated;')).toBeGreaterThan(beginIndex)
  })
})

describe('mutation-boundary audit — raw-table INSERT bypass on dispatches/dispatch_topics is closed', () => {
  it('drops the dispatches_insert_own and dispatch_topics_insert_own RLS policies and revokes INSERT', () => {
    expect(codeOnly).toContain('drop policy dispatches_insert_own on public.dispatches;')
    expect(codeOnly).toContain('revoke insert on public.dispatches from authenticated;')
    expect(codeOnly).toContain('drop policy dispatch_topics_insert_own on public.dispatch_topics;')
    expect(codeOnly).toContain('revoke insert on public.dispatch_topics from authenticated;')
  })

  it('documents that publish_dispatch/update_dispatch are SECURITY DEFINER, so revoking the raw grant does not break them', () => {
    expect(sql).toMatch(/SECURITY DEFINER[\s\S]*runs as the function's OWNER|security definer[\s\S]*owner privilege/i)
  })
})

describe('old, unscreened RPC signatures are explicitly dropped — not merely shadowed', () => {
  it('drops the exact old signatures for all four Checkpoint 4 mutation RPCs', () => {
    expect(codeOnly).toContain('drop function public.publish_dispatch(text, text, text[], jsonb, jsonb);')
    expect(codeOnly).toContain('drop function public.update_dispatch(uuid, text, text, text[], jsonb);')
    expect(codeOnly).toContain('drop function public.publish_question_answer(uuid, text);')
    expect(codeOnly).toContain('drop function public.create_reply(uuid, text, uuid);')
  })

  it('each drop appears before that function\'s own create or replace, so the old overload never coexists with the new one', () => {
    expect(sql.indexOf('drop function public.publish_dispatch(text, text, text[], jsonb, jsonb);')).toBeLessThan(
      sql.indexOf('create or replace function public.publish_dispatch(')
    )
    expect(sql.indexOf('drop function public.update_dispatch(uuid, text, text, text[], jsonb);')).toBeLessThan(
      sql.indexOf('create or replace function public.update_dispatch(')
    )
    expect(sql.indexOf('drop function public.publish_question_answer(uuid, text);')).toBeLessThan(
      sql.indexOf('create or replace function public.publish_question_answer(')
    )
    expect(sql.indexOf('drop function public.create_reply(uuid, text, uuid);')).toBeLessThan(
      sql.indexOf('create or replace function public.create_reply(')
    )
  })
})

describe('new signatures require p_safety_evaluation_id and accept a defaulted p_warning_acknowledged', () => {
  it('publish_dispatch: p_safety_evaluation_id required, placed before defaulted p_topics/p_moments/p_postcard', () => {
    const body = extractFunctionBody('public.publish_dispatch')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
    expect(body).toContain('p_warning_acknowledged boolean default false')
    const paramsBlock = body.slice(0, body.indexOf(')\nreturns'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_topics'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_moments'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_postcard'))
  })

  it('update_dispatch: p_safety_evaluation_id required, placed before defaulted p_topics/p_moments, no p_postcard param', () => {
    const body = extractFunctionBody('public.update_dispatch')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
    expect(body).toContain('p_warning_acknowledged boolean default false')
    const paramsBlock = body.slice(0, body.indexOf(')\nreturns'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_topics'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_moments'))
    expect(paramsBlock).not.toContain('p_postcard')
  })

  it('publish_question_answer: p_safety_evaluation_id required, p_warning_acknowledged defaulted', () => {
    const body = extractFunctionBody('public.publish_question_answer')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
    expect(body).toContain('p_warning_acknowledged boolean default false')
  })

  it('create_reply: p_safety_evaluation_id required, placed before the already-defaulted p_parent_reply_id', () => {
    const body = extractFunctionBody('public.create_reply')
    expect(body).toContain('p_safety_evaluation_id uuid,')
    expect(body).not.toMatch(/p_safety_evaluation_id uuid default/)
    expect(body).toContain('p_warning_acknowledged boolean default false')
    const paramsBlock = body.slice(0, body.indexOf(')\nreturns'))
    expect(paramsBlock.indexOf('p_safety_evaluation_id')).toBeLessThan(paramsBlock.indexOf('p_parent_reply_id'))
  })
})

describe('each mutation RPC calls tempa_private.consume_safety_evaluation with its own correct surface/context, before the content mutation', () => {
  it('publish_dispatch: surface dispatch_publish, context is own auth.uid(), title/topics/postcard/body all bound, id generated first', () => {
    const body = extractFunctionBody('public.publish_dispatch')
    const idGenIndex = body.indexOf('new_id := pg_catalog.gen_random_uuid();')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const insertIndex = body.indexOf('insert into public.dispatches')
    expect(idGenIndex).toBeGreaterThan(-1)
    expect(idGenIndex).toBeLessThan(consumeIndex)
    expect(consumeIndex).toBeLessThan(insertIndex)
    const call = body.slice(consumeIndex, body.indexOf(');', consumeIndex))
    expect(call).toContain("'dispatch_publish'")
    expect(call).toContain('auth.uid()')
    expect(call).toContain('p_title')
    expect(call).toContain('normalized_topics')
    expect(call).toContain('p_postcard')
    expect(call).toContain('p_body')
    expect(call.trim().endsWith('new_id')).toBe(true)
  })

  it('update_dispatch: surface dispatch_update, context and resulting content id are p_dispatch_id, no postcard argument, locked before consume', () => {
    const body = extractFunctionBody('public.update_dispatch')
    const lockIndex = body.indexOf('for update;')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const updateIndex = body.indexOf('update public.dispatches')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(consumeIndex)
    expect(consumeIndex).toBeLessThan(updateIndex)
    const call = body.slice(consumeIndex, body.indexOf(');', consumeIndex))
    expect(call).toContain("'dispatch_update'")
    expect(call).toContain('p_dispatch_id')
    expect(call).not.toContain('p_postcard')
    expect(call.trim().endsWith('p_dispatch_id')).toBe(true)
  })

  it('publish_question_answer: surface question_answer, context is p_question_id, target row id resolved/locked before consume', () => {
    const body = extractFunctionBody('public.publish_question_answer')
    const lockIndex = body.indexOf('for update;')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const upsertIndex = body.indexOf('insert into public.question_answers')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(consumeIndex)
    expect(consumeIndex).toBeLessThan(upsertIndex)
    const call = body.slice(consumeIndex, body.indexOf(');', consumeIndex))
    expect(call).toContain("'question_answer'")
    expect(call).toContain('p_question_id')
    expect(call).toContain('p_body')
    expect(call.trim().endsWith('v_answer_id')).toBe(true)
  })

  it('publish_question_answer: the upsert insert column list explicitly includes the pre-resolved id', () => {
    const body = extractFunctionBody('public.publish_question_answer')
    const upsertStart = body.indexOf('insert into public.question_answers(')
    const upsertBlock = body.slice(upsertStart, body.indexOf(';', upsertStart))
    expect(upsertBlock).toContain('id, user_id, question_id')
    expect(upsertBlock).toContain('values (v_answer_id,')
  })

  it('create_reply: surface dispatch_reply, context is p_dispatch_id, secondary context is p_parent_reply_id, id generated first', () => {
    const body = extractFunctionBody('public.create_reply')
    const idGenIndex = body.indexOf('v_new_id := pg_catalog.gen_random_uuid();')
    const consumeIndex = body.indexOf('tempa_private.consume_safety_evaluation(')
    const insertIndex = body.indexOf('insert into public.dispatch_replies')
    expect(idGenIndex).toBeGreaterThan(-1)
    expect(idGenIndex).toBeLessThan(consumeIndex)
    expect(consumeIndex).toBeLessThan(insertIndex)
    const call = stripLineComments(body).slice(
      stripLineComments(body).indexOf('tempa_private.consume_safety_evaluation('),
      stripLineComments(body).indexOf(');', stripLineComments(body).indexOf('tempa_private.consume_safety_evaluation('))
    )
    expect(call).toContain("'dispatch_reply'")
    expect(call).toContain('p_dispatch_id')
    expect(call).toContain('p_parent_reply_id')
    expect(call.trim().endsWith('v_new_id')).toBe(true)
  })

  it('every consume_safety_evaluation call passes exactly 12 positional arguments, matching the extended shared function', () => {
    for (const fn of ['public.publish_dispatch', 'public.update_dispatch', 'public.publish_question_answer', 'public.create_reply']) {
      const body = stripLineComments(extractFunctionBody(fn))
      const start = body.indexOf('tempa_private.consume_safety_evaluation(')
      const end = body.indexOf(');', start)
      const callText = body.slice(start, end)
      const args = callText
        .slice(callText.indexOf('(') + 1)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      expect(args.length, `${fn} consume_safety_evaluation call`).toBe(12)
    }
  })
})

describe('full behavioral fidelity — every existing check/side-effect from each RPC\'s previous live definition is preserved verbatim', () => {
  it('publish_dispatch: account status gate, title/topic validation, Postcard shape rules, Moments position/consent checks', () => {
    const body = extractFunctionBody('public.publish_dispatch')
    expect(body).toContain("public.current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(body).toContain('A Dispatch needs a title.')
    expect(body).toContain('char_length(p_title) > 140')
    expect(body).toContain('A Dispatch may carry at most 3 topics.')
    expect(body).toContain("A Postcard''s Reveal Line is too long.")
    expect(body).toContain('A Postcard needs its own written message before it can be published.')
    expect(body).toContain('Only still-image Moments are supported in a Dispatch.')
    expect(body).toContain('A Moment photo must belong to the author.')
  })

  it('update_dispatch: ownership+published+FOR UPDATE lock, 30-minute edit window, Reply lock, title/topic validation', () => {
    const body = extractFunctionBody('public.update_dispatch')
    expect(body).toContain('Only the author of a published Dispatch may edit it.')
    expect(body).toContain("interval '30 minutes'")
    expect(body).toContain('This Dispatch can no longer be edited.')
    expect(body).toContain('A Dispatch needs a title.')
    expect(body).toContain('A Dispatch may carry at most 3 topics.')
  })

  it('publish_question_answer: is_active gate, hidden-freeze (new, Checkpoint-4-specific), promotion semantics, flagship onboarding side effect', () => {
    const body = extractFunctionBody('public.publish_question_answer')
    expect(body).toContain('This Question is no longer accepting answers.')
    expect(body).toContain("existing_moderation_status = 'hidden'")
    expect(body).toContain('This answer has been hidden and cannot be edited.')
    expect(body).toContain('should_promote')
    expect(body).toContain('is_flagship')
  })

  it('create_reply: account status gate, body trim/length 1-500, Dispatch FOR SHARE lock+visibility, full-scope block, nested-parent checks', () => {
    const body = extractFunctionBody('public.create_reply')
    expect(body).toContain("public.current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(body).toContain('A Reply needs some writing.')
    expect(body).toContain('char_length(v_body) > 500')
    expect(body).toContain('for share')
    expect(body).toContain('This Dispatch is not open to Replies right now.')
    expect(body).toContain('tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)')
    expect(body).toContain('tempa_private.author_content_publicly_visible(v_dispatch.author_id)')
    expect(body).toContain('The Reply you are answering no longer exists.')
    expect(body).toContain('That Reply does not belong to this Dispatch.')
    expect(body).toContain('That Reply is no longer available to answer.')
    expect(body).toContain('tempa_private.is_blocked_pair(auth.uid(), v_parent.author_id)')
  })

  it('create_reply never uses is_correspondence_blocked_pair (Letters/Stop-letters-scope only) — full-scope block only', () => {
    const body = stripLineComments(extractFunctionBody('public.create_reply'))
    expect(body).not.toContain('is_correspondence_blocked_pair')
  })
})

describe('grants — authenticated can call the new signatures, anon cannot, and the old signatures are gone entirely', () => {
  it('re-grants authenticated on the new signatures for all four Checkpoint 4 RPCs', () => {
    expect(codeOnly).toContain(
      'grant execute on function public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean) to authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean) to authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.publish_question_answer(uuid, text, uuid, boolean) to authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.create_reply(uuid, text, uuid, uuid, boolean) to authenticated;'
    )
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks old-gone/new-present/grants/wiring/raw-table-bypass-closed for all four mutation RPCs', () => {
    const codeOnlyVerify = stripLineComments(verifySql)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index|policy)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    for (const name of ['publish_dispatch', 'update_dispatch', 'publish_question_answer', 'create_reply', 'consume_safety_evaluation']) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('dispatches_insert_own_policy_gone')
    expect(verifySql).toContain('authenticated_cannot_insert_dispatches_directly')
    expect(verifySql).toContain('authenticated_can_still_read_dispatches')
    expect(verifySql).toContain('overall_pass')
  })
})
