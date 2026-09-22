import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell, LegalSection, legalListClass } from '@/app/legal-shell'
import { quietLinkClass } from '@/app/profile/ui'
import { CURRENT_COMMUNITY_GUIDELINES_VERSION, LEGAL_EFFECTIVE_DATE } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Community Guidelines — Tempa',
}

export default function CommunityGuidelinesPage() {
  return (
    <LegalPageShell
      title="Community Guidelines"
      meta={
        <>
          Version {CURRENT_COMMUNITY_GUIDELINES_VERSION} · Effective {LEGAL_EFFECTIVE_DATE}
        </>
      }
      currentHref="/community-guidelines"
    >
      <LegalSection heading="1. The spirit of Tempa">
        <p>
          Tempa is a place for genuine correspondence between adults &mdash; unhurried, thoughtful writing, not a feed
          to perform for. These Guidelines exist to keep it that way. Agreeing to them is part of joining Tempa,
          alongside our{' '}
          <Link href="/terms" className={quietLinkClass}>
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="2. Be genuine">
        <p>
          Represent yourself honestly. Your profile, your Mark, and what you write to another member should reflect
          who you actually are &mdash; not a persona built to deceive someone.
        </p>
      </LegalSection>

      <LegalSection heading="3. Respect boundaries">
        <p>
          Tempa supports reporting and blocking, and we expect members to respect the boundaries other members set.
          If someone blocks you or asks you to stop contacting them, that decision stands. Don&rsquo;t use Tempa or
          any other means to work around a block.
        </p>
      </LegalSection>

      <LegalSection heading="4. What&rsquo;s not allowed">
        <p>The following are never acceptable on Tempa:</p>
        <ul className={legalListClass}>
          <li>Harassment, threats, hate speech, or targeted abuse of another member.</li>
          <li>Sexual content or solicitation involving, or appearing to involve, anyone under 18.</li>
          <li>Impersonating another person, or misrepresenting your identity, age, or intentions.</li>
          <li>Illegal content, or content promoting illegal activity.</li>
          <li>Sharing another member&rsquo;s private correspondence or personal information without their consent.</li>
          <li>Spam, solicitation, or using Tempa to advertise unrelated products or services.</li>
          <li>Attempting to bypass Tempa&rsquo;s eligibility checks, reporting tools, or blocking.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Reporting and blocking">
        <p>
          If something feels wrong &mdash; a profile, a letter, a pattern of behavior &mdash; report it. Reports help
          us understand what&rsquo;s happening and respond; blocking is yours to use any time, for any reason, with
          no explanation required. See our{' '}
          <Link href="/safety" className={quietLinkClass}>
            Safety
          </Link>{' '}
          page for more on how this works.
        </p>
      </LegalSection>

      <LegalSection heading="6. How we respond">
        <p>
          Depending on what we find, we may remove content, warn an account, restrict what it can do, or terminate it
          &mdash; consistent with our{' '}
          <Link href="/terms" className={quietLinkClass}>
            Terms of Service
          </Link>
          . We take reports seriously, but we don&rsquo;t make a practice of reading members&rsquo; private
          correspondence outside of that process.
        </p>
      </LegalSection>

      <LegalSection heading="7. Changes to these Guidelines">
        <p>
          We may update these Guidelines from time to time. Material changes carry a new version, and we&rsquo;ll ask
          members to review and accept the update before continuing to use Tempa.
        </p>
      </LegalSection>

      <LegalSection heading="8. Contact">
        <p>
          Questions, or something to report, can go to{' '}
          <a href="mailto:safety@jointempa.com" className={quietLinkClass}>
            safety@jointempa.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
