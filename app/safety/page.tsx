import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell, LegalSection, legalListClass } from '@/app/legal-shell'
import { quietLinkClass } from '@/app/profile/ui'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Safety — Tempa',
}

export default function SafetyPage() {
  return (
    <LegalPageShell title="Safety" meta={<>Effective {LEGAL_EFFECTIVE_DATE}</>} currentHref="/safety">
      <LegalSection heading="1. Our approach">
        <p>
          Tempa is built for genuine, unhurried correspondence between adults. That only works if members feel safe
          using it, so reporting and blocking are built into Tempa, not an afterthought, and everyone using Tempa has
          agreed to our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="2. Reporting and blocking">
        <p>
          If a member&rsquo;s profile or a letter concerns you, you can report it. Reports go to Tempa for review, and
          we may remove content, warn, restrict, or terminate an account as a result.
        </p>
        <p>
          Blocking is separate from reporting and is entirely yours to use &mdash; you can block another member at
          any time, for any reason, with no explanation required. Once you block someone, that decision stands.
        </p>
      </LegalSection>

      <LegalSection heading="3. If you&rsquo;re worried about someone">
        <p>
          If another member&rsquo;s behavior concerns you &mdash; something that feels dishonest, pressuring, or
          unsafe &mdash; report it and consider blocking. You don&rsquo;t need to justify a block, and you don&rsquo;t
          need to keep corresponding with someone you&rsquo;d rather not hear from.
        </p>
        <p>
          If you or someone else is in immediate danger, contact your local emergency services first &mdash; Tempa
          isn&rsquo;t a substitute for that.
        </p>
      </LegalSection>

      <LegalSection heading="4. Age and eligibility">
        <p>
          Tempa is an adult service, open only to people who are at least 18. Every account is checked for this
          before it can be created, and eligibility is confirmed by Tempa&rsquo;s systems rather than taken on trust.
        </p>
      </LegalSection>

      <LegalSection heading="5. Correspondence privacy">
        <p>
          Letters you exchange with another member are private &mdash; we don&rsquo;t make them visible to other
          members, and we don&rsquo;t make a practice of reading them. Private correspondence on Tempa is not
          end-to-end encrypted, so we&rsquo;re able to review specific content when it&rsquo;s reported to us or when
          necessary to look into a safety concern.
        </p>
      </LegalSection>

      <LegalSection heading="6. What we don&rsquo;t allow">
        <ul className={legalListClass}>
          <li>Harassment, threats, or targeted abuse.</li>
          <li>Sexual content or solicitation involving, or appearing to involve, anyone under 18.</li>
          <li>Impersonation or misrepresenting your identity, age, or intentions.</li>
          <li>Attempting to bypass Tempa&rsquo;s eligibility checks, reporting tools, or blocking.</li>
        </ul>
        <p>
          See our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>{' '}
          for the complete list.
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact">
        <p>
          To report a safety concern, reach us at{' '}
          <a href="mailto:safety@jointempa.com" className={quietLinkClass}>
            safety@jointempa.com
          </a>
          . For anything else, use{' '}
          <a href="mailto:support@jointempa.com" className={quietLinkClass}>
            support@jointempa.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
