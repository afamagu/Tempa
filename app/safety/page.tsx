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
          Tempa is built for genuine, unhurried correspondence between adults who mostly don&rsquo;t know each other
          yet. That&rsquo;s a wonderful thing, and it&rsquo;s also worth a little care &mdash; this page is a
          practical guide, not a warning label. Reporting and blocking are built into Tempa, and everyone using it
          has agreed to our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="2. Everyone here is meant to be an adult">
        <p>
          Tempa is an adult service, open only to people who are at least 18. Every account is checked for this
          before it can be created, using the date of birth someone provides. Like any online age check, this relies
          on what a person tells us &mdash; it reduces risk, but it isn&rsquo;t a substitute for your own judgment.
        </p>
      </LegalSection>

      <LegalSection heading="3. What &ldquo;member-visible&rdquo; actually means">
        <p>
          Your pseudonym, Mark, Question answer, and any Dispatch you publish to the Board are visible to other
          Tempa members &mdash; and if you generate a share link for a Dispatch, to anyone who has that link, even if
          they&rsquo;re not a Tempa member. Country and any gender you choose to share are shown on your profile too.
          Keep that in mind when deciding what to include in something you publish.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your Mark and your real photo">
        <p>
          Your Mark is a generated visual identity, not a photo of you &mdash; the photograph you choose to create it
          from is processed on your own device and never uploaded. Only the generated Mark image is, and it&rsquo;s
          part of your public profile.
        </p>
      </LegalSection>

      <LegalSection heading="5. Letters are private-facing, but not invisible to us in every case">
        <p>
          Letters you exchange with another member aren&rsquo;t shown to other members. They&rsquo;re also not
          end-to-end encrypted, and we don&rsquo;t make a practice of reading them &mdash; specific content can be
          accessed where it&rsquo;s genuinely needed, such as investigating a report, responding to a safety concern,
          providing support you&rsquo;ve requested, or protecting Tempa&rsquo;s security.
        </p>
      </LegalSection>

      <LegalSection heading="6. If someone tries to rush you off Tempa">
        <p>
          It&rsquo;s common, and often fine, for a correspondence to eventually move to another way of staying in
          touch. But if someone you&rsquo;ve just started writing to is in a hurry to get you off Tempa &mdash;
          especially before you&rsquo;ve had time to get a real sense of them &mdash; treat that as a reason to slow
          down, not speed up.
        </p>
      </LegalSection>

      <LegalSection heading="7. Money and romance scams">
        <ul className={legalListClass}>
          <li>Never send money, cryptocurrency, or gift cards to someone you know only from Tempa, no matter how convincing the story.</li>
          <li>
            Be especially cautious of a sudden emergency, an investment &ldquo;opportunity,&rdquo; or a relationship
            that moves to declarations of love unusually quickly.
          </li>
          <li>If something feels engineered to rush you into a decision, it probably is &mdash; slow down and talk to someone you trust.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Spotting a profile that isn&rsquo;t what it seems">
        <p>
          Profile details like country, age range, and languages are self-reported, not independently verified
          identity checks. Inconsistent stories, refusal to answer simple questions, or writing that feels
          copy-pasted are worth paying attention to.
        </p>
      </LegalSection>

      <LegalSection heading="9. Intimate images">
        <p>
          You&rsquo;re never obligated to share an intimate image with anyone on Tempa. If someone pressures you to,
          or threatens to share one without your consent, that&rsquo;s a serious violation of our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>{' '}
          &mdash; report it, and consider blocking.
        </p>
      </LegalSection>

      <LegalSection heading="10. Links and files">
        <p>
          Be cautious about clicking a link or opening a file someone sends you, the same way you would anywhere
          else online, especially if it&rsquo;s unexpected or paired with urgency.
        </p>
      </LegalSection>

      <LegalSection heading="11. Meeting in person">
        <p>
          If a correspondence leads to meeting in person, take the same sensible precautions you would meeting anyone
          new: meet somewhere public, tell someone you trust where you&rsquo;ll be, and arrange your own way there
          and back.
        </p>
      </LegalSection>

      <LegalSection heading="12. Reporting and blocking">
        <p>
          If a member&rsquo;s profile or a letter concerns you, report it. Reports go to Tempa for review, and we may
          remove content, warn, restrict, or terminate an account as a result.
        </p>
        <p>
          Blocking is separate from reporting and is entirely yours to use &mdash; you can block another member at
          any time, for any reason, with no explanation required. Once you block someone, that decision stands.
        </p>
      </LegalSection>

      <LegalSection heading="13. Keep your account secure">
        <p>
          Keep the email address and sign-in access to your Tempa account to yourself, and let us know at{' '}
          <a href="mailto:support@jointempa.com" className={quietLinkClass}>
            support@jointempa.com
          </a>{' '}
          if you think someone else has access to it.
        </p>
      </LegalSection>

      <LegalSection heading="14. If you&rsquo;re in immediate danger">
        <p>
          Tempa is not an emergency service. If you or someone else is in immediate danger, contact your local
          emergency services first.
        </p>
      </LegalSection>

      <LegalSection heading="15. What moderation can and can&rsquo;t do">
        <p>
          Our eligibility check, reporting, blocking, and moderation reduce risk on Tempa, but no combination of
          these can eliminate it entirely. Trust your own judgment alongside the tools we provide.
        </p>
      </LegalSection>

      <LegalSection heading="16. Contact">
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
