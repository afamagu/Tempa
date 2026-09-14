import { createClient } from '@/lib/supabase/server'
import { listPostcards } from '@/lib/admin-postcards'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import PostcardsCatalogue from './postcards-catalogue'
import AddPostcardForm from './add-postcard-form'

/**
 * Admin Phase 2A-2 — Admin → Content → Postcards. Active and inactive
 * Postcards are both shown (deactivated ones stay clearly visible,
 * never hidden), each with exactly the actions this checkpoint asks
 * for: Activate/Deactivate and Edit Postcard (which covers both
 * metadata and artwork — see postcard-row.tsx's own comment). No
 * Delete control anywhere.
 *
 * Release Polish Pass — the Active/Inactive split now lives inside
 * PostcardsCatalogue (client component), ahead of its own restrained
 * search field, so the catalogue can filter without a page reload as
 * it grows toward scores/hundreds of Postcards.
 */
export default async function AdminPostcardsPage() {
  const supabase = await createClient()
  const { data: postcards, error } = await listPostcards(supabase)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className={sectionTitleClass}>Postcards</h1>
          <p className={adminMetadataClass}>
            Editing a Postcard always creates a new version — every Postcard already sent keeps its own frozen
            wording and artwork forever, no matter what changes here later.
          </p>
        </div>
        <AddPostcardForm />
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <PostcardsCatalogue postcards={postcards} />
    </div>
  )
}
