import Link from 'next/link'
import RoomQuestionCredit from '@/app/member-questions/room-question-credit'
import type { RoomQuestion } from '@/lib/room-reading'
import { helperTextClass } from '@/app/profile/ui'

export default function QuestionLibraryCards({ questions }: { questions: RoomQuestion[] }) {
  return <div className="grid gap-4 sm:grid-cols-2">{questions.map(q => <article key={q.id} className="space-y-3 rounded-lg border border-foreground/10 p-5">
    <p className={helperTextClass}>{q.is_current ? 'Current Room question' : q.is_flagship ? 'The first Tempa question' : 'A question for the Room'}</p>
    <Link href={`/room?question=${q.id}#question-answers`} className="block font-serif text-xl leading-relaxed">{q.prompt}</Link>
    {q.published_at && <time dateTime={q.published_at} className={helperTextClass}>First asked {new Date(q.published_at).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })}</time>}
    <RoomQuestionCredit questionId={q.id} />
    <Link href={`/room?question=${q.id}#question-answers`} className="inline-block text-sm underline underline-offset-4">See how people answered</Link>
  </article>)}</div>
}
