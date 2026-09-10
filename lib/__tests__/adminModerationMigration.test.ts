// Admin Command Center Phase 2A-1 — this repository cannot execute
// Postgres, so every requirement that lives purely in SQL (column-level
// protection, RLS predicates, permission floors, the immutability
// guard, the delete_dispatch enforcement gap fix) is verified directly
// against the tracked migration source text, the same convention as
// adminOverviewMigration.test.ts / publishDispatchMigration.test.ts /
// blockUserOverloadMigration.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-10-admin-moderation-and-questions.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')

const REPO_ROOT = path.join(__dirname, '..', '..')

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.git')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function extractFunctionBody(functionName: string): string {
  const start = sql.indexOf(`create or replace function public.${functionName}(`)
  expect(start, `expected to find "${functionName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  // Most functions here are `language plpgsql` and close with
  // `$function$;`; search_dispatches is a one-line `language sql`
  // function closing with a bare `$$;` — take whichever terminator
  // actually appears first after `start`.
  const candidates = ['$function$;', '$$;']
    .map((marker) => sql.indexOf(marker, start))
    .filter((idx) => idx !== -1)
  const end = Math.min(...candidates)
  expect(end, `expected a closing $function$; or $$; for "${functionName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('moderation state model — smallest safe columns, no side table, no leaking fields', () => {
  it('adds moderation_status + moderated_at directly to dispatches and question_answers', () => {
    expect(sql).toContain('alter table public.dispatches')
    expect(sql).toContain("check (moderation_status in ('visible', 'hidden'))")
    expect(sql).toContain('alter table public.question_answers')
    expect((sql.match(/check \(moderation_status in \('visible', 'hidden'\)\)/g) ?? []).length).toBe(2)
  })

  it('never creates a polymorphic (content_type, content_id) moderation side table', () => {
    expect(sql).not.toMatch(/create table[^;]*content_type[^;]*content_id/i)
  })

  it('never adds moderation_reason or moderated_by as an actual column — the header comment discusses their deliberate absence, but no `alter table`/`add column` introduces either', () => {
    expect(sql).not.toMatch(/add column moderation_reason/)
    expect(sql).not.toMatch(/add column moderated_by/)
  })
})

