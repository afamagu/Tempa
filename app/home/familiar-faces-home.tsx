import { createClient } from '@/lib/supabase/server'
import { getFamiliarFaces } from '@/lib/familiar-faces'
import FamiliarFaces from '@/app/familiar-faces'

export default async function HomeFamiliarFaces() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const entries = await getFamiliarFaces(supabase, 3)
  if (!entries.length) return null

  return <FamiliarFaces entries={entries} returnTo="/home" />
}
