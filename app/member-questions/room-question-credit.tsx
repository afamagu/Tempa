import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

export default async function RoomQuestionCredit({ questionId }: { questionId: string }) {
  const client = await createClient()
  const { data, error } = await client.rpc('room_question_credit', { p_question_id: questionId })
  const credit = data?.[0] as { user_id: string; pseudonym: string; mark_id: string | null } | undefined
  if (error || !credit) return null
  const mark = credit.mark_id ? publicProfileMarkUrl(client, `${credit.mark_id}.png`) : null
  return <Link href={`/room/${credit.user_id}?returnTo=%2Froom`} className="inline-flex items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
    {mark && <img src={mark} alt="" className="h-6 w-6 rounded-full object-cover" />}
    A question from {credit.pseudonym}
  </Link>
}