describe('column-level protection (§7), widened per the final mutation-boundary audit', () => {
  it('revokes UPDATE and DELETE on dispatches from authenticated (INSERT stays — publish_dispatch is a legitimate direct path)', () => {
    expect(sql).toContain('revoke update, delete on public.dispatches from authenticated;')
  })

  it('revokes INSERT, UPDATE, AND DELETE on question_answers from authenticated — no direct path remains legitimate once publish_question_answer/set_current_answer are SECURITY DEFINER', () => {
    expect(sql).toContain('revoke insert, update, delete on public.question_answers from authenticated;')
  })

  it('scans every non-test .ts/.tsx source file for a direct insert/upsert against question_answers too — not just update', () => {
    const files = listSourceFiles(path.join(REPO_ROOT, 'app')).concat(listSourceFiles(path.join(REPO_ROOT, 'lib')))
    const offenders: string[] = []
    const forbidden = [
      /from\(\s*['"]question_answers['"]\s*\)\s*\.\s*insert\s*\(/,
      /from\(\s*['"]question_answers['"]\s*\)\s*\.\s*upsert\s*\(/,
    ]
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      if (forbidden.some((re) => re.test(content))) {
        offenders.push(path.relative(REPO_ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('dispatches_insert_own — moderation-state integrity (final mutation-boundary audit)', () => {
  it('requires moderation_status = visible and moderated_at is null on any raw insert', () => {
    const start = sql.indexOf('create policy dispatches_insert_own')
    expect(start).toBeGreaterThan(-1)
    const end = sql.indexOf(';', start)
    const policy = sql.slice(start, end)
    expect(policy).toContain('author_id = auth.uid()')
    expect(policy).toContain("moderation_status = 'visible'")
    expect(policy).toContain('moderated_at is null')
  })

  it('publish_dispatch\'s own live INSERT statement never references moderation_status/moderated_at — the tightened policy cannot break it', () => {
    // publish_dispatch itself isn't reproduced in this migration (it's
    // unrelated to the moderation/questions work) — check its actual
    // live INSERT column list directly, so this guard breaks loudly if
    // that function is ever edited to touch either new column without
    // this policy being revisited.
    const livePath = path.join(REPO_ROOT, 'docs', 'sql', '2026-09-12-scoped-blocking-and-fixes.sql')
    const liveSql = readFileSync(livePath, 'utf8')
    const insertStart = liveSql.indexOf('insert into public.dispatches (')
    expect(insertStart).toBeGreaterThan(-1)
    const columnListEnd = liveSql.indexOf(')', insertStart)
    const columnList = liveSql.slice(insertStart, columnListEnd)
    expect(columnList).not.toContain('moderation_status')
    expect(columnList).not.toContain('moderated_at')
  })
})

describe('dispatch visibility — RLS + every RLS-bypassing read path', () => {
  it('dispatches_select_published requires moderation_status = visible for anyone but the author', () => {
    const start = sql.indexOf('create policy dispatches_select_published')
    const end = sql.indexOf(';', start)
    const policy = sql.slice(start, end)
    expect(policy).toContain("moderation_status = 'visible'")
    expect(policy).toContain('or author_id = auth.uid()')
  })

  it('search_dispatches (SECURITY INVOKER) still filters moderation_status itself, never relying solely on the author-exception leaking into search', () => {
    const body = extractFunctionBody('search_dispatches')
    expect(body).toContain("d.moderation_status = 'visible'")
  })

  it('get_shared_dispatch (SECURITY DEFINER, bypasses RLS) requires moderation_status = visible for the token to resolve at all', () => {
    const body = extractFunctionBody('get_shared_dispatch')
    expect(body).toContain("and d.moderation_status = 'visible';")
  })
})

describe('question-answer visibility — RLS + every RLS-bypassing read path', () => {
  it('the cross-user read policy requires moderation_status = visible', () => {
    // The policy name string also appears in its own `drop policy`
    // statement just above — anchor on the `create policy` line
    // specifically so this grabs the USING clause, not the drop.
    const start = sql.indexOf(
      'create policy "Answers to active questions are readable by authenticated users"'
    )
    expect(start).toBeGreaterThan(-1)
    const end = sql.indexOf(';', start)
    const policy = sql.slice(start, end)
    expect(policy).toContain("question_answers.moderation_status = 'visible'")
    expect(policy).toContain('is_blocked_pair')
  })

  it('get_post_closure_recommendations (SECURITY DEFINER) never recommends a hidden answer', () => {
    const body = extractFunctionBody('get_post_closure_recommendations')
    expect(body).toContain("qa.moderation_status = 'visible'")
  })

  it('independent review item 10: get_post_closure_recommendations is hardened to search_path pg_catalog, not public', () => {
    const start = sql.indexOf('create or replace function public.get_post_closure_recommendations(')
    const searchPathIndex = sql.indexOf("set search_path to", start)
    expect(searchPathIndex).toBeGreaterThan(start)
    expect(sql.slice(searchPathIndex, searchPathIndex + 40)).toContain("'pg_catalog'")
  })
})

describe('independent review item 6 — is_current is confirmed NOT a visibility predicate', () => {
  it('the cross-user question_answers SELECT policy never filters on is_current', () => {
    const start = sql.indexOf(
      'create policy "Answers to active questions are readable by authenticated users"'
    )
    const end = sql.indexOf(';', start)
    const policy = sql.slice(start, end)
    expect(policy).not.toContain('is_current')
  })

  it('the migration header documents the confirmed IS_CURRENT meaning before any change was made', () => {
    expect(sql).toContain('IS_CURRENT')
    expect(sql).toMatch(/is_current[\s\S]*NOT a general publication\/visibility gate/)
  })
})

describe('question_answer reportability (Decision 1)', () => {
  it('widens the target_type check constraint to include question_answer', () => {
    expect(sql).toContain(
      "check (target_type in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer'));"
    )
  })

  it('report_content gains a question_answer branch requiring the same visibility predicate as the read policy', () => {
    const body = extractFunctionBody('report_content')
    expect(body).toContain("p_target_type = 'question_answer'")
    const branchStart = body.indexOf("p_target_type = 'question_answer'")
    const branch = body.slice(branchStart, branchStart + 1400)
    expect(branch).toContain('q.is_active = true')
    expect(branch).toContain("qa.moderation_status = 'visible'")
    expect(branch).toContain('is_blocked_pair')
  })

  it('the frozen evidence for a question_answer report includes prompt, body, and author_pseudonym', () => {
    const body = extractFunctionBody('report_content')
    const branchStart = body.indexOf("p_target_type = 'question_answer'")
    const branch = body.slice(branchStart, branchStart + 1400)
    expect(branch).toContain("'prompt', q.prompt")
    expect(branch).toContain("'body', qa.body")
    expect(branch).toContain("'author_pseudonym', p.pseudonym")
  })

  it('self-report prevention and duplicate protection remain shared, unmodified checks applying to every target_type including the new one', () => {
    const body = extractFunctionBody('report_content')
    expect(body).toContain('if v_reported_user_id = auth.uid() then')
    expect(body).toContain('You cannot report your own content.')
    expect(body).toContain('You have already reported this.')
    // These checks appear AFTER the if/elsif chain (once), applying
    // uniformly — never duplicated per-branch.
    expect((body.match(/You cannot report your own content\./g) ?? []).length).toBe(1)
    expect((body.match(/You have already reported this\./g) ?? []).length).toBe(1)
  })
})

describe('report_content — dispatch/photo_moment visibility corrections (independent review item 3)', () => {
  it('the plain dispatch branch requires status=published, moderation_status=visible, and not a blocked pair', () => {
    const body = extractFunctionBody('report_content')
    const branchStart = body.indexOf("elsif p_target_type = 'dispatch' then")
    const branchEnd = body.indexOf("elsif p_target_type = 'photo_moment'", branchStart)
    const branch = body.slice(branchStart, branchEnd)
    expect(branch).toContain("d.status = 'published'")
    expect(branch).toContain("d.moderation_status = 'visible'")
    expect(branch).toContain('is_blocked_pair(auth.uid(), d.author_id)')
  })

  it('the dispatch-sourced half of the photo_moment branch requires the same predicate — never reportable by a stale/guessed id on a hidden Dispatch', () => {
    const body = extractFunctionBody('report_content')
    const branchStart = body.indexOf("elsif p_target_type = 'photo_moment'")
    const dispatchSourcedStart = body.indexOf('from public.dispatch_moments dm', branchStart)
    expect(dispatchSourcedStart).toBeGreaterThan(branchStart)
    const subBranch = body.slice(dispatchSourcedStart, dispatchSourcedStart + 400)
    expect(subBranch).toContain("d.status = 'published'")
    expect(subBranch).toContain("d.moderation_status = 'visible'")
    expect(subBranch).toContain('is_blocked_pair(auth.uid(), d.author_id)')
  })

  it('the private-letter half of the photo_moment branch is unchanged — participant-gated, no Dispatch predicate involved', () => {
    const body = extractFunctionBody('report_content')
    const branchStart = body.indexOf("elsif p_target_type = 'photo_moment'")
    const dispatchSourcedStart = body.indexOf('from public.dispatch_moments dm', branchStart)
    const letterSubBranch = body.slice(branchStart, dispatchSourcedStart)
    expect(letterSubBranch).toContain('from public.moments m')
    expect(letterSubBranch).toContain('c.participant_low = auth.uid() or c.participant_high = auth.uid()')
    expect(letterSubBranch).not.toContain('moderation_status')
  })
})

describe('delete_dispatch enforcement gap fix (§16), plus independent review item 4', () => {
  it('gains the same account-status gate update_dispatch already has, same message, no new vocabulary', () => {
    const body = extractFunctionBody('delete_dispatch')
    expect(body).toContain("current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(body).toContain("raise exception 'This action is not available right now.';")
  })

  it('independent review item 4: a hidden Dispatch is not author-deletable — folded into the existing existence check', () => {
    const body = extractFunctionBody('delete_dispatch')
    const existsStart = body.indexOf('if not exists (')
    const existsEnd = body.indexOf('raise exception', existsStart)
    const existenceCheck = body.slice(existsStart, existsEnd)
    expect(existenceCheck).toContain('d.author_id = auth.uid()')
    expect(existenceCheck).toContain("d.moderation_status = 'visible'")
    // Reuses the EXISTING message — no new vocabulary.
    expect(body).toContain("raise exception 'Only the author of a Dispatch may delete it.';")
  })
})

describe('update_dispatch — independent review item 4 (hidden content not author-editable)', () => {
  it('exists in this migration, reproduced with the same account-status gate as delete_dispatch', () => {
    const body = extractFunctionBody('update_dispatch')
    expect(body).toContain("current_account_status() in ('restricted', 'suspended', 'banned')")
  })

  it('the existence check now also requires moderation_status = visible, reusing the existing message', () => {
    const body = extractFunctionBody('update_dispatch')
    const existsStart = body.indexOf('if not exists (')
    const existsEnd = body.indexOf('raise exception', existsStart)
    const existenceCheck = body.slice(existsStart, existsEnd)
    expect(existenceCheck).toContain('d.author_id = auth.uid()')
    expect(existenceCheck).toContain("d.status = 'published'")
    expect(existenceCheck).toContain("d.moderation_status = 'visible'")
    expect(body).toContain("raise exception 'Only the author of a published Dispatch may edit it.';")
  })

  it('is SECURITY DEFINER with a fixed search_path, matching every other content-mutating RPC', () => {
    const start = sql.indexOf('create or replace function public.update_dispatch(')
    const nextFunctionStart = sql.indexOf('create or replace function public.share_dispatch', start)
    const header = sql.slice(start, nextFunctionStart === -1 ? start + 500 : start + 500)
    expect(header).toContain('security definer')
    expect(header).toContain("set search_path to 'pg_catalog'")
  })
})

describe('publish_question_answer / set_current_answer — independent review items 5 and 8', () => {
  it('both functions are now SECURITY DEFINER — required for the section 1 revoke on question_answers to be safe at all', () => {
    const publishBody = extractFunctionBody('publish_question_answer')
    const setCurrentBody = extractFunctionBody('set_current_answer')
    const publishStart = sql.indexOf('create or replace function public.publish_question_answer(')
    const publishHeader = sql.slice(publishStart, publishStart + 300)
    const setCurrentStart = sql.indexOf('create or replace function public.set_current_answer(')
    const setCurrentHeader = sql.slice(setCurrentStart, setCurrentStart + 300)
    expect(publishHeader).toContain('security definer')
    expect(setCurrentHeader).toContain('security definer')
    // Sanity: both still have their own real bodies (extractFunctionBody
    // resolved successfully above).
    expect(publishBody.length).toBeGreaterThan(0)
    expect(setCurrentBody.length).toBeGreaterThan(0)
  })

  it('publish_question_answer rejects any write against an inactive Question', () => {
    const body = extractFunctionBody('publish_question_answer')
    expect(body).toContain('question_is_active is not null and not question_is_active')
    expect(body).toContain("raise exception 'This Question is no longer accepting answers.';")
  })

  it('publish_question_answer rejects editing an existing answer that is currently hidden', () => {
    const body = extractFunctionBody('publish_question_answer')
    expect(body).toContain("existing_moderation_status = 'hidden'")
    expect(body).toContain("raise exception 'This answer has been hidden and cannot be edited.';")
  })

  it('set_current_answer requires moderation_status = visible, reusing the existing error message', () => {
    const body = extractFunctionBody('set_current_answer')
    expect(body).toContain("qa.moderation_status = 'visible'")
    expect(body).toContain(
      "raise exception 'Only a completed answer to one of the three canonical Questions can be shown in Minds.';"
    )
  })

  it('both are granted execute to authenticated (persists/re-affirmed even after the security-definer conversion)', () => {
    expect(sql).toContain('grant execute on function public.publish_question_answer(uuid, text) to authenticated;')
    expect(sql).toContain('grant execute on function public.set_current_answer(uuid) to authenticated;')
  })
})

describe('admin hide/restore RPCs (§10) — moderator floor, reason required, never touch title/body/prompt', () => {
  const functionNames = [
    'admin_hide_dispatch',
    'admin_restore_dispatch',
    'admin_hide_question_answer',
    'admin_restore_question_answer',
  ]

  it.each(functionNames)('%s requires is_staff(\'moderator\') and a non-empty reason, server-side', (fn) => {
    const body = extractFunctionBody(fn)
    expect(body).toContain("if not public.is_staff('moderator') then")
    expect(body).toContain('raise exception \'Not authorized.\';')
    expect(body).toContain('char_length(v_reason) = 0')
    expect(body).toContain('A reason is required.')
  })

  it.each(functionNames)('%s never references title, body, or prompt columns — structurally cannot rewrite member content', (fn) => {
    const body = extractFunctionBody(fn)
    expect(body).not.toMatch(/\bset\s+title\s*=/)
    expect(body).not.toMatch(/\bset\s+body\s*=/)
    expect(body).not.toMatch(/\bset\s+prompt\s*=/)
  })

  it('hide sets moderation_status to hidden; restore sets it to visible', () => {
    expect(extractFunctionBody('admin_hide_dispatch')).toContain("moderation_status = 'hidden'")
    expect(extractFunctionBody('admin_restore_dispatch')).toContain("moderation_status = 'visible'")
    expect(extractFunctionBody('admin_hide_question_answer')).toContain("moderation_status = 'hidden'")
    expect(extractFunctionBody('admin_restore_question_answer')).toContain("moderation_status = 'visible'")
  })

  it.each(functionNames)('%s writes an admin_audit_log row with the actor, target, and reason', (fn) => {
    const body = extractFunctionBody(fn)
    expect(body).toContain('insert into public.admin_audit_log')
    expect(body).toContain('v_reason')
  })

  it.each(functionNames)(
    'independent review item 1: %s requires a qualifying report for a moderator-only caller, but never for an admin',
    (fn) => {
      const body = extractFunctionBody(fn)
      expect(body).toContain("if not public.is_staff('admin') then")
      expect(body).toContain('select 1 from public.reports')
      // The report-boundary raise uses the SAME generic message as the
      // is_staff('moderator') check above it — never a distinct message
      // that would leak "this exists but isn't reported" to a caller.
      const boundaryStart = body.indexOf("if not public.is_staff('admin') then")
      const boundaryBlock = body.slice(boundaryStart, boundaryStart + 320)
      expect(boundaryBlock).toContain("raise exception 'Not authorized.';")
    }
  )

  it('the dispatch RPCs key the report-boundary check on target_type = \'dispatch\'; the question_answer RPCs key on target_type = \'question_answer\'', () => {
    expect(extractFunctionBody('admin_hide_dispatch')).toContain("target_type = 'dispatch'")
    expect(extractFunctionBody('admin_restore_dispatch')).toContain("target_type = 'dispatch'")
    expect(extractFunctionBody('admin_hide_question_answer')).toContain("target_type = 'question_answer'")
    expect(extractFunctionBody('admin_restore_question_answer')).toContain("target_type = 'question_answer'")
  })

  it.each(['admin_hide_dispatch', 'admin_hide_question_answer'])(
    'independent review item 9: %s refuses to hide something already hidden, without writing a fabricated audit transition',
    (fn) => {
      const body = extractFunctionBody(fn)
      expect(body).toContain("v_old_status = 'hidden'")
      expect(body).toContain("raise exception 'This content is already hidden.';")
    }
  )

  it.each(['admin_restore_dispatch', 'admin_restore_question_answer'])(
    'independent review item 9: %s refuses to restore something already visible, without writing a fabricated audit transition',
    (fn) => {
      const body = extractFunctionBody(fn)
      expect(body).toContain("v_old_status = 'visible'")
      expect(body).toContain("raise exception 'This content is already visible.';")
    }
  )

  it.each(functionNames)('%s places its idempotency guard AFTER the not-found check, so a nonexistent target still gets "not found"', (fn) => {
    const body = extractFunctionBody(fn)
    const notFoundIndex = body.indexOf('v_old_status is null')
    const idempotencyIndex = body.search(/v_old_status = '(hidden|visible)'/)
    expect(notFoundIndex).toBeGreaterThan(-1)
    expect(idempotencyIndex).toBeGreaterThan(notFoundIndex)
  })
})

describe('proactive Public Content Review (§12) — admin floor only, bounded, public content only', () => {
  it('requires is_staff(\'admin\'), never the moderator floor', () => {
    const body = extractFunctionBody('admin_list_public_content')
    expect(body).toContain("if not public.is_staff('admin') then")
  })

  it('clamps limit and offset — never an unbounded query', () => {
    const body = extractFunctionBody('admin_list_public_content')
    expect(body).toMatch(/least\(greatest\(coalesce\(p_limit, 30\), 1\), 100\)/)
    expect(body).toContain('greatest(coalesce(p_offset, 0), 0)')
  })

  it('only ever reads dispatches and question_answers — never letters, moments, or letter_postcards', () => {
    const body = extractFunctionBody('admin_list_public_content')
    expect(body).toContain('from public.dispatches')
    expect(body).toContain('from public.question_answers')
    expect(body).not.toContain('from public.letters')
    expect(body).not.toContain('from public.moments')
    expect(body).not.toContain('from public.letter_postcards')
    expect(body).not.toContain('from public.correspondences')
  })

  it('independent review item 7 (revised, final audit round): a VISIBLE answer requires q.is_active = true; a HIDDEN answer is included regardless', () => {
    const body = extractFunctionBody('admin_list_public_content')
    const unionIndex = body.indexOf('union all')
    const answerBranch = body.slice(unionIndex)
    expect(answerBranch).toContain("qa.moderation_status = 'visible' and q.is_active = true")
    expect(answerBranch).toContain("or qa.moderation_status = 'hidden'")
  })

})

describe('Questions admin (§17) — admin floor, canonical-only, no Create', () => {
  const functionNames = ['admin_list_questions', 'admin_set_question_active', 'admin_update_question_prompt']

  it.each(functionNames)('%s requires is_staff(\'admin\')', (fn) => {
    const body = extractFunctionBody(fn)
    expect(body).toContain("if not public.is_staff('admin') then")
  })

  it('every Questions RPC is scoped to canonical rows only (slug is not null)', () => {
    expect(extractFunctionBody('admin_list_questions')).toContain('where q.slug is not null')
    expect(extractFunctionBody('admin_set_question_active')).toContain('and slug is not null')
    expect(extractFunctionBody('admin_update_question_prompt')).toContain('and slug is not null')
  })

  it('no admin_create_question function exists anywhere in this migration', () => {
    expect(sql).not.toContain('admin_create_question')
  })

  it('LOCKED immutability: admin_update_question_prompt rejects any edit once >= 1 answer exists, server-side', () => {
    const body = extractFunctionBody('admin_update_question_prompt')
    expect(body).toContain('exists (select 1 from public.question_answers where question_id = p_question_id)')
    expect(body).toContain('cannot be changed')
  })

  it('independent review item 8: admin_update_question_prompt ALSO requires the Question to be currently inactive', () => {
    const body = extractFunctionBody('admin_update_question_prompt')
    expect(body).toContain('v_is_active')
    const guardIndex = body.indexOf('if v_is_active then')
    expect(guardIndex).toBeGreaterThan(-1)
    const guardBlock = body.slice(guardIndex, guardIndex + 200)
    expect(guardBlock).toContain('Deactivate it before editing the prompt')
  })

  it('the is_active guard runs BEFORE the answer-count guard, so an active zero-answer Question is still rejected', () => {
    const body = extractFunctionBody('admin_update_question_prompt')
    const activeGuardIndex = body.indexOf('if v_is_active then')
    const answerCountGuardIndex = body.indexOf(
      'exists (select 1 from public.question_answers where question_id = p_question_id)'
    )
    expect(activeGuardIndex).toBeGreaterThan(-1)
    expect(answerCountGuardIndex).toBeGreaterThan(activeGuardIndex)
  })

  it('activate/deactivate writes distinct audit actions for each direction', () => {
    const body = extractFunctionBody('admin_set_question_active')
    expect(body).toContain("'question_activated'")
    expect(body).toContain("'question_deactivated'")
  })

  it('final mutation-boundary audit item 6: admin_set_question_active refuses a no-op transition rather than fabricating an audit row', () => {
    const body = extractFunctionBody('admin_set_question_active')
    expect(body).toContain('v_was_active')
    expect(body).toContain("raise exception 'This Question is already active.';")
    expect(body).toContain("raise exception 'This Question is already inactive.';")
    // The idempotency guard runs BEFORE the update/insert-audit-log
    // statements, so a no-op call never reaches them.
    const guardIndex = body.indexOf('v_was_active = p_active')
    const updateIndex = body.indexOf('update public.questions set is_active')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(guardIndex)
  })
})

describe('content audit read (§18), corrected per independent review item 2', () => {
  it('admin_list_content_audit still uses the plain moderator-floor is_staff() check as its OUTER gate', () => {
    const body = extractFunctionBody('admin_list_content_audit')
    expect(body).toContain('if not public.is_staff() then')
  })

  it('a moderator-only caller (not admin) must supply both p_target_type and p_target_id', () => {
    const body = extractFunctionBody('admin_list_content_audit')
    const boundaryStart = body.indexOf("if not public.is_staff('admin') then")
    expect(boundaryStart).toBeGreaterThan(-1)
    const boundaryBlock = body.slice(boundaryStart, boundaryStart + 500)
    expect(boundaryBlock).toContain('p_target_type is null or p_target_id is null')
  })

  it('a moderator-only caller must also have a qualifying report for that exact target', () => {
    const body = extractFunctionBody('admin_list_content_audit')
    const boundaryStart = body.indexOf("if not public.is_staff('admin') then")
    const boundaryBlock = body.slice(boundaryStart, boundaryStart + 500)
    expect(boundaryBlock).toContain('select 1 from public.reports')
    expect(boundaryBlock).toContain('target_type = p_target_type and target_id = p_target_id')
  })

  it('an admin caller is never subject to the target-type/target-id/report requirement — global queries remain possible', () => {
    const body = extractFunctionBody('admin_list_content_audit')
    // The entire moderator-only boundary block is gated behind `if not
    // public.is_staff('admin')` — nothing inside it can run for an
    // admin caller.
    expect(body).toMatch(/if not public\.is_staff\('admin'\) then[\s\S]*?end if;/)
  })

  it('independent review item 2: p_limit is clamped with a POSITIVE floor, not just a ceiling', () => {
    const body = extractFunctionBody('admin_list_content_audit')
    expect(body).toMatch(/least\(greatest\(coalesce\(p_limit, 100\), 1\), 200\)/)
  })
})

describe('admin_get_report extension — exposes target moderation status without widening private access', () => {
  it('adds target_moderation_status, null for every target_type except dispatch/question_answer', () => {
    const body = extractFunctionBody('admin_get_report')
    expect(body).toContain('target_moderation_status text')
    expect(body).toContain("when 'dispatch' then")
    expect(body).toContain("when 'question_answer' then")
    expect(body).toContain('else null')
  })

  it('is preceded by an explicit DROP FUNCTION — CREATE OR REPLACE cannot change a RETURNS TABLE column list', () => {
    // Caught on a post-delivery re-check: admin_get_report is the only
    // function in this migration that both already exists live AND
    // gains a new RETURNS TABLE column (target_moderation_status) —
    // every other replaced function keeps its existing column list (or
    // returns a whole-row composite type, unaffected by this
    // restriction), and every other new function has nothing live to
    // conflict with. Without the drop, applying this migration would
    // fail here with "cannot change return type of existing function."
    const dropIndex = sql.indexOf('drop function if exists public.admin_get_report(uuid);')
    const createIndex = sql.indexOf('create or replace function public.admin_get_report(')
    expect(dropIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(dropIndex)
    // Nothing but comments/whitespace between the drop and the create.
    const between = sql.slice(dropIndex + 'drop function if exists public.admin_get_report(uuid);'.length, createIndex)
    const nonCommentLines = between
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('--'))
    expect(nonCommentLines).toEqual([])
  })

  it('no OTHER already-existing function in this migration changes its RETURNS TABLE column list without a matching drop', () => {
    // get_shared_dispatch and get_post_closure_recommendations are both
    // reproduced from their live definitions with their column lists
    // UNCHANGED (only WHERE-clause predicates added), so they need no
    // drop. publish_question_answer/set_current_answer/update_dispatch
    // return `public.<table>` (the whole-row composite type), which
    // absorbs section 1's new columns automatically rather than
    // declaring its own list. admin_hide/restore_dispatch,
    // admin_hide/restore_question_answer, admin_list_public_content,
    // admin_list_questions, admin_set_question_active,
    // admin_update_question_prompt, and admin_list_content_audit are
    // all brand new — nothing live to conflict with.
    const dropCount = (sql.match(/^drop function if exists/gm) ?? []).length
    expect(dropCount).toBe(1)
  })
})

describe('unchanged invariants — no letters/correspondences RLS, no Postcards, no Storage, no Realtime, no feature flags', () => {
  it('never touches public.letters or public.correspondences RLS', () => {
    expect(sql).not.toMatch(/alter\s+table\s+public\.letters/i)
    expect(sql).not.toMatch(/alter\s+table\s+public\.correspondences/i)
    expect(sql).not.toMatch(/create\s+policy[^;]*on\s+public\.letters/i)
    expect(sql).not.toMatch(/create\s+policy[^;]*on\s+public\.correspondences/i)
  })

  it('never touches postcard_catalog, postcard_versions, or letter_postcards as real tables — the admin_list_public_content header comment names them only to explain they are deliberately NOT read', () => {
    expect(sql).not.toMatch(/\b(from|join|into|table)\s+public\.postcard_catalog\b/)
    expect(sql).not.toMatch(/\b(from|join|into|table)\s+public\.postcard_versions\b/)
    expect(sql).not.toMatch(/\b(from|join|into|table)\s+public\.letter_postcards\b/)
  })

  it('never touches Storage, Realtime, or feature flags', () => {
    expect(sql).not.toContain('storage.objects')
    expect(sql).not.toContain('supabase_realtime')
    expect(sql).not.toContain('feature_flag')
  })

  it('every SECURITY DEFINER function in this migration sets a fixed, non-empty search_path', () => {
    // Most functions here follow the 'pg_catalog' convention;
    // get_post_closure_recommendations is reproduced verbatim from its
    // existing live definition, which already used 'public' — a fixed
    // literal search_path either way, never left empty/mutable.
    const definerCount = (sql.match(/security definer/g) ?? []).length
    const fixedPathCount = (sql.match(/set search_path to '(pg_catalog|public)'/g) ?? []).length
    expect(definerCount).toBeGreaterThan(0)
    // >= rather than ===: search_dispatches (SECURITY INVOKER) also
    // sets a fixed search_path, which is fine but not itself a DEFINER
    // function this assertion is checking.
    expect(fixedPathCount).toBeGreaterThanOrEqual(definerCount)
  })

  it('remains one BEGIN/COMMIT, now marked as applied live (Phase 2A-1 checkpoint)', () => {
    expect(sql).toContain('APPLIED LIVE 2026-09-10')
    expect(sql).not.toContain('NOT EXECUTED')
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
  })
})

describe('moderation field DB-level security — no application code path could set moderation_status directly even if it wanted to', () => {
  // The migration revokes UPDATE on both tables outright (section 1
  // above) — this is the actual enforcement mechanism. This test proves
  // the other half: the codebase never even attempts a direct
  // `.from('dispatches'|'question_answers').update(...)`/`.upsert(...)`
  // that a revoked grant would need to block — every real write already
  // goes through a SECURITY DEFINER RPC (publish_dispatch,
  // update_dispatch, admin_hide_dispatch, publish_question_answer,
  // set_current_answer, admin_hide_question_answer, etc.). A future
  // regression that adds a direct update call would fail this test
  // immediately, independent of whether the SQL grant is ever applied.
  const files = listSourceFiles(path.join(REPO_ROOT, 'app')).concat(listSourceFiles(path.join(REPO_ROOT, 'lib')))

  it('scans every non-test .ts/.tsx source file for a direct update/upsert against dispatches or question_answers', () => {
    const offenders: string[] = []
    const forbidden = [
      /from\(\s*['"]dispatches['"]\s*\)\s*\.\s*update\s*\(/,
      /from\(\s*['"]dispatches['"]\s*\)\s*\.\s*upsert\s*\(/,
      /from\(\s*['"]question_answers['"]\s*\)\s*\.\s*update\s*\(/,
      /from\(\s*['"]question_answers['"]\s*\)\s*\.\s*upsert\s*\(/,
    ]
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      if (forbidden.some((re) => re.test(content))) {
        offenders.push(path.relative(REPO_ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('sanity check: the scan actually inspected a non-trivial number of files (not silently scanning nothing)', () => {
    expect(files.length).toBeGreaterThan(50)
  })
})

describe('final mutation-boundary audit item 4 — raw table-mutation bypass, mapped explicitly to each checklist item', () => {
  // This repository cannot execute Postgres, so "a raw PostgREST INSERT/
  // UPDATE/DELETE is rejected" cannot be exercised as a live HTTP call —
  // the REVOKE statements below are themselves the actual enforcement
  // mechanism (PostgREST checks the table grant before RLS is ever
  // evaluated), so pinning their exact presence IS the correct test for
  // this repo's constraints, same convention as every other DB-only
  // guarantee in this file. Each `it` below names the exact checklist
  // item it proves.

  it('raw INSERT of an answer to an inactive Question is denied — INSERT is revoked outright, so this never reaches the is_active check at all', () => {
    expect(sql).toContain('revoke insert, update, delete on public.question_answers from authenticated;')
  })

  it('raw INSERT cannot fabricate moderation_status on question_answers — same revoke; no INSERT policy exists to fall back on either (only two SELECT policies are defined for this table across all tracked migrations)', () => {
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.question_answers[\s\S]*?for insert/i)
  })

  it('raw UPDATE cannot clear a hidden moderation_status — UPDATE is revoked, and publish_question_answer/set_current_answer (the only legitimate writers) are now SECURITY DEFINER, independent of that grant', () => {
    expect(sql).toContain('revoke insert, update, delete on public.question_answers from authenticated;')
    const publishHeader = sql.slice(
      sql.indexOf('create or replace function public.publish_question_answer('),
      sql.indexOf('create or replace function public.publish_question_answer(') + 300
    )
    expect(publishHeader).toContain('security definer')
  })

  it('raw DELETE cannot destroy a hidden answer — DELETE is revoked, and no function anywhere in this migration issues delete from public.question_answers', () => {
    expect(sql).toContain('revoke insert, update, delete on public.question_answers from authenticated;')
    expect(sql).not.toContain('delete from public.question_answers')
  })

  it('publish_question_answer still works for an active Question — SECURITY DEFINER means it no longer depends on the revoked grant at all', () => {
    const body = extractFunctionBody('publish_question_answer')
    expect(body).toContain('insert into public.question_answers')
    expect(body).toContain('question_is_active is not null and not question_is_active')
  })

  it('set_current_answer still works for an eligible (visible, canonical, own) answer — SECURITY DEFINER, same reasoning', () => {
    const body = extractFunctionBody('set_current_answer')
    expect(body).toContain('update public.question_answers')
    expect(body).toContain("qa.moderation_status = 'visible'")
  })
})

describe('final mutation-boundary audit item 5 — Dispatch INSERT moderation-state integrity', () => {
  it('dispatches keeps its INSERT grant (publish_dispatch is a legitimate SECURITY INVOKER direct path) — only UPDATE/DELETE are revoked', () => {
    expect(sql).toContain('revoke update, delete on public.dispatches from authenticated;')
    // Anchored to an actual statement (line-start "revoke", single line,
    // no comment-prose false positives) — a bare [^;]* scan without
    // these anchors can span across unrelated header-comment prose that
    // happens to mention "insert" and "on public.dispatches" nowhere
    // near each other in the real SQL.
    expect(sql).not.toMatch(/^revoke[^;\n]*\binsert\b[^;\n]*on public\.dispatches/im)
  })

  it('the smallest correct fix: tightening the existing WITH CHECK, not migrating Dispatch creation to a new architecture', () => {
    // No new dispatch-creation RPC, no SECURITY DEFINER conversion of
    // publish_dispatch — this migration touches only the RLS policy.
    expect(sql).not.toContain('create or replace function public.publish_dispatch')
  })
})

describe('final pre-apply correction — hidden question answer currentness (items 1-3, 5, 7)', () => {
  it('item 1/4: set_current_answer\'s demotion UPDATE never touches a hidden row', () => {
    const body = extractFunctionBody('set_current_answer')
    const demoteStart = body.indexOf('set is_current = false')
    expect(demoteStart).toBeGreaterThan(-1)
    const demoteBlock = body.slice(demoteStart, demoteStart + 150)
    expect(demoteBlock).toContain('id <> p_answer_id')
    expect(demoteBlock).toContain("moderation_status = 'visible'")
  })

  it('item 2: admin_hide_question_answer clears is_current in the SAME UPDATE as the moderation transition', () => {
    const body = extractFunctionBody('admin_hide_question_answer')
    const updateStart = body.indexOf("set moderation_status = 'hidden'")
    expect(updateStart).toBeGreaterThan(-1)
    const updateBlock = body.slice(updateStart, body.indexOf(';', updateStart))
    expect(updateBlock).toContain('is_current = false')
  })

  it('item 2: admin_hide_question_answer captures was_current in audit metadata', () => {
    const body = extractFunctionBody('admin_hide_question_answer')
    expect(body).toContain('v_old_is_current')
    expect(body).toContain("'was_current', v_old_is_current")
  })

  it('item 2: admin_hide_question_answer never auto-promotes a different answer — no other row\'s is_current is ever set true', () => {
    const body = extractFunctionBody('admin_hide_question_answer')
    expect(body).not.toMatch(/is_current\s*=\s*true/)
  })

  it('item 3: admin_restore_question_answer never references is_current at all', () => {
    const body = extractFunctionBody('admin_restore_question_answer')
    expect(body).not.toContain('is_current')
  })

  it('item 5: publish_question_answer\'s demotion UPDATE only ever writes is_current = false, never true, to the rows it touches — proven safe without a moderation_status filter', () => {
    const body = extractFunctionBody('publish_question_answer')
    const demoteIndex = body.indexOf('if should_promote then')
    const demoteBlock = body.slice(demoteIndex, body.indexOf('end if;', demoteIndex))
    expect(demoteBlock).toContain('set is_current = false')
    expect(demoteBlock).not.toMatch(/is_current\s*=\s*true/)
  })

  it('item 5: publish_question_answer still rejects any write to a hidden row\'s own identity before reaching the demotion logic', () => {
    const body = extractFunctionBody('publish_question_answer')
    const hiddenGuardIndex = body.indexOf("existing_moderation_status = 'hidden'")
    const demoteIndex = body.indexOf('if should_promote then')
    expect(hiddenGuardIndex).toBeGreaterThan(-1)
    expect(demoteIndex).toBeGreaterThan(hiddenGuardIndex)
  })

  it('item 7: admin_set_question_active rejects p_active is null, before any lookup or audit write', () => {
    const body = extractFunctionBody('admin_set_question_active')
    const guardIndex = body.indexOf('if p_active is null then')
    const lookupIndex = body.indexOf('select prompt, is_active into')
    const auditIndex = body.indexOf('insert into public.admin_audit_log')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(lookupIndex)
    expect(guardIndex).toBeLessThan(auditIndex)
    expect(body).toContain("raise exception 'An active state is required.';")
  })

  it('the question_answers_one_current_per_user partial unique index is compatible — the fix only narrows an UPDATE\'s WHERE clause, never widens which rows can be is_current = true', () => {
    // Documented directly in the migration's own comment rather than
    // re-derived here — this test pins that the reasoning is written
    // down, since the index itself lives in an already-applied
    // migration this file doesn't reproduce.
    expect(sql).toContain('question_answers_one_current_per_user')
  })
})
