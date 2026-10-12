import { redirect } from 'next/navigation'

export const metadata = { title: 'Join Tempa', robots: { index: false, follow: false } }

/** Old invitation links continue through ordinary authentication and onboarding. */
export default function PilotAccessPage() {
  redirect('/board')
}
