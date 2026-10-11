import PublicProfilePage from '@/app/minds/[userId]/page'

export default function BoardPersonPage({
  params, searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<{ returnTo?: string; answer?: string }>
}) {
  return PublicProfilePage({ params, searchParams })
}
