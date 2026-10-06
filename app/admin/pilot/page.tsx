import { createClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/admin'
import { getPilotHealth, listPilotInvites, percentage } from '@/lib/admin-pilot'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { PilotInviteForm, RevokePilotInviteButton } from './pilot-controls'

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md border border-foreground/10 bg-background px-4 py-3">
      <p className={adminMetadataClass}>{label}</p>
      <p className="mt-1 text-2xl font-medium text-foreground">{value}</p>
      {hint && <p className={adminMetadataClass}>{hint}</p>}
    </div>
  )
}

export default async function AdminPilotPage() {
  const supabase = await createClient()
  if (!(await isStaff(supabase, 'admin'))) {
    return <p className="text-sm text-red-700">Pilot controls are limited to admins.</p>
  }

  const [healthResult, invitesResult] = await Promise.all([
    getPilotHealth(supabase),
    listPilotInvites(supabase),
  ])

  const health = healthResult.data
  const error = healthResult.error ?? invitesResult.error

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className={sectionTitleClass}>Founding Correspondents Pilot</h1>
        <p className={adminMetadataClass}>
          Closed cohort health. Aggregate relationship metadata only — never letter bodies or popularity scoring.
        </p>
      </header>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {health && (
        <>
          <section className="space-y-3">
            <h2 className="text-[17px] font-medium text-foreground">Cohort</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Pilot members" value={health.cohortMembers} hint="Hard ceiling: 200 accounts" />
              <Stat label="Pending invitations" value={health.pendingInvites} />
              <Stat label="Profiles created" value={health.profilesCreated} />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-medium text-foreground">Meaningful exchange funnel</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="First-contact correspondences" value={health.firstContactCorrespondences} />
              <Stat
                label="Established"
                value={health.establishedCorrespondences}
                hint={percentage(health.establishedCorrespondences, health.firstContactCorrespondences) + ' of first contacts'}
              />
              <Stat
                label="Reached 3 turns"
                value={health.thirdTurnCorrespondences}
                hint={percentage(health.thirdTurnCorrespondences, health.establishedCorrespondences) + ' of established'}
              />
              <Stat
                label="Reached 5 turns"
                value={health.fifthTurnCorrespondences}
                hint={percentage(health.fifthTurnCorrespondences, health.establishedCorrespondences) + ' of established'}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-medium text-foreground">Correspondence survival</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="30 days"
                value={percentage(health.survival30Alive, health.survival30Eligible)}
                hint={health.survival30Alive + ' of ' + health.survival30Eligible + ' eligible correspondences'}
              />
              <Stat
                label="60 days"
                value={percentage(health.survival60Alive, health.survival60Eligible)}
                hint={health.survival60Alive + ' of ' + health.survival60Eligible + ' eligible correspondences'}
              />
              <Stat
                label="90 days"
                value={percentage(health.survival90Alive, health.survival90Eligible)}
                hint={health.survival90Alive + ' of ' + health.survival90Eligible + ' eligible correspondences'}
              />
            </div>
            <p className={adminMetadataClass}>
              Survival means at least one letter was written on or after the correspondence’s 30/60/90-day anniversary.
            </p>
          </section>
        </>
      )}

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-[17px] font-medium text-foreground">Invite a Founding Correspondent</h2>
          <p className={adminMetadataClass}>
            The invitation is bound to the email address. Existing accounts are already grandfathered.
          </p>
        </div>
        <PilotInviteForm />

        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10 bg-background">
          {invitesResult.data.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No pilot invitations yet.</p>
          ) : (
            invitesResult.data.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={adminTableTextClass}>{invite.email}</p>
                  <p className={adminMetadataClass}>
                    {invite.status}
                    {invite.memberPseudonym ? ' · ' + invite.memberPseudonym : ''}
                    {invite.note ? ' · ' + invite.note : ''}
                  </p>
                </div>
                {invite.status === 'pending' && <RevokePilotInviteButton inviteId={invite.id} />}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-foreground/10 bg-background px-4 py-4">
        <h2 className="text-[16px] font-medium text-foreground">Pilot guardrails</h2>
        <p className={adminMetadataClass}>
          Five active/committed correspondences. Maximum two unresolved outgoing first letters. No paid capacity expansion, boosts, priority delivery, read receipts, last-seen, streaks, likes or follower mechanics.
        </p>
      </section>
    </div>
  )
}