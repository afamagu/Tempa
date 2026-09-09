// A minimal, stateful stand-in for the one slice of SupabaseClient the
// guide-persistence helpers actually use: `.auth.getUser()`, and
// `.from(table).select().eq().eq().maybeSingle()` /
// `.from(table).insert(payload)`. Backed by an in-memory Map per table
// so insert/maybeSingle round-trip for real (not just "was called with
// the right args") — the same code path
// hasCompletedGuide/markGuideCompleted/acknowledgeCorrespondenceFeature
// run against a live Supabase table, including a real 23505
// (unique_violation) on a duplicate primary key, matching Postgres.
//
// Deliberately not a full SupabaseClient implementation — callers cast
// the result with `as unknown as SupabaseClient`, matching how these
// helpers are actually exercised in tests (only the methods above are
// ever invoked by the code under test).

export type FakeError = { message: string; code?: string }

export type FakeInsertCall = {
  table: string
  payload: Record<string, unknown>
}

// Both tables the guide-persistence helpers write to are keyed by every
// column their payload provides — guide_completions'
// (user_id, guide_key) and correspondence_feature_acknowledgements'
// (user_id, correspondence_id, feature_key) primary keys are exactly
// the columns markGuideCompleted/acknowledgeCorrespondenceFeature ever
// insert, so "all payload columns" is a correct stand-in without having
// to hardcode each table's real PK here too.
function keyFor(row: Record<string, unknown>) {
  return Object.keys(row)
    .sort()
    .map((k) => `${k}=${String(row[k])}`)
    .join('::')
}

export function createFakeSupabase(options: {
  user?: { id: string } | null
  /** Optional handler for `.rpc(fn, params)` calls — omit for tests
   * that never call an RPC. Return `{ data, error }` exactly like a
   * real PostgrestBuilder resolves. */
  rpc?: (fn: string, params: Record<string, unknown> | undefined) => { data: unknown; error: FakeError | null }
} = {}) {
  const store: Record<string, Map<string, Record<string, unknown>>> = {}
  const insertCalls: FakeInsertCall[] = []
  let forcedError: { table: string; error: FakeError } | null = null

  function tableStore(table: string) {
    if (!store[table]) store[table] = new Map()
    return store[table]
  }

  function from(table: string) {
    const filters: Record<string, unknown> = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        filters[column] = value
        return builder
      },
      async maybeSingle() {
        const rows = [...tableStore(table).values()]
        const match = rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
        return { data: match ?? null, error: null }
      },
      async insert(payload: Record<string, unknown>) {
        insertCalls.push({ table, payload })

        if (forcedError && forcedError.table === table) {
          return { data: null, error: forcedError.error }
        }

        const key = keyFor(payload)
        if (tableStore(table).has(key)) {
          return {
            data: null,
            error: {
              message: `duplicate key value violates unique constraint "${table}_pkey"`,
              code: '23505',
            },
          }
        }

        tableStore(table).set(key, { ...payload })
        return { data: null, error: null }
      },
    }
    return builder
  }

  return {
    auth: {
      async getUser() {
        return { data: { user: options.user ?? null } }
      },
    },
    from,
    async rpc(fn: string, params?: Record<string, unknown>) {
      if (!options.rpc) {
        throw new Error(`fakeSupabase: no rpc handler configured, but "${fn}" was called`)
      }
      return options.rpc(fn, params)
    },
    /** Test-only escape hatches — not part of the SupabaseClient surface. */
    _insertCalls: insertCalls,
    _rowCount(table: string) {
      return tableStore(table).size
    },
    /** Simulate a permission error (or any other write failure) for
     * every subsequent insert against `table`, until called again with
     * `null`. Distinct from the built-in 23505-on-duplicate behavior,
     * which fires automatically and needs no setup. */
    _forceInsertError(table: string, error: FakeError | null) {
      forcedError = error ? { table, error } : null
    },
  }
}
