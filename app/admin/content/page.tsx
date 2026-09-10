import { redirect } from 'next/navigation'

/**
 * /admin/content has exactly one child in Phase 2A-1 (Questions) — no
 * landing page with a single link to click; straight to it. Postcards
 * arrives in Phase 2A-2, at which point this becomes a real switcher
 * (matching app/admin/moderation/layout.tsx's pattern) rather than a
 * redirect.
 */
export default function AdminContentPage() {
  redirect('/admin/content/questions')
}
