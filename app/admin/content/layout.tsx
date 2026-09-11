import ContentTabs from './content-tabs'

/**
 * Admin Operations Refinement checkpoint — Content grows a second
 * child (Announcements), matching app/admin/moderation/layout.tsx's
 * exact pattern: a small pill switcher, both children independently
 * staff-gated by the shared app/admin/layout.tsx, no auth logic here.
 */
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ContentTabs />
      {children}
    </div>
  )
}
