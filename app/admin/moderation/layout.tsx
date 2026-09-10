import ModerationTabs from './moderation-tabs'

/**
 * Admin Command Center Phase 2A-1 — Moderation groups the two
 * moderation surfaces (reactive Reports, proactive Public Content
 * Review) under one nav concept, per the target permanent structure.
 * A small local pill switcher, not a second full nav bar — matches the
 * restrained pattern the rest of /admin already uses. Both children
 * stay independently staff-gated by the shared app/admin/layout.tsx;
 * this file adds no auth logic of its own.
 */
export default function ModerationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ModerationTabs />
      {children}
    </div>
  )
}
