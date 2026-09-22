import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell, LegalSection, legalListClass } from '@/app/legal-shell'
import { quietLinkClass } from '@/app/profile/ui'
import { LEGAL_EFFECTIVE_DATE, OPERATOR_NAME } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Privacy Notice — Tempa',
}

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Notice" meta={<>Effective {LEGAL_EFFECTIVE_DATE}</>} currentHref="/privacy">
      <LegalSection heading="1. Scope">
        <p>
          This Privacy Notice explains how {OPERATOR_NAME} handles information in connection with Tempa. It&rsquo;s a
          notice, not a contract &mdash; unlike our{' '}
          <Link href="/terms" className={quietLinkClass}>
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>
          , we don&rsquo;t ask you to accept it as a condition of using Tempa; we publish it so you know what to
          expect.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we collect">
        <ul className={legalListClass}>
          <li>Account and profile information: the pseudonym, answers, and other details you add to your profile.</li>
          <li>Date of birth: collected once, to confirm you&rsquo;re eligible to use Tempa (see Section 3).</li>
          <li>Your Mark: the generated identity image described in Section 4.</li>
          <li>Correspondence: the letters you send and receive through Tempa.</li>
          <li>
            Legal acceptance records: which version of the Terms and Community Guidelines you&rsquo;ve accepted, and
            when.
          </li>
          <li>
            Technical information handled by our infrastructure providers, including Supabase (our application and
            database platform) and Cloudflare Turnstile (used to help confirm sign-in attempts on Tempa are genuine,
            not automated).
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Date of birth and eligibility">
        <p>
          Tempa is for adults. We ask for your date of birth once, to confirm you&rsquo;re at least 18. Your exact
          date of birth is private: it is never shown on your member-facing profile, and we retain it only for
          accounts confirmed eligible.
        </p>
        <p>
          If the date of birth you give us doesn&rsquo;t confirm you&rsquo;re eligible, we don&rsquo;t keep that exact
          date of birth in your account. What we do keep is a derived date &mdash; the point at which it would make
          sense to let the account attempt eligibility again. Because that derived date is calculated directly from
          the date of birth you gave us, it is not anonymous and it is not unrelated to your birth date; we retain it
          only for this re-screening purpose, and only for as long as that purpose requires.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your Mark">
        <p>
          Your Mark is a unique visual identity Tempa generates from a photograph you choose. That processing happens
          locally on your own device &mdash; the source photograph itself is not uploaded to Tempa. Only the
          generated Mark image is uploaded, and it is stored and shown as part of your member-visible profile.
        </p>
      </LegalSection>

      <LegalSection heading="5. Correspondence">
        <p>
          There&rsquo;s a real distinction on Tempa between your public, member-visible profile and the private
          letters you exchange with another member. We don&rsquo;t make correspondence visible to other members, and
          we don&rsquo;t make a practice of reading members&rsquo; private letters. Private correspondence on Tempa is
          not end-to-end encrypted; we may review specific content when it&rsquo;s reported to us, when necessary to
          look into a safety concern, or when required by law.
        </p>
      </LegalSection>

      <LegalSection heading="6. How we use information">
        <ul className={legalListClass}>
          <li>To operate Tempa &mdash; creating and running your profile, delivering correspondence.</li>
          <li>To confirm eligibility and keep age information accurate, as described in Section 3.</li>
          <li>To keep Tempa safe &mdash; responding to reports, and enforcing our Community Guidelines.</li>
          <li>To communicate with you about your account.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. Sharing">
        <p>
          We don&rsquo;t sell your information. We share it with infrastructure providers that help us run Tempa
          (such as Supabase, which hosts our application and database, and Cloudflare Turnstile, which helps confirm
          sign-in attempts are genuine), and we may disclose it where required by law or to protect the safety of our
          members.
        </p>
      </LegalSection>

      <LegalSection heading="8. Retention">
        <p>
          We keep account and profile information for as long as your account is active, and legal acceptance records
          for as long as needed to show what you agreed to and when. Date of birth and eligibility information is
          retained as described in Section 3.
        </p>
      </LegalSection>

      <LegalSection heading="9. Your choices">
        <p>
          You can update your profile at any time. To ask about, correct, or request deletion of your information, or
          to close your account, contact{' '}
          <a href="mailto:privacy@jointempa.com" className={quietLinkClass}>
            privacy@jointempa.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="10. Security">
        <p>
          We rely on our infrastructure providers&rsquo; security practices, including Supabase for application and
          database infrastructure, and take reasonable measures to protect member information. No online service can
          guarantee perfect security.
        </p>
      </LegalSection>

      <LegalSection heading="11. Children">
        <p>
          Tempa is not for anyone under 18. If we learn an account belongs to someone under 18, we handle it as
          described in Section 3 and our{' '}
          <Link href="/terms" className={quietLinkClass}>
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to this notice">
        <p>We may update this Privacy Notice from time to time. We&rsquo;ll update the effective date above when we do.</p>
      </LegalSection>

      <LegalSection heading="13. Contact">
        <p>
          Questions about this notice can be sent to{' '}
          <a href="mailto:privacy@jointempa.com" className={quietLinkClass}>
            privacy@jointempa.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
