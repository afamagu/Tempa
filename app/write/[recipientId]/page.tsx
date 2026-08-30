import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sectionLabelClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'

export default async function WriteToPage({
  params,
}: {
  params: Promise<{ recipientId: string }>
}) {
  const { recipientId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: recipient } = await supabase
    .from('public_profiles')
    .select('pseudonym')
    .eq('id', recipientId)
    .maybeSingle()

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 py-10 text-center">
        <p className={sectionLabelClass}>Write to this mind</p>
        {recipient && (
          <p className="text-lg font-medium">{recipient.pseudonym}</p>
        )}
        <p className={helperTextClass}>
          The first-letter composer is the next stage of Tempa. This is just
          a placeholder for now.
        </p>
        <Link href="/question/discover" className={secondaryButtonClass}>
          Back to discovery
        </Link>
      </div>
    </main>
  )
}
