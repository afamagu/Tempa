import { redirect } from 'next/navigation'

/** /admin/feedback redirects to its one child, Account exits. */
export default function AdminFeedbackPage() {
  redirect('/admin/feedback/account-exits')
}
