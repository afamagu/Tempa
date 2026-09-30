import { redirect } from 'next/navigation'

/** Legacy discovery URL retained only for compatibility. */
export default function MindsPage() {
  redirect('/room')
}
