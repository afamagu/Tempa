import { redirect } from 'next/navigation'

/**
 * /admin/system redirects to Email — System's default child. Translation
 * sits beside it (app/admin/system/system-tabs.tsx), the same shape as
 * app/admin/content/page.tsx once Content grew a tab switcher.
 */
export default function AdminSystemPage() {
  redirect('/admin/system/email')
}
