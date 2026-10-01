'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
export async function refreshWrittenProfile(recipientId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(recipientId)) return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  revalidatePath(`/room/${recipientId}`)
  revalidatePath(`/minds/${recipientId}`)
  revalidatePath('/letters')
}
