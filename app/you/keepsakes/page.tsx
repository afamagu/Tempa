import { redirect } from 'next/navigation'

/**
 * Admin Phase 2A-2 — Keepsakes has exactly one child so far (Postcards)
 * — straight to it, matching app/admin/content/page.tsx's own
 * redirect-until-there's-more-than-one-child pattern. A future
 * Keepsakes category becomes a real switcher, not a redirect.
 */
export default function KeepsakesPage() {
  redirect('/you/keepsakes/postcards')
}
