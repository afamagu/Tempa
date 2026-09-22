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
      <LegalSection heading="1. About this notice">
        <p>
          This Privacy Notice explains what information {OPERATOR_NAME} processes in connection with Tempa, why, and
          what choices you have about it. It&rsquo;s a notice, not a contract &mdash; unlike our{' '}
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

      <LegalSection heading="2. Information we process">
        <p>Depending on how you use Tempa, this can include:</p>
        <ul className={legalListClass}>
          <li>
            <strong>Account, email, and session information.</strong> The email address you sign in with, and the
            authentication/session data needed to keep you signed in and to tell your requests apart from anyone
            else&rsquo;s.
          </li>
          <li>
            <strong>Adult eligibility and date of birth.</strong> The date of birth you submit once, to confirm
            you&rsquo;re at least 18. See Section 3 for exactly what we keep, and what we don&rsquo;t.
          </li>
          <li>
            <strong>The derived eligibility date.</strong> If your submitted date of birth doesn&rsquo;t confirm
            you&rsquo;re eligible, we keep a date derived from it rather than the date of birth itself &mdash; also
            covered in Section 3.
          </li>
          <li>
            <strong>Profile information.</strong> Your pseudonym, country (shown publicly), region (collected but not
            shown to other members), and the languages you speak.
          </li>
          <li>
            <strong>Gender, if you choose to share it.</strong> An optional field &mdash; including a free-text
            description if you choose &ldquo;self-describe&rdquo; &mdash; shown on your profile unless you choose
            not to share it.
          </li>
          <li>
            <strong>Why you&rsquo;re here (shown publicly as &ldquo;Interests&rdquo;).</strong> The general reasons
            you&rsquo;re using Tempa (for example, meaningful friendship or cultural exchange), shown on your profile.
            This is a different thing from the next item.
          </li>
          <li>
            <strong>Reading interests (kept private).</strong> Topics you&rsquo;re interested in reading about. This
            is never shown on your profile or to other members &mdash; we use it only to help decide what to surface
            for you on the Board.
          </li>
          <li>
            <strong>Writing and receiving preferences.</strong> Whether you generally write your letters yourself or
            use Tempa&rsquo;s AI-assisted writing tools, and what kind of letters you&rsquo;re comfortable receiving.
          </li>
          <li>
            <strong>Age range.</strong> A broad range, never your exact age or date of birth, calculated automatically
            from your confirmed date of birth once you&rsquo;re eligible and shown on your public profile. You
            can&rsquo;t set this yourself.
          </li>
          <li>
            <strong>Your Question answer.</strong> The written answer you provide to a Question on Tempa, shown on
            your profile.
          </li>
          <li>
            <strong>Your Mark.</strong> The generated visual identity described in Section 8.
          </li>
          <li>
            <strong>Letters.</strong> The private correspondence you exchange with another member, including any
            photos or a Postcard you attach &mdash; see Section 9.
          </li>
          <li>
            <strong>Dispatches and other content you publish to the Board.</strong> Writing (with an optional title,
            photos, and a Postcard) that you choose to publish for other members to read &mdash; see Section 9.
          </li>
          <li>
            <strong>&ldquo;Worth Reading&rdquo; marks.</strong> If you mark a Dispatch as worth reading, that&rsquo;s
            recorded against your account, but it&rsquo;s private: we don&rsquo;t show it to anyone, including the
            Dispatch&rsquo;s author.
          </li>
          <li>
            <strong>Reports, blocks, and other safety/moderation information.</strong> If you report or block another
            member, or someone reports or blocks you, we keep a record of that action (including, for a report, the
            reason given and a copy of the reported content at that time) so it can be reviewed.
          </li>
          <li>
            <strong>Legal acceptance records.</strong> Which version of the Terms of Service and Community Guidelines
            you&rsquo;ve accepted, and when.
          </li>
          <li>
            <strong>Technical and security information.</strong> Information generated by using Tempa that helps us
            keep it running and secure, handled through our infrastructure providers (Section 6).
          </li>
          <li>
            <strong>Cloudflare Turnstile signals.</strong> When you sign in, Cloudflare Turnstile evaluates the
            attempt to help confirm it&rsquo;s a genuine person, not an automated script.
          </li>
        </ul>
        <p>
          We don&rsquo;t process payment information, run advertising or ad-tracking systems, or operate any product
          beyond what&rsquo;s described in this notice.
        </p>
      </LegalSection>

      <LegalSection heading="3. Date of birth, eligibility, and the automated decision behind it">
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
        <p>This decision is a straightforward, rule-based check, not a judgment call or a profile of you:</p>
        <ul className={legalListClass}>
          <li>Our server compares the date of birth you submit against the current date.</li>
          <li>If it confirms you&rsquo;re 18 or older, you can continue.</li>
          <li>
            If it doesn&rsquo;t, you can&rsquo;t continue, and a derived re-screening date is retained as described
            above.
          </li>
          <li>
            This check does not use facial-age estimation, document verification, or any kind of personality or
            behavioral scoring &mdash; it is a date comparison, nothing more.
          </li>
        </ul>
        <p>
          If you believe this decision was made in error, contact{' '}
          <a href="mailto:privacy@jointempa.com" className={quietLinkClass}>
            privacy@jointempa.com
          </a>{' '}
          or{' '}
          <a href="mailto:support@jointempa.com" className={quietLinkClass}>
            support@jointempa.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="4. Why we process this information">
        <ul className={legalListClass}>
          <li>To create and run your profile, and to deliver letters and publish Dispatches.</li>
          <li>To confirm eligibility and keep age information accurate, as described in Section 3.</li>
          <li>To keep Tempa safe &mdash; responding to reports, enforcing our Community Guidelines, and preventing abuse.</li>
          <li>To secure Tempa &mdash; detecting and preventing fraud, automated abuse, and unauthorized access.</li>
          <li>To communicate with you about your account and respond to your questions.</li>
          <li>To meet our legal obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Our basis for processing">
        <p>Where applicable privacy law asks us to identify a basis for processing, we rely on the following, as relevant to the activity:</p>
        <ul className={legalListClass}>
          <li>
            <strong>Performance of a contract.</strong> Confirming your eligibility, running your profile, delivering
            letters, and publishing Dispatches &mdash; the core of what you sign up for.
          </li>
          <li>
            <strong>Legitimate interests.</strong> Security, fraud prevention, keeping the platform reliable, and
            enforcing our Community Guidelines &mdash; balanced against your own privacy interests.
          </li>
          <li>
            <strong>Legal obligation.</strong> Where we&rsquo;re required by law to process or retain information.
          </li>
          <li>
            <strong>Consent.</strong> We don&rsquo;t currently rely on consent as the basis for Tempa&rsquo;s core
            features. If that changes for a specific, optional feature in the future, we&rsquo;ll ask you separately,
            and you&rsquo;ll be able to withdraw that consent at any time.
          </li>
          <li>
            <strong>Vital interests.</strong> In an exceptional circumstance where it&rsquo;s necessary to protect
            someone&rsquo;s life or physical safety.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Who we share information with">
        <ul className={legalListClass}>
          <li>
            <strong>Other Tempa members, according to what you publish and to whom.</strong> A letter goes only to
            its intended recipient. A published Dispatch is visible to other Tempa members, and if you choose to
            generate a share link for it, to anyone who has that link, including people who aren&rsquo;t Tempa
            members.
          </li>
          <li>
            <strong>Supabase.</strong> Supabase provides backend infrastructure &mdash; including our database,
            authentication, and file storage &mdash; used to run Tempa.
          </li>
          <li>
            <strong>Vercel.</strong> Vercel hosts the Tempa web application.
          </li>
          <li>
            <strong>Cloudflare.</strong> Cloudflare Turnstile helps confirm that a sign-in attempt is genuine, not
            automated.
          </li>
          <li>
            <strong>Professional advisers and authorities, only where appropriate.</strong> For example, legal
            advisers, or a law enforcement or regulatory request we&rsquo;re required to honor.
          </li>
        </ul>
        <p>We don&rsquo;t sell your information.</p>
      </LegalSection>

      <LegalSection heading="7. International processing">
        <p>
          Our infrastructure providers may process information in countries other than the one you live in. We take
          reasonable steps appropriate to the circumstances to protect information wherever it&rsquo;s processed. We
          haven&rsquo;t independently verified, and don&rsquo;t state here, a specific physical region for any
          provider&rsquo;s infrastructure.
        </p>
      </LegalSection>

      <LegalSection heading="8. Your Mark">
        <p>
          Your Mark is a unique visual identity Tempa generates from a photograph you choose. That processing happens
          locally on your own device &mdash; the source photograph itself is not uploaded to Tempa. Only the
          generated Mark image is uploaded, and it is stored and shown as part of your member-visible profile.
        </p>
      </LegalSection>

      <LegalSection heading="9. Letters, Dispatches, and other content">
        <p>
          There&rsquo;s a real distinction on Tempa between what&rsquo;s member-visible and what&rsquo;s private.
          Letters are private correspondence between you and one other member &mdash; including any photos or a
          Postcard you attach to one &mdash; and we don&rsquo;t make them visible to other members. A Dispatch you
          publish to the Board is visible to other Tempa members, and to anyone you share a link with, as described
          in Section 6. Marking a Dispatch &ldquo;worth reading&rdquo; is private to you alone.
        </p>
        <p>
          We don&rsquo;t make a practice of reading members&rsquo; private letters. Private correspondence on Tempa is
          not end-to-end encrypted, so specific content can be accessed where it&rsquo;s genuinely needed &mdash; for
          example, to investigate a report, respond to a safety concern, provide support you&rsquo;ve asked for,
          protect the security of the platform, or comply with a legal requirement.
        </p>
      </LegalSection>

      <LegalSection heading="10. How long we keep information">
        <p>We don&rsquo;t apply one retention period to everything; the length depends on the category and why we hold it:</p>
        <ul className={legalListClass}>
          <li>
            <strong>Account and profile information</strong> &mdash; for as long as your account is active, plus a
            reasonable period afterward in case you reactivate it or we&rsquo;re required to keep it.
          </li>
          <li>
            <strong>Date of birth and eligibility status</strong> &mdash; for as long as your account remains active
            and eligible, as described in Section 3.
          </li>
          <li>
            <strong>The derived eligibility date</strong> &mdash; only for as long as needed for re-screening
            purposes.
          </li>
          <li>
            <strong>Legal acceptance records</strong> &mdash; kept to demonstrate what you agreed to and when, for as
            long as reasonably needed for that accountability purpose, which can outlast other account data.
          </li>
          <li>
            <strong>Letters, Dispatches, and other content</strong> &mdash; for as long as your account is active, or
            as long as needed to preserve a correspondence partner&rsquo;s own copy of a letter you sent them.
          </li>
          <li>
            <strong>Reports, blocks, and enforcement records</strong> &mdash; kept longer than ordinary content where
            needed for safety, accountability, and legal purposes.
          </li>
          <li>
            <strong>Technical and security logs</strong> &mdash; kept for a limited period appropriate to security
            purposes, then routinely cleared.
          </li>
          <li>
            <strong>Backups</strong> &mdash; deleted information may persist in routine backups for a limited
            additional period before it&rsquo;s fully purged.
          </li>
        </ul>
        <p>We haven&rsquo;t set, and don&rsquo;t state here, an exact number of days or years for any of the above.</p>
      </LegalSection>

      <LegalSection heading="11. Your privacy rights">
        <p>Depending on where you live, applicable law may give you rights to:</p>
        <ul className={legalListClass}>
          <li>be told what information we hold about you and access it;</li>
          <li>have inaccurate information corrected;</li>
          <li>ask us to delete information;</li>
          <li>ask us to restrict certain processing;</li>
          <li>object to certain processing;</li>
          <li>receive a copy of your information in a portable format;</li>
          <li>withdraw consent, where consent is the basis we&rsquo;re relying on;</li>
          <li>
            ask about, and request human review of, a qualifying automated decision &mdash; including the eligibility
            check in Section 3;
          </li>
          <li>complain to the data protection authority that has jurisdiction over you, if one does.</li>
        </ul>
        <p>
          To exercise any of these, contact{' '}
          <a href="mailto:privacy@jointempa.com" className={quietLinkClass}>
            privacy@jointempa.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="12. Cookies and similar technology">
        <p>
          Tempa uses the session technology necessary to keep you signed in and to keep the platform secure, and
          Cloudflare Turnstile at sign-in as described in Section 6. We don&rsquo;t run analytics trackers or
          advertising technology.
        </p>
      </LegalSection>

      <LegalSection heading="13. Security">
        <p>
          We rely on our infrastructure providers&rsquo; security practices and take reasonable measures of our own to
          protect member information. No online service can guarantee perfect security.
        </p>
      </LegalSection>

      <LegalSection heading="14. Children">
        <p>
          Tempa is not for anyone under 18. If we learn an account belongs to someone under 18, we handle it as
          described in Section 3 and our{' '}
          <Link href="/terms" className={quietLinkClass}>
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="15. Changes to this notice">
        <p>We may update this Privacy Notice from time to time. We&rsquo;ll update the effective date above when we do.</p>
      </LegalSection>

      <LegalSection heading="16. Contact">
        <p>
          Questions about this notice, or a request concerning your information, can be sent to{' '}
          <a href="mailto:privacy@jointempa.com" className={quietLinkClass}>
            privacy@jointempa.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
