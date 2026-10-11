import { redirect } from 'next/navigation'

/** The Board now owns people discovery. Keep prior bookmarks and filter choices. */
export default async function LegacyDiscovery({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value)) value.forEach(item => query.append(key, item))
  }
  redirect(`/board/people${query.size ? `?${query}` : ''}`)
}
