import { redirect } from 'next/navigation'

/**
 * /admin/content redirects to Questions by default — Content now has
 * three real children (Questions, Announcements, Postcards — Admin
 * Phase 2A-2 added the last one), switched between via ContentTabs;
 * this bare landing route just needs to land somewhere real.
 */
export default function AdminContentPage() {
  redirect('/admin/content/questions')
}
