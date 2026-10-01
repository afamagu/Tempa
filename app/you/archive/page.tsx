import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getEligibleQuestions, getMyAnswers } from '@/lib/questions'
import { getMyWritingStyle } from '@/lib/writing-style-data'
import { dispatchExcerpt, isWithinDispatchEditWindow } from '@/lib/dispatches'
import { formatDateTimeFull } from '@/lib/format-date'
import {
  helperTextClass,
  metadataTextClass,
  pageTitleClass,
  pillClass,
  quietLinkClass,
  sectionLabelClass,
  secondaryButtonClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import QuestionWorkspace from '@/app/minds/question-workspace'
import WriteDispatchButton from '@/app/board/write-dispatch-button'

type ArchiveDispatchRow = {
  id: string
  title: string
  body: string
  published_at: string
  moderation_status: 'visible' | 'hidden'
}

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function groupDispatches(rows: ArchiveDispatchRow[]) {
  const groups: { label: string; rows: ArchiveDispatchRow[] }[] = []
  for (const row of rows) {
    const label = monthLabel(row.published_at)
    const current = groups[groups.length - 1]
    if (current?.label === label) current.rows.push(row)
    else groups.push({ label, rows: [row] })
  }
  return groups
}

export default async function YourArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; mode?: string }>
}) {
  const { tab: tabParam, mode } = await searchParams
  const tab: 'dispatches' | 'responses' = tabParam === 'responses' ? 'responses' : 'dispatches'
  const answering = tab === 'responses' && mode === 'new'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [waitingCount, dispatchResult, pinnedResult, eligibleQuestions, myAnswers, writingStyleId] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    supabase
      .from('dispatches')
      .select('id, title, body, published_at, moderation_status')
      .eq('author_id', user.id)
      .eq('published_as', 'member')
      .eq('status', 'published')
      .order('published_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('pinned_dispatch_id')
      .eq('id', user.id)
      .maybeSingle(),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
    getMyWritingStyle(supabase, user.id),
  ])

  const dispatches = (dispatchResult.data ?? []) as ArchiveDispatchRow[]
  const dispatchIdList = dispatches.map((row) => row.id)
  const [topicResult, replyResult] = dispatchIdList.length > 0
    ? await Promise.all([
        supabase.from('dispatch_topics').select('dispatch_id, topic').in('dispatch_id', dispatchIdList),
        // UI hint only. The mutation RPCs remain authoritative because
        // Reply RLS can hide a moderated Reply from this read.
        supabase.from('dispatch_replies').select('dispatch_id').in('dispatch_id', dispatchIdList),
      ])
    : [{ data: [] }, { data: [] }]

  const topicsByDispatch = new Map<string, string[]>()
  for (const row of (topicResult.data ?? []) as { dispatch_id: string; topic: string }[]) {
    const topics = topicsByDispatch.get(row.dispatch_id) ?? []
    topics.push(row.topic)
    topicsByDispatch.set(row.dispatch_id, topics)
  }
  const replyDispatchIds = new Set(
    ((replyResult.data ?? []) as { dispatch_id: string }[]).map((row) => row.dispatch_id)
  )
  const pinnedDispatchId = pinnedResult.data?.pinned_dispatch_id ?? null
  const dispatchGroups = groupDispatches(dispatches)

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-2xl space-y-8 py-4 sm:py-8">
          <header className="space-y-2">
            <Link href="/you" className={quietLinkClass}>← You</Link>
            <h1 className={pageTitleClass}>Your archive</h1>
            <p className={helperTextClass}>A record of what you&rsquo;ve shared on Tempa.</p>
          </header>

          <nav className="flex flex-wrap gap-2" aria-label="Archive sections">
            <Link href="/you/archive" className={pillClass(tab === 'dispatches')}>Dispatches</Link>
            <Link href="/you/archive?tab=responses" className={pillClass(tab === 'responses')}>Responses</Link>
          </nav>

          {tab === 'dispatches' ? (
            <section className="space-y-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className={sectionLabelClass}>Dispatches</p>
                  <p className={helperTextClass}>Newest first. Open a Dispatch to manage it.</p>
                </div>
                <WriteDispatchButton />
              </div>

              {dispatches.length === 0 ? (
                <div className="space-y-3 rounded-md border border-foreground/10 p-5">
                  <p className={helperTextClass}>You haven&rsquo;t published a Dispatch yet.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {dispatchGroups.map((group) => (
                    <section key={group.label} className="space-y-1">
                      <p className={`${sectionLabelClass} pb-2`}>{group.label}</p>
                      <div className="divide-y divide-foreground/10 border-y border-foreground/10">
                        {group.rows.map((dispatch) => {
                          const topics = topicsByDispatch.get(dispatch.id) ?? []
                          const hasReplies = replyDispatchIds.has(dispatch.id)
                          const hidden = dispatch.moderation_status === 'hidden'
                          const editable = !hidden && !hasReplies && isWithinDispatchEditWindow(dispatch.published_at)
                          const pinned = pinnedDispatchId === dispatch.id
                          return (
                            <article key={dispatch.id} className="py-6 first:pt-5 last:pb-5">
                              <Link href={`/board/${dispatch.id}`} className="block space-y-2 transition-opacity hover:opacity-85">
                                <div className="flex items-start justify-between gap-4">
                                  <h2 className="font-serif text-[21px] font-semibold leading-snug text-foreground">{dispatch.title}</h2>
                                  <span aria-hidden className="shrink-0 text-foreground/45">→</span>
                                </div>
                                {topics.length > 0 && (
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{topics.join(' · ')}</p>
                                )}
                                <p className={metadataTextClass}>{formatDateTimeFull(dispatch.published_at)}</p>
                                {!hidden && (
                                  <p className="line-clamp-2 text-[15px] leading-relaxed text-foreground/75">{dispatchExcerpt(dispatch.body)}</p>
                                )}
                              </Link>

                              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                                {pinned && <span className={helperTextClass}>Pinned to profile</span>}
                                {hidden ? (
                                  <span className={helperTextClass}>Hidden by TEMPA.</span>
                                ) : (
                                  <>
                                    {hasReplies && <span className={helperTextClass}>Has responses</span>}
                                    {editable && (
                                      <Link href={`/board/${dispatch.id}/edit`} className={quietLinkClass}>Edit Dispatch</Link>
                                    )}
                                    <Link href={`/board/${dispatch.id}`} className={quietLinkClass}>
                                      {hasReplies ? 'Open · management is limited after a response' : 'Open & manage'}
                                    </Link>
                                  </>
                                )}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className={sectionLabelClass}>Responses</p>
                  {!answering && <p className={helperTextClass}>Your answers to Tempa&rsquo;s Questions, including earlier ones.</p>}
                </div>
                {answering ? (
                  <Link href="/you/archive?tab=responses" className={secondaryButtonClass}>Back to Responses</Link>
                ) : (
                  <Link href="/you/archive?tab=responses&mode=new" className={secondaryButtonClass}>Answer another Question</Link>
                )}
              </div>

              <QuestionWorkspace
                tab={answering ? 'new' : 'answers'}
                questions={eligibleQuestions}
                answers={myAnswers}
                writingStyleId={writingStyleId}
              />
            </section>
          )}
        </div>
      </main>
    </AppShell>
  )
}
