import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { searchMembers } from '@/lib/admin'
import { sectionTitleClass, helperTextClass, inputClass, secondaryButtonClass, metadataTextClass } from '@/app/profile/ui'

/**
 * Member search — pseudonym only, per the checkpoint's own "Minimum
 * admin-side build." A plain GET form (?q=) so it works without any
 * client-side state; results link straight to the member detail screen.
 */
export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createClient()
  const results = q && q.trim().length > 0 ? (await searchMembers(supabase, q)).data : []

  return (
    <div className="space-y-6">
      <h1 className={sectionTitleClass}>Member search</h1>

      <form className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by pseudonym"
          className={inputClass}
        />
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      {q && results.length === 0 && <p className={helperTextClass}>No members found.</p>}

      {results.length > 0 && (
        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {results.map((m) => (
            <Link
              key={m.id}
              href={`/admin/members/${m.id}`}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-foreground/[.03]"
            >
              <p className="text-[15px] text-foreground">{m.pseudonym}</p>
              {m.country && <p className={metadataTextClass}>{m.country}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
