# auth.jointempa.com — migration plan (second mandatory stop, revision 2)

Status: **plan only.** Nothing below has been executed. No DNS, Supabase, Google or Vercel setting
has been changed, nothing has been deployed, and there is no PR. Activation waits for
"APPROVE AUTH DOMAIN ACTIVATION".

**Owner** marks a value that lives in a dashboard this assessment does not read.

## Scope

**Phase 1 (this plan) is the trust fix only.** It activates `auth.jointempa.com` so Google's sign-in
flow names Tempa's own domain instead of `gmggfxynconujrzlbtio.supabase.co`.

Per Supabase's custom-domain documentation, after activation:
- the original `gmggfxynconujrzlbtio.supabase.co` host keeps working;
- clients do not need to change their URL;
- Supabase Auth immediately uses and advertises the custom domain for OAuth callbacks.

**`NEXT_PUBLIC_SUPABASE_URL` stays `https://gmggfxynconujrzlbtio.supabase.co` throughout Phase 1.**
Moving the app's general client URL is a separate, later decision (Phase 2, see the appendix).

## Reassessment: what activation changes for Tempa while the client URL is unchanged

| Area | Depends on | Phase 1 effect | Action |
|---|---|---|---|
| Session cookie name (`sb-<first label of NEXT_PUBLIC_SUPABASE_URL host>-auth-token`) | client URL | **None.** It stays `sb-gmggfxynconujrzlbtio-auth-token`. | **Cookie-name pinning is not needed in Phase 1** and is withdrawn from this phase. |
| Existing sessions and refresh | client URL, same project | None. Refresh still goes to the old host, which remains operational. | Smoke test only |
| JWT `iss` claim | Auth external URL | New tokens may carry the custom-domain issuer. No Tempa code checks `iss` (repo-wide search: no `getClaims`, `jwtVerify` or issuer checks). | Smoke test only |
| Google OAuth | Auth external URL | `redirect_uri` becomes `https://auth.jointempa.com/auth/v1/callback`. **Google must already allow it** or sign-in fails with `redirect_uri_mismatch`. | Step 6 before step 8 |
| Code exchange (`/auth/callback`) | client URL + PKCE cookie on jointempa.com | None. The exchange goes to the old host; flow state lives in the project database, not on a hostname. | Smoke test only |
| **Magic links (`/auth/confirm`)** | `validateConfirmationUrl` accepts **only** the origin of `NEXT_PUBLIC_SUPABASE_URL` | **Breaks** if the emailed ConfirmationURL moves to the custom host. See "Required precondition" below. | **Precondition code change P-1** |
| CSP (`proxy.ts`) | client URL | None. The browser never fetches from the custom host. OAuth is top-level navigation (not governed by `connect-src`/`form-action`), and the magic-link form posts to Tempa itself. | None in Phase 1 |
| Stored artwork URLs (F-18) | old host | None. The old host keeps serving. | None |
| Site URL / redirect allowlist | app URLs, not the auth host | None. | Verify only (step 7) |

### Required precondition P-1: magic-link origin check (demonstrated)

**How the flow works:**
- The magic-link email points to `https://jointempa.com/auth/confirm?confirmation_url={{ .ConfirmationURL }}`.
- `app/auth/confirm/page.tsx` accepts the link only if `validateConfirmationUrl(url, NEXT_PUBLIC_SUPABASE_URL)` passes.
- That check requires the link's origin to equal the client URL's origin exactly.

**Why activation is expected to break it:**
- Supabase builds `{{ .ConfirmationURL }}` from the Auth external URL.
- That is the same value that makes OAuth callbacks use the custom domain on activation.
- So once `auth.jointempa.com` is active, emailed links are expected to read `https://auth.jointempa.com/auth/v1/verify?...`.

**Demonstrated on the current code, with the client URL unchanged:**
- A link on `gmggfxynconujrzlbtio.supabase.co` is **accepted**.
- The same link on `auth.jointempa.com` is **rejected**. The member sees "This sign-in link isn't valid", so magic-link sign-in fails for everyone.
- Token parsing (`extractMagicLinkVerificationParams`) is host-independent.
- The token is verified server-side by `verifyOtp` through the unchanged client URL.
- **The origin check is therefore the only thing that breaks.**

**P-1 (smallest fix):**
- `validateConfirmationUrl` accepts `/auth/v1/verify` on an explicit two-origin allowlist:
  - the origin of `NEXT_PUBLIC_SUPABASE_URL`;
  - the constant `https://auth.jointempa.com`.
- No environment variable is involved, and every other check (https, exact path) is unchanged.
- Add regression tests: both origins accepted; lookalikes, other hosts and other paths still rejected.

**Safety of P-1:**
- It is harmless to deploy before activation, because it only widens acceptance to a domain Tempa owns that maps to the same project.
- A token from any other project fails `verifyOtp`.

**Sequencing:**
- P-1 must be **deployed before step 8**.
- It needs your approval to open a PR and deploy. It has **not** been implemented yet.

**Alternative without code:** if you prefer, test magic links right after activation and roll back if they fail. That leaves a live outage window, so P-1 is recommended.

## Items 1–16 (Phase 1)

1. **Current Supabase hostname:** `gmggfxynconujrzlbtio.supabase.co`.
2. **Repo dependencies on it:**
   - All code reaches it through `NEXT_PUBLIC_SUPABASE_URL`:
     - the clients in `lib/supabase/{client,server,service}.ts`;
     - `proxy.ts` (auth gate and CSP);
     - `validateConfirmationUrl`;
     - the cookie name, derived by the library.
   - None of these changes in Phase 1 except the magic-link check (P-1).
