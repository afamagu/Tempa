import { redirect } from 'next/navigation'

/**
 * /admin/system redirects to Email — System's first (and so far only)
 * child. Same "redirect to the one real child" shape as
 * app/admin/content/page.tsx before Content grew a tab switcher.
 */
export default function AdminSystemPage() {
  redirect('/admin/system/email')
}
