import SystemTabs from './system-tabs'

/**
 * System grows a second child (Translation) beside Email, matching
 * app/admin/content/layout.tsx: a small pill switcher, both children
 * staff-gated by the shared app/admin/layout.tsx, no auth logic here.
 */
export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SystemTabs />
      {children}
    </div>
  )
}
