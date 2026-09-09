import Link from 'next/link'
import Mindform from '@/app/mindform'

/**
 * The single-sender Arrivals identity — Mindform + pseudonym as ONE
 * link to that person's public profile, deliberately separate from the
 * "N letter(s) waiting" card next to it: clicking the person and
 * clicking "read this letter" are different intents, and only the
 * former should land on a profile. Only ever rendered when exactly one
 * person is awaiting a reply (see app/home/page.tsx) — with more than
 * one sender there's no single identity to attach this to.
 */
export default function ArrivalSenderLink({
  senderId,
  pseudonym,
}: {
  senderId: string
  pseudonym: string
}) {
  return (
    <Link
      href={`/minds/${senderId}`}
      className="flex w-fit items-center gap-2 rounded-md py-1 transition-opacity hover:opacity-80"
    >
      <Mindform identifier={senderId} size="sm" />
      <span className="text-[14px] font-medium text-foreground">{pseudonym}</span>
    </Link>
  )
}
