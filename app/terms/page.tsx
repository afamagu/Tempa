import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPageShell, LegalSection, legalListClass } from '@/app/legal-shell'
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
          profile. Attempting to falsify your date of birth, or otherwise trying to get around this check, is a
          violation of these Terms. Our{' '}
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
        <ul className={legalListClass}>
          <li>
            You&rsquo;re responsible for the information in your profile and for anything that happens through your
            account. Keep your sign-in access to yourself, and let us know at{' '}
            <a href="mailto:support@jointempa.com" className={quietLinkClass}>
              support@jointempa.com
            </a>{' '}
            if you believe someone else has access to your account.
          </li>
          <li>Don&rsquo;t try to get around our adult-eligibility check, by any means.</li>
          <li>Don&rsquo;t try to get around a block another member has placed, including by creating another account to do so.</li>
          <li>
            Don&rsquo;t give us materially false information relevant to eligibility or safety &mdash; for example,
            your date of birth, or information you provide as part of a report.
          </li>
          <li>
            Choose a pseudonym that doesn&rsquo;t impersonate another real person, brand, or organization, and follow
            any naming requirements we apply when you create it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Your Mark">
        <p>
          As part of setting up your profile, Tempa generates a unique visual identity for you &mdash; your
          &ldquo;Mark&rdquo; &mdash; from a photograph you choose. That source photograph is processed on your own
          device; it is not uploaded to Tempa. Only the resulting Mark image is uploaded, and it is stored and shown
          as part of your member-visible profile, the same as the rest of your profile content.
        </p>
      </LegalSection>

      <LegalSection heading="6. Member-visible content and private correspondence">
        <p>
          Tempa distinguishes between two kinds of content. Your profile &mdash; including your Mark, your Question
          answer, and a Dispatch you publish to the Board &mdash; is member-visible, and if you generate a share link
          for a Dispatch, visible to anyone who holds that link. Marking a Dispatch &ldquo;worth reading&rdquo; is
          private to you. Letters you exchange with another member are private correspondence between the two of
          you, and we don&rsquo;t make them visible to other members.
        </p>
        <p>
          Private correspondence on Tempa is not end-to-end encrypted. We don&rsquo;t make a practice of reading
          members&rsquo; private letters; we may access specific content when it&rsquo;s reported to us, when
          necessary to investigate a safety concern, to provide support you&rsquo;ve requested, to protect the
          security of Tempa, or when required by law.
        </p>
      </LegalSection>

      <LegalSection heading="7. Permission you give us to use your content">
        <p>
          You retain ownership of what you write and share on Tempa. By posting or sending content through Tempa
          &mdash; your profile, your Mark, a Dispatch, or a letter &mdash; you grant {OPERATOR_NAME} a worldwide,
          non-exclusive, royalty-free licence to host, store, transmit, format, and display that content, and to
          sublicense it to the service providers who help us run Tempa, solely as reasonably necessary to operate
          Tempa, provide your content to the audience you chose for it (for example, a letter&rsquo;s recipient, or
          other members for a published Dispatch), secure and moderate the platform, and maintain backups.
        </p>
        <p>
          This licence does not transfer ownership of your content to us, and it does not let us publish your private
          letters as advertising or public content just because they were sent through Tempa. It continues only as
          long as reasonably necessary for the purposes above &mdash; including, where relevant, a brief period to
          honor a deletion request, let a letter&rsquo;s recipient keep their own copy, maintain routine backups, or
          meet our security and legal obligations.
        </p>
      </LegalSection>

      <LegalSection heading="8. Other members&rsquo; content, and Tempa&rsquo;s own">
        <p>
          Respect what other members share with you. Don&rsquo;t copy, republish, or redistribute another
          member&rsquo;s letter, Dispatch, or other content without their permission. Tempa&rsquo;s own branding,
          software, and design are the intellectual property of {OPERATOR_NAME} or our licensors, and these Terms
          don&rsquo;t grant you any rights to them beyond what&rsquo;s needed to use Tempa as intended.
        </p>
      </LegalSection>

      <LegalSection heading="9. Community Guidelines, reporting, blocking, and prohibited use">
        <p>
          Using Tempa means following our{' '}
          <Link href="/community-guidelines" className={quietLinkClass}>
            Community Guidelines
          </Link>
          . Tempa supports reporting and blocking, so you can flag content or behavior that concerns you and control
          who can reach you.
        </p>
        <p>You also agree not to:</p>
        <ul className={legalListClass}>
          <li>scrape, crawl, or systematically extract data from Tempa;</li>
          <li>use bots, scripts, or other automated means to access or interact with Tempa, outside of anything we officially provide for that purpose;</li>
          <li>attempt to interfere with, disrupt, or gain unauthorized access to Tempa&rsquo;s systems or other members&rsquo; accounts;</li>
          <li>introduce malware, or otherwise try to compromise the security or integrity of the service.</li>
        </ul>
        <p>
          We may review, restrict, or remove content, and warn, restrict, or terminate accounts, when we determine
          the Guidelines, this section, or these Terms have been violated.
        </p>
      </LegalSection>

      <LegalSection heading="10. Third-party services and links">
        <p>
          Tempa is built using third-party infrastructure providers (see our{' '}
          <Link href="/privacy" className={quietLinkClass}>
            Privacy Notice
          </Link>
          ). Content on Tempa, including letters and Dispatches, may contain links or references supplied by other
          members. We don&rsquo;t vet or endorse third-party links or content, and we&rsquo;re not responsible for
          them.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to the service">
        <p>
          We&rsquo;re continuing to build Tempa, and we may add, change, or remove features, or suspend the service
          temporarily for maintenance or other reasons. We don&rsquo;t promise that any particular feature will
          remain available indefinitely.
        </p>
      </LegalSection>

      <LegalSection heading="12. AI-assisted writing">
        <p>
          Tempa lets you indicate how you generally write your letters, including with the help of AI-assisted
          writing tools, and what kind of letters you&rsquo;re comfortable receiving. Whatever tools you use to write
          it, you&rsquo;re responsible for the content of what you send or publish, and it&rsquo;s still subject to
          these Terms and our Community Guidelines. A declared receiving preference reflects what another member has
          said they&rsquo;re comfortable with; it isn&rsquo;t a guarantee about the content you&rsquo;ll receive.
        </p>
      </LegalSection>

      <LegalSection heading="13. Suspension and termination">
        <p>
          You may stop using Tempa, and request closure of your account, at any time by contacting{' '}
          <a href="mailto:support@jointempa.com" className={quietLinkClass}>
            support@jointempa.com
          </a>
          . We may suspend or terminate an account that violates these Terms or the Community Guidelines, or where
          we&rsquo;re required to do so by law.
        </p>
        <p>
          Sections of these Terms that by their nature should survive &mdash; including ownership, the licence
          already granted for content already used as described in Section 7, disclaimers, limitation of liability,
          indemnity, and governing law &mdash; continue to apply after your account is suspended, terminated, or
          closed.
        </p>
      </LegalSection>

      <LegalSection heading="14. Disclaimers">
        <p>
          Tempa is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We work to keep the
          service running well and to keep members safe, but we don&rsquo;t promise that Tempa will always be
          uninterrupted, error-free, or free of content you find objectionable, and we don&rsquo;t vouch for the
          conduct of any member. Nothing in this section limits any right you have under applicable law that
          can&rsquo;t lawfully be excluded, including statutory consumer-protection rights.
        </p>
      </LegalSection>

      <LegalSection heading="15. Limitation of liability">
        <p>
          Nothing in these Terms excludes or limits liability that applicable law does not permit us to exclude or
          limit &mdash; including, where applicable, liability for fraud, wilful misconduct, gross negligence, or
          death or personal injury caused by our negligence. Those categories aren&rsquo;t excluded by this section,
          and if applicable law treats any other category of liability as non-excludable, this section doesn&rsquo;t
          exclude that either.
        </p>
        <p>
          Subject to that, and to the fullest extent applicable law does permit: {OPERATOR_NAME} is not liable for
          indirect, incidental, special, or consequential damages arising from your use of Tempa; and our total
          liability for any claim relating to Tempa will not exceed the greater of (a) the amount you have paid us in
          the twelve months before the claim arose, or (b) US$100 (or the reasonably equivalent amount in your local
          currency).
        </p>
      </LegalSection>

      <LegalSection heading="16. Indemnity">
        <p>
          You agree to indemnify {OPERATOR_NAME} against reasonable claims, losses, and expenses arising from:
          content you post or send that is unlawful or infringes someone else&rsquo;s rights; your fraud or
          intentional misuse of Tempa; or your material violation of these Terms or the Community Guidelines. This
          doesn&rsquo;t apply to the extent a claim arises from {OPERATOR_NAME}&rsquo;s own unlawful conduct, and
          nothing in this section asks you to indemnify us for anything the law doesn&rsquo;t allow us to pass on to
          you.
        </p>
      </LegalSection>

      <LegalSection heading="17. Intellectual property complaints">
        <p>
          If you believe content on Tempa infringes your intellectual property rights, contact{' '}
          <a href="mailto:legal@jointempa.com" className={quietLinkClass}>
            legal@jointempa.com
          </a>{' '}
          with enough detail for us to locate and evaluate the content.
        </p>
      </LegalSection>

      <LegalSection heading="18. Governing law">
        <p>
          These Terms, and any dispute arising from them or from your use of Tempa, are governed by the laws of
          Nigeria, without prejudice to any mandatory consumer-protection rights you may have under the law of the
          country where you live that cannot lawfully be displaced by this clause.
        </p>
      </LegalSection>

      <LegalSection heading="19. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will carry a new version, and we&rsquo;ll ask
          members to review and accept the updated Terms before continuing to use Tempa.
        </p>
      </LegalSection>

      <LegalSection heading="20. Contact">
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
