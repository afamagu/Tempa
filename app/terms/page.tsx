import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell, LegalSection } from '@/app/legal-shell'
import { quietLinkClass } from '@/app/profile/ui'
import { CURRENT_TERMS_VERSION, LEGAL_EFFECTIVE_DATE, OPERATOR_NAME } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Terms of Service — Tempa',
}

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      meta={
        <>
          Version {CURRENT_TERMS_VERSION} · Effective {LEGAL_EFFECTIVE_DATE}
        </>
      }
      currentHref="/terms"
    >
      <LegalSection heading="1. Who we are">
        <p>
          Tempa is a pen-pal and correspondence platform operated by {OPERATOR_NAME} (&ldquo;Tempa,&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;). These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use
          of Tempa. By creating a Tempa profile, you enter into this agreement with {OPERATOR_NAME}.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility">
        <p>
          Tempa is an adult service, open only to people who are at least 18 years old. When you begin creating a
          profile, we ask for your date of birth to confirm this. Your exact date of birth is kept private and is
          never shown on your member-facing profile.
        </p>
        <p>
          If we&rsquo;re unable to confirm you&rsquo;re at least 18, you won&rsquo;t be able to create a Tempa
          profile. Our{' '}
          <Link href="/privacy" className={quietLinkClass}>
            Privacy Notice
          </Link>{' '}
          explains what happens to that information.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accepting these Terms">
        <p>
          Before you can use Tempa, you must agree to these Terms and to our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>
          . We keep a durable, versioned record of that acceptance. If we materially change either document, we&rsquo;ll
          ask you to review and accept the new version before you continue using Tempa &mdash; accepting an earlier
          version doesn&rsquo;t carry forward to a later one.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your account">
        <p>
          You&rsquo;re responsible for the information in your profile and for anything that happens through your
          account. Keep your sign-in access to yourself, and let us know at{' '}
          <a href="mailto:support@jointempa.com" className={quietLinkClass}>
            support@jointempa.com
          </a>{' '}
          if you believe someone else has access to your account.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your Mark">
        <p>
          As part of setting up your profile, Tempa generates a unique visual identity for you &mdash; your
          &ldquo;Mark&rdquo; &mdash; from a photograph you choose. That source photograph is processed on your own
          device; it is not uploaded to Tempa. Only the resulting Mark image is uploaded, and it is stored and shown
          as part of your member-visible profile, the same as the rest of your profile content.
        </p>
      </LegalSection>

      <LegalSection heading="6. Correspondence and profile content">
        <p>
          Tempa distinguishes between two kinds of content. Your profile &mdash; including your Mark and anything you
          choose to publish there &mdash; is member-visible. Letters you exchange with another member are private
          correspondence between the two of you, and we don&rsquo;t make them visible to other members.
        </p>
        <p>
          Private correspondence on Tempa is not end-to-end encrypted. We don&rsquo;t make a practice of reading
          members&rsquo; private letters; we may review specific content when it&rsquo;s reported to us, when
          necessary to investigate a safety concern, or when required by law.
        </p>
      </LegalSection>

      <LegalSection heading="7. Community Guidelines, reporting, and blocking">
        <p>
          Using Tempa means following our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>
          . Tempa supports reporting and blocking, so you can flag content or behavior that concerns you and control
          who can reach you. We may review, restrict, or remove content, and warn, restrict, or terminate accounts,
          when we determine the Guidelines or these Terms have been violated.
        </p>
      </LegalSection>

      <LegalSection heading="8. Your content">
        <p>
          You retain ownership of what you write and share on Tempa. By posting or sending content through Tempa, you
          give us permission to store, transmit, and display it as needed to operate the service &mdash; for example,
          delivering your letters and showing your profile to other members.
        </p>
      </LegalSection>

      <LegalSection heading="9. Ending your use of Tempa">
        <p>
          You may stop using Tempa, and request closure of your account, at any time by contacting{' '}
          <a href="mailto:support@jointempa.com" className={quietLinkClass}>
            support@jointempa.com
          </a>
          . We may suspend or terminate an account that violates these Terms or the Community Guidelines, or where
          we&rsquo;re required to do so by law.
        </p>
      </LegalSection>

      <LegalSection heading="10. Disclaimers">
        <p>
          Tempa is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We work to keep the
          service running well and to keep members safe, but we don&rsquo;t promise that Tempa will always be
          uninterrupted, error-free, or free of content you find objectionable, and we don&rsquo;t vouch for the
          conduct of any member.
        </p>
      </LegalSection>

      <LegalSection heading="11. Limitation of liability">
        <p>
          To the fullest extent permitted by law, {OPERATOR_NAME} will not be liable for indirect, incidental, or
          consequential damages arising from your use of Tempa, and our total liability for any claim relating to
          Tempa will not exceed the amount (if any) you have paid us in the twelve months before the claim arose.
        </p>
      </LegalSection>

      <LegalSection heading="12. Indemnity">
        <p>
          You agree to indemnify and hold {OPERATOR_NAME} harmless from claims, losses, and expenses arising from
          your misuse of Tempa or your violation of these Terms or the Community Guidelines.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will carry a new version, and we&rsquo;ll ask
          members to review and accept the updated Terms before continuing to use Tempa.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact">
        <p>
          Questions about these Terms can be sent to{' '}
          <a href="mailto:legal@jointempa.com" className={quietLinkClass}>
            legal@jointempa.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
