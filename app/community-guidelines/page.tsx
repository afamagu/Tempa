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
          to perform for, and not a place to meet strangers under false pretenses. These Guidelines exist to keep it
          that way. Agreeing to them is part of joining Tempa, alongside our{' '}
          <Link href="/terms" className={quietLinkClass}>
            Terms of Service
          </Link>
          . We&rsquo;ve tried to write them so that honest, difficult, or sensitive writing is still welcome here
          &mdash; these rules are about how people treat each other, not about avoiding hard subjects.
        </p>
      </LegalSection>

      <LegalSection heading="2. Be who you say you are">
        <ul className={legalListClass}>
          <li>
            Tempa is only for people who are actually 18 or older. Don&rsquo;t misstate your date of birth or
            otherwise try to get around our eligibility check.
          </li>
          <li>
            A pseudonym is welcome &mdash; that&rsquo;s expected on Tempa &mdash; but impersonating a specific real
            person, brand, or organization to deceive someone is not.
          </li>
          <li>Don&rsquo;t misrepresent your age, intentions, or identity to another member.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Respect boundaries and blocks">
        <p>
          Tempa supports reporting and blocking, and we expect members to respect the boundaries other members set.
          If someone blocks you or asks you to stop contacting them, that decision stands. Don&rsquo;t use another
          account, or any other means, to get around a block.
        </p>
      </LegalSection>

      <LegalSection heading="4. Treat people with respect">
        <ul className={legalListClass}>
          <li>No harassment, stalking, or repeated unwanted contact after someone has asked you to stop.</li>
          <li>No hateful or dehumanizing conduct directed at someone for who they are.</li>
          <li>No unwanted sexual conduct or sexual solicitation.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Absolute lines &mdash; no exceptions">
        <ul className={legalListClass}>
          <li>
            Sexual content or solicitation involving, or appearing to involve, anyone under 18 &mdash; including
            grooming behavior &mdash; is never allowed, under any circumstance.
          </li>
          <li>Credible threats of serious violence are never allowed.</li>
          <li>Using Tempa to plan, promote, or carry out serious unlawful activity is never allowed.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Money, scams, and pressure">
        <ul className={legalListClass}>
          <li>Financial and romance scams have no place on Tempa.</li>
          <li>
            Don&rsquo;t ask another member for money, cryptocurrency, gift cards, or investment, or invent an
            emergency to pressure them into sending any of those.
          </li>
          <li>
            Be cautious of anyone who tries to move your conversation off Tempa quickly, especially alongside a
            request like the above &mdash; see our{' '}
            <Link href="/safety" className={quietLinkClass}>
              Safety
            </Link>{' '}
            page for more.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. Privacy and intimate content">
        <ul className={legalListClass}>
          <li>Don&rsquo;t share another member&rsquo;s private correspondence or personal information without their consent.</li>
          <li>
            Don&rsquo;t share, or threaten to share, intimate images of someone without their consent, and never use
            them to pressure or extort another member.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Keeping Tempa itself safe">
        <ul className={legalListClass}>
          <li>No spam or unsolicited commercial solicitation.</li>
          <li>No artificially manipulating engagement, ratings, or signals like &ldquo;worth reading&rdquo; marks.</li>
          <li>No scraping, bots, or other automated access outside of anything we officially provide for that purpose.</li>
          <li>No phishing, malware, or attempts to obtain another member&rsquo;s credentials.</li>
          <li>No content that infringes someone else&rsquo;s intellectual property rights.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="9. Difficult subjects">
        <p>
          Genuine, thoughtful writing sometimes touches on hard things &mdash; grief, mental health, hardship, and
          more &mdash; and that&rsquo;s not what these Guidelines are here to stop. What&rsquo;s not allowed is
          content that encourages or gives instructions for self-harm, or that otherwise crosses one of the lines
          above. If you&rsquo;re ever concerned about another member&rsquo;s safety, or your own, see our{' '}
          <Link href="/safety" className={quietLinkClass}>
            Safety
          </Link>{' '}
          page.
        </p>
      </LegalSection>

      <LegalSection heading="10. Reporting and blocking">
        <p>
          If something feels wrong &mdash; a profile, a letter, a Dispatch, a pattern of behavior &mdash; report it.
          Reports help us understand what&rsquo;s happening and respond; blocking is yours to use any time, for any
          reason, with no explanation required. Reports made in bad faith &mdash; to harass someone or abuse the
          reporting process rather than to raise a genuine concern &mdash; are themselves a violation of these
          Guidelines. See our{' '}
          <Link href="/safety" className={quietLinkClass}>
            Safety
          </Link>{' '}
          page for more on how this works.
        </p>
      </LegalSection>

      <LegalSection heading="11. How we respond">
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

      <LegalSection heading="12. Changes to these Guidelines">
        <p>
          We may update these Guidelines from time to time. Material changes carry a new version, and we&rsquo;ll ask
          members to review and accept the update before continuing to use Tempa.
        </p>
      </LegalSection>

      <LegalSection heading="13. Contact">
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
