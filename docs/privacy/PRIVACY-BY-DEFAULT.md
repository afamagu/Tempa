# Privacy-by-default — initial implementation

This change adds a deny-by-default gate for **future optional tracking**. It does
not install analytics, advertising pixels, consent banners or third-party SDKs.

## Existing essential processing
- Supabase authentication cookies support sessions; do not block them.
- `tempa_locale` stores interface language.
- Cloudflare Turnstile is loaded by the sign-in widget for bot protection.
- The sign-in page mounts Google Identity Services only after the visitor chooses Continue with Google. The visitor then uses the Google-rendered control to authenticate. Verify provider-side cookies, storage and processing separately.
- Payments, correspondence and security must continue functioning.

## Integration rule
No optional analytics, advertising, attribution or tracking code may be added
without first implementing a consent preference UI (accept, reject, revisit,
withdraw), durable consent handling and tests. Call
`runOptionalTracking(consent, start)` **before** creating a script, issuing
network requests or storing identifiers. The default state is `unknown`, which
denies optional tracking. On withdrawal, disable the integration and remove
its nonessential identifiers where technically possible. The gate alone does
not stop an already-running SDK: integration-specific shutdown is required.

## Release gates (not yet verified)
- Inventory every third-party request, cookie, local/session storage key and
  server-side event in the full codebase and production configuration.
- Test anonymous and signed-in journeys on desktop, Android and iOS with
  clean profiles; inspect requests and storage before/after consent.
- Review Google Identity Services, Turnstile, Supabase, Vercel logs and payment
  providers for purpose, retention, geography and applicable legal basis.
- Review and update the privacy notice based on the verified inventory.
- Do not enable CSP enforcement until existing report-only violations are
  triaged and essential flows pass.
- Obtain qualified legal review for jurisdiction-specific requirements.

**Status:** policy helper and unit tests added; browser/device tests,
deployment verification and legal review are not complete. No compliance
certification is implied.