3. **Absolute stored URLs:**
   - Admin-uploaded Postcard artwork (image and motion) is stored as full `…supabase.co/storage/v1/object/public/…` URLs.
   - It keeps working after activation, so no rewrite is needed.
   - Member photos are stored as relative paths, and Mark URLs are computed at render time.
4. **Current Google callback:** `https://gmggfxynconujrzlbtio.supabase.co/auth/v1/callback`. **Owner:** confirm it is listed on the OAuth client.
5. **New callback:** `https://auth.jointempa.com/auth/v1/callback`. **Add it; keep the existing one.**
6. **Google branding status (owner):**
   - Check Google Auth Platform → Branding / Audience: app name, logo, publishing status, verification status, and authorised domains.
   - `jointempa.com` must be an authorised domain for the new redirect URI.
   - Expectation for the chooser:
     - Activation alone makes the chooser name `auth.jointempa.com` instead of the supabase.co host.
     - Showing the **Tempa** app name there depends on Google's branding verification, which is not something Supabase controls.
7. **Site URL (owner):** expected `https://jointempa.com`. No change.
8. **Redirect allowlist (owner):**
   - It must include `https://jointempa.com/auth/callback**`, because the app sends `${origin}/auth/callback?next=…`.
   - No change is needed for the custom domain.
9. **Required CNAME:** `auth.jointempa.com CNAME gmggfxynconujrzlbtio.supabase.co`, set to DNS only (not proxied) if the zone is on Cloudflare.
10. **Exact TXT value:**
    - It is issued by Supabase at registration (step 3), and is not available until then.
    - Record the exact name and value here once registered.
11. **Add-on eligibility (owner):** Custom Domains is a paid add-on on a paid plan. Confirm under Dashboard → Settings → Add-ons.
12. **Session effects:**
    - **None expected.** The cookie name, refresh host and code-exchange host are all unchanged.
    - A Google sign-in that is mid-flight at the moment of activation may fail once, and the member simply retries.
    - Magic links already in inboxes (old host) keep working with or without P-1.
    - Links sent after activation need P-1.
13. **Env-var recommendation:**
    - **No environment-variable change in Phase 1.**
    - `NEXT_PUBLIC_SUPABASE_URL` stays on the project host.
    - The `NEXT_PUBLIC_SUPABASE_PROJECT_URL` variable proposed in revision 1 is withdrawn.
14. **Migration steps (your sequence, with P-1 inserted):**
    0. *(Approval: PR + deploy.)* Ship P-1 with its tests and verify that the production magic link still works on the old host.
    1. Leave `NEXT_PUBLIC_SUPABASE_URL` unchanged.
    2. **Owner:** confirm add-on eligibility (11).
    3. Register `auth.jointempa.com`, **without activating it** (`supabase domains create --project-ref gmggfxynconujrzlbtio --custom-hostname auth.jointempa.com`, or Dashboard → Custom Domains).
    4. Record the exact TXT value(s) (10).
    5. Add the CNAME (9) and TXT; wait for Supabase to report the domain verified and the certificate issued (`supabase domains reverify`).
    6. Google: **add** `https://auth.jointempa.com/auth/v1/callback` and keep the existing callback. Confirm `jointempa.com` is an authorised domain.
    7. **Owner:** verify the Site URL (7) and redirect allowlist (8).
    8. **Activate** `auth.jointempa.com`. ← "APPROVE AUTH DOMAIN ACTIVATION"
    9. Run the smoke tests (16) within minutes of activation.
    10. Confirm the chooser change (16.2).
15. **Rollback:**
    - Deactivate or delete the custom domain in Supabase. Auth then advertises the project host again, and Google still has the original callback.
    - Keep the DNS records until outstanding custom-host magic links have expired (OTP expiry), then remove them.
    - P-1 can stay: it is harmless without the custom domain. The app itself needs no rollback, because nothing in its configuration changed.
16. **Smoke tests** (production, owner's own accounts, fresh private window unless noted):
    1. **Existing session:** a browser signed in before activation stays signed in; reload `/home` and open a letter.
    2. **Google sign-in:**
       - the chooser no longer shows `gmggfxynconujrzlbtio.supabase.co`, and shows `auth.jointempa.com` (or "Tempa" if branding is verified);
       - the network log shows `redirect_uri=https://auth.jointempa.com/auth/v1/callback`;
       - the flow lands on `/home` or on `next`.
    3. **Magic link after activation:**
       - the email link's `confirmation_url` host is `auth.jointempa.com`;
       - `/auth/confirm` shows "Your sign-in is ready", and signing in succeeds.
    4. **Magic link sent before activation** (old host): still signs in.
    5. **Logout → login:** `/sign-in?signed_out=1` clears drafts; sign back in with Google, then with a magic link.
    6. **Token refresh:** a session left idle past access-token expiry (about 1 hour) still works.
    7. **App behaviour:** Realtime arrivals, letter send with safety evaluation, and the admin gate (staff account) all work, and `/api/csp-report` stays quiet.
    8. **Mobile browser:** repeat 2 and 3.
    9. **Rollback rehearsal (optional, with your approval):** deactivate, confirm Google works again on the original callback, then reactivate.

## Appendix: Phase 2 (separate later decision, not approved or planned for now)

Switching `NEXT_PUBLIC_SUPABASE_URL` to `https://auth.jointempa.com` would change:
- the library-derived cookie name to `sb-auth-auth-token`, which would **sign everyone out** unless the name is pinned first;
- the CSP origins;
- the origin used by the confirm-URL check (already covered by P-1).

That phase would reintroduce cookie-name pinning, and it is evaluated on its own merits later. It is not needed for the trust fix.
