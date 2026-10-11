import AuthorDispatchesPage from '@/app/minds/[userId]/dispatches/page'

export default function BoardPersonLettersPage({
  params, searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<{ returnTo?: string }>
}) {
  return AuthorDispatchesPage({ params, searchParams })
}
