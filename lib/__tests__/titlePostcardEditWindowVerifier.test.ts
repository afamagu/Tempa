// Smoke-test contract completion checkpoint — VERIFIER CORRECTION pass.
// The migration (docs/sql/2026-09-28-title-postcard-and-edit-window.sql)
// was applied to Supabase; the first verifier run then read
// overall_pass = false on exactly five predicates, all of them the
// Postcard back_message "is 300" checks (two table constraints —
// dispatch_postcards_back_message_length, letter_postcards_back_
// message_length — and three function guards — publish_dispatch,
// write_letter, reply_to_letter). Direct read-only inspection of the
// live database confirmed all five are actually correct at 300: the two
// constraints read `CHECK (((char_length(TRIM(BOTH FROM back_message))
// >= 1) AND (char_length(TRIM(BOTH FROM back_message)) <= 300)))`, and
// reply_to_letter's body reads `if char_length(trim(both from
// v_back_message)) > 300 then` verbatim. A separate diagnostic
// confirmed "300" is genuinely present in all five bodies.
//
// The verifier's OWN patterns were therefore the false negative, same
// shape of bug docs/sql/2026-09-25-dispatch-postcards-verify.sql's own
// header already documents once (a CHECK constraint is stored as a
// parsed expression tree, not raw text, so pg_get_constraintdef's
// reconstruction can introduce different parenthesization/formatting
// than the migration's own source without changing the constraint's
// meaning — and, per that same prior verifier's own precedent, the
// leading hypothesis is exotic non-ASCII whitespace surviving a
// copy/paste into the SQL editor, which a plain `\s` character class
// may not reliably match). Fixed by widening the paren-matching (`\(+`
// instead of an exact `\(`) and replacing the previous exact-whitespace
// gap with a bounded NON-ALPHANUMERIC class ([^0-9A-Za-z]{0,12}) between
// "back_message"/"v_back_message" and the comparison operator — this
// tolerates ANY punctuation/whitespace variant PostgreSQL or a paste
// pipeline might introduce, while remaining anchored specifically to
// the char_length/trim/both/from/back_message relationship, never
// degenerating into a bare "300 appears somewhere" search.
//
// Same "no live Postgres to run the verifier against here" limitation
// as dispatchPostcardsVerifier.test.ts — proven via real regex-behavior
// assertions (constructing a JS RegExp from the SQL's own `~*` pattern
// source and running it against the exact live-confirmed sample text),
// not just source-text `toContain` checks.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const VERIFIER_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'sql',
  '2026-09-28-title-postcard-and-edit-window-verify.sql'
)

const sql = readFileSync(VERIFIER_PATH, 'utf8')

