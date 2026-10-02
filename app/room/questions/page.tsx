import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { readRoomLibrary } from '@/lib/room-reading'
import { getWaitingLetterCount } from '@/lib/letters'
import AppShell from '@/app/app-shell'
import QuestionLibraryCards from '../question-library-cards'
import { inputClass, pageTitleClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'

export default async function QuestionLibrary({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const page = Math.min(Math.max(Number.parseInt(typeof params.page === 'string' ? params.page : '0', 10) || 0, 0), 10000)
  const dateParam = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value ? value : undefined
  const from=dateParam(params.from), to=dateParam(params.to)
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/sign-in')
  const [library, waiting] = await Promise.all([readRoomLibrary(client, search, page * 6,6,{from,to}), getWaitingLetterCount(client, user.id)])
  const pageHref = (n: number) => `/room/questions?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(from ? {from} : {}), ...(to ? {to} : {}), page: String(n) })}`
  return <AppShell active="room" waitingLetterCount={waiting}><main className="mx-auto max-w-3xl space-y-7 px-6 py-10">
    <Link href="/room" className="text-sm underline underline-offset-4">Back to the Room</Link>
    <h1 className={pageTitleClass}>The question library</h1>
    <p className="text-foreground/65">Questions we have lived with, and the ways people answered.</p>
    <form action="/room/questions" className="space-y-3"><input aria-label="Search questions" name="q" defaultValue={search} placeholder="Search questions" maxLength={100} className={inputClass} /><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">First asked from<input type="date" name="from" defaultValue={from} className={inputClass} /></label><label className="space-y-1 text-sm">Through<input type="date" name="to" defaultValue={to} className={inputClass} /></label></div><div className="flex gap-3"><button className={primaryButtonClass}>Search</button><Link href="/room/questions" className={secondaryButtonClass}>Clear</Link></div></form>
    {library.error ? <p role="alert" className="text-sm text-red-600">{library.error}</p> : library.questions.length ? <QuestionLibraryCards questions={library.questions} /> : <p>No questions match this search.</p>}
    <nav aria-label="Question library pages" className="flex flex-wrap gap-3">{page > 0 && <Link href={pageHref(page - 1)} className={secondaryButtonClass}>Previous questions</Link>}{library.hasMore && <Link href={pageHref(page + 1)} className={secondaryButtonClass}>More questions</Link>}</nav>
  </main></AppShell>
}
