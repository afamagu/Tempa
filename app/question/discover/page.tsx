import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveQuestions } from '@/lib/questions'
import { sectionLabelClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import DiscoveryFilters from './discovery-filters'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'

const SAMPLE_SIZE = 12

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; gender?: string; age?: string }>
}) {
  const { country, gender, age } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const activeQuestions = await getActiveQuestions(supabase)

  if (activeQuestions.length === 0) {
    redirect('/home')
  }

  const promptByQuestionId = new Map(activeQuestions.map((q) => [q.id, q.prompt]))
  const activeQuestionIds = activeQuestions.map((q) => q.id)

  const { data: answers } = await supabase
    .from('question_answers')
    .select('id, user_id, question_id, body')
    .in('question_id', activeQuestionIds)
    .eq('is_current', true)
    .neq('user_id', user.id)

  const eligible = answers ?? []

  const userIds = [...new Set(eligible.map((a) => a.user_id))]
  const profilesById = new Map<
    string,
    { pseudonym: string; country: string; gender: string | null; gender_custom: string | null; age_range: string }
  >()

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range')
      .in('id', userIds)

    for (const p of profiles ?? []) {
      profilesById.set(p.id, p)
    }
  }

  const joined = eligible
    .map((a) => ({ ...a, profile: profilesById.get(a.user_id) }))
    .filter(
      (a): a is typeof a & { profile: NonNullable<typeof a.profile> } =>
        a.profile !== undefined
    )
    .filter((a) => (country ? a.profile.country === country : true))
    .filter((a) =>
      gender ? genderDisplay(a.profile.gender, a.profile.gender_custom) === gender || a.profile.gender === gender : true
    )
    .filter((a) => (age ? a.profile.age_range === age : true))

  const sample = shuffle(joined).slice(0, SAMPLE_SIZE)

  const entries: DiscoveryEntry[] = sample.map((a) => ({
    id: a.id,
    userId: a.user_id,
    body: a.body,
    pseudonym: a.profile.pseudonym,
    country: a.profile.country,
    genderDisplay: genderDisplay(a.profile.gender, a.profile.gender_custom),
    ageRange: a.profile.age_range,
    prompt: promptByQuestionId.get(a.question_id) ?? '',
  }))

  return (
    <main className="min-h-screen flex justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <div className="space-y-3">
          <Link href="/home" className={secondaryButtonClass}>
            Home
          </Link>
          <p className={sectionLabelClass}>Discovery</p>
          <p className={helperTextClass}>
            Filters narrow the pool. Writing determines whom you choose.
          </p>
        </div>

        <DiscoveryFilters
          country={country ?? ''}
          gender={gender ?? ''}
          ageRange={age ?? ''}
        />

        {entries.length === 0 ? (
          <div className="space-y-2">
            <p className={helperTextClass}>No answers match right now.</p>
            <p className={helperTextClass}>
              Try widening your filters, or check back as more minds answer.
            </p>
          </div>
        ) : (
          <DiscoveryResults entries={entries} />
        )}
      </div>
    </main>
  )
}