function ctePart(name: string, nextName: string): string {
  const start = sql.indexOf(`${name} as (`)
  expect(start, `expected to find CTE "${name}" in the verifier`).toBeGreaterThan(-1)
  const end = sql.indexOf(`${nextName} as (`, start)
  expect(end, `expected to find the following CTE "${nextName}" after "${name}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

// The exact live-confirmed forms, quoted verbatim from the correction
// request — these are the ground truth this fix must pass against.
const LIVE_DISPATCH_CONSTRAINT =
  'CHECK (((char_length(TRIM(BOTH FROM back_message)) >= 1) AND (char_length(TRIM(BOTH FROM back_message)) <= 300)))'
const LIVE_LETTER_CONSTRAINT =
  'CHECK (((char_length(TRIM(BOTH FROM back_message)) >= 1) AND (char_length(TRIM(BOTH FROM back_message)) <= 300)))'
const LIVE_REPLY_TO_LETTER_GUARD = 'if char_length(trim(both from v_back_message)) > 300 then'

describe('title/postcard/edit-window verifier — no longer requires the migration\'s own exact paren count/whitespace to survive storage verbatim', () => {
  it('the corrected patterns no longer use a bare \\( for parens or a plain \\s* gap next to back_message — they use \\(+ and a bounded non-alphanumeric class', () => {
    const constraintChecks = ctePart('dispatch_postcard_back_check', 'letter_postcard_back_check')
    expect(constraintChecks).toContain('char_length\\s*\\(+\\s*trim\\s*\\(+\\s*both\\s+from\\s+back_message[^0-9A-Za-z]{0,12}')
  })
})

describe('title/postcard/edit-window verifier — dispatch_postcards_back_message_length (constraint)', () => {
  const IS_300_LOWER = String.raw`char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}>=\s*1\y`
  const IS_300_UPPER = String.raw`char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*300\y`
  const OLD_200_GONE = String.raw`char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*200\y`

  // Postgres's \y (word boundary) has no direct JS equivalent — \b is
  // the nearest correct stand-in for this specific pattern shape
  // (alphanumeric-to-non-alphanumeric transitions), used only to
  // exercise the pattern's semantics here in JS, never written back
  // into the SQL itself (which must keep \y, the real Postgres ARE
  // syntax).
  function toJsRegExp(posixPattern: string): RegExp {
    return new RegExp(posixPattern.replace(/\\y/g, '\\b'), 'i')
  }

  it('matches the EXACT live-confirmed constraint definition (both bounds)', () => {
    expect(toJsRegExp(IS_300_LOWER).test(LIVE_DISPATCH_CONSTRAINT)).toBe(true)
    expect(toJsRegExp(IS_300_UPPER).test(LIVE_DISPATCH_CONSTRAINT)).toBe(true)
  })

  it('correctly reports the old 200 upper bound as gone against the live 300 definition', () => {
    expect(toJsRegExp(OLD_200_GONE).test(LIVE_DISPATCH_CONSTRAINT)).toBe(false)
  })

  it('still matches a differently-parenthesized/spaced live form — the exact defensive widening this fix adds', () => {
    // A single extra wrapping paren and a tab instead of a space —
    // neither of which the ORIGINAL exact-\s*/exact-\( pattern could
    // tolerate, both of which this widened pattern must.
    const oddlyFormatted =
      'CHECK ((((char_length(TRIM(BOTH FROM\tback_message)))) >= 1) AND ((char_length(TRIM(BOTH FROM back_message))) <= 300))'
    expect(toJsRegExp(IS_300_LOWER).test(oddlyFormatted)).toBe(true)
    expect(toJsRegExp(IS_300_UPPER).test(oddlyFormatted)).toBe(true)
  })

  it('negative: a genuine 200-ceiling constraint still fails the "is 300" proof — this is not a bare "contains a number" search', () => {
    const stillAt200 =
      'CHECK (((char_length(TRIM(BOTH FROM back_message)) >= 1) AND (char_length(TRIM(BOTH FROM back_message)) <= 200)))'
    expect(toJsRegExp(IS_300_UPPER).test(stillAt200)).toBe(false)
    expect(toJsRegExp(OLD_200_GONE).test(stillAt200)).toBe(true)
  })

  it('negative: never matches merely because "300" appears somewhere unrelated — requires the back_message/char_length/trim proximity', () => {
    const unrelatedThreeHundred = 'CHECK (some_other_column <= 300)'
    expect(toJsRegExp(IS_300_UPPER).test(unrelatedThreeHundred)).toBe(false)
  })

  it('negative: does not bridge across an unrelated identifier to a distant 300 — the gap is bounded and non-alphanumeric only', () => {
    const distantThreeHundred =
      'CHECK (char_length(trim(both from back_message)) >= 1 AND some_unrelated_long_identifier_chain <= 300)'
    expect(toJsRegExp(IS_300_UPPER).test(distantThreeHundred)).toBe(false)
  })
})

describe('title/postcard/edit-window verifier — letter_postcards_back_message_length (constraint)', () => {
  const IS_300_UPPER = String.raw`char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*300\y`

  function toJsRegExp(posixPattern: string): RegExp {
    return new RegExp(posixPattern.replace(/\\y/g, '\\b'), 'i')
  }

  it('matches the EXACT live-confirmed letter_postcards constraint definition', () => {
    expect(toJsRegExp(IS_300_UPPER).test(LIVE_LETTER_CONSTRAINT)).toBe(true)
  })
})

describe('title/postcard/edit-window verifier — publish_dispatch / write_letter / reply_to_letter (function guards)', () => {
  const IS_300 = String.raw`char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*300\y`
  const OLD_200_GONE = String.raw`char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*200\y`

  function toJsRegExp(posixPattern: string): RegExp {
    return new RegExp(posixPattern.replace(/\\y/g, '\\b'), 'i')
  }

  it('matches the EXACT live-confirmed reply_to_letter body line verbatim', () => {
    expect(toJsRegExp(IS_300).test(LIVE_REPLY_TO_LETTER_GUARD)).toBe(true)
  })

  it('the same pattern matches publish_dispatch\'s and write_letter\'s own identically-shaped guard line', () => {
    const publishDispatchLine = '    if char_length(trim(both from v_back_message)) > 300 then'
    const writeLetterLine = '    if char_length(trim(both from v_back_message)) > 300 then'
    expect(toJsRegExp(IS_300).test(publishDispatchLine)).toBe(true)
    expect(toJsRegExp(IS_300).test(writeLetterLine)).toBe(true)
  })

  it('correctly reports the old 200 guard as gone against the live 300 guard', () => {
    expect(toJsRegExp(OLD_200_GONE).test(LIVE_REPLY_TO_LETTER_GUARD)).toBe(false)
  })

  it('negative: a genuine, unmigrated 200 guard still fails the "is 300" proof', () => {
    const stillAt200 = 'if char_length(trim(both from v_back_message)) > 200 then'
    expect(toJsRegExp(IS_300).test(stillAt200)).toBe(false)
    expect(toJsRegExp(OLD_200_GONE).test(stillAt200)).toBe(true)
  })

  it('every function CTE in the verifier file actually uses this widened pattern (source-level, not just this test\'s own copy of it)', () => {
    for (const [cteName, nextCteName] of [
      ['publish_dispatch_check', 'update_dispatch_check'],
      ['write_letter_check', 'reply_to_letter_check'],
      ['reply_to_letter_check', 'grants_check'],
    ] as const) {
      const part = ctePart(cteName, nextCteName)
      expect(part).toContain('char_length\\s*\\(+\\s*trim\\s*\\(+\\s*both\\s+from\\s+v_back_message[^0-9A-Za-z]{0,12}>\\s*300\\y')
    }
  })
})
