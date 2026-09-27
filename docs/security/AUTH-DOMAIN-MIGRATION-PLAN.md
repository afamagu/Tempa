# auth.jointempa.com — migration plan (second mandatory stop)

Status: **plan only.** Nothing below has been executed. No DNS, Supabase, Google or Vercel setting
has been changed. Activation waits for "APPROVE AUTH DOMAIN ACTIVATION".

Items marked **owner** live in a dashboard this assessment cannot (and must not) read. They need
a read-only look before activation.

## 1. Current Supabase hostname
`gmggfxynconujrzlbtio.supabase.co` (project ref `gmggfxynconujrzlbtio`), reached through
`NEXT_PUBLIC_SUPABASE_URL`.

## 2. Repo dependencies on it
Everything goes through `NEXT_PUBLIC_SUPABASE_URL`; the hostname is not hard-coded in app code.

| Where | Dependency | Effect of switching the variable |
|---|---|---|
| `lib/supabase/{client,server,service}.ts`, `proxy.ts` | client base URL | Calls go to the new host. |
| `@supabase/supabase-js` default storage key | `sb-${hostname.split('.')[0]}-auth-token`: **`sb-gmggfxynconujrzlbtio-auth-token` → `sb-auth-auth-token`** | **Every member is signed out, and in-flight PKCE and magic-link flows fail**, unless the cookie name is pinned (step 0). |
| `app/auth/confirm/page.tsx` → `validateConfirmationUrl` | accepts only `…/auth/v1/verify` on the origin of `NEXT_PUBLIC_SUPABASE_URL` | Links issued on the other host are refused while both hosts are live (step 0). |
| `proxy.ts` → `lib/security/csp.ts` | only this origin is in `connect-src`/`img-src`/`media-src` | Artwork on the old host would report as violations (Report-Only), and would be blocked once enforced (step 0). |
| `lib/postcard-images.ts`, `lib/profile-marks.ts` | `getPublicUrl()` | Mark URLs are computed at render, so they follow the variable. Postcard artwork URLs are **stored** (see 3). |

## 3. Absolute stored URLs (F-18)
- Admin-uploaded Postcard artwork, both image and motion, is stored as a full
  `https://gmggfxynconujrzlbtio.supabase.co/storage/v1/object/public/…` URL. These come from `lib/postcard-images.ts` and are used by admin → Postcards and admin → Commerce catalogue.
- Member photos (letters, Dispatches) are stored as bucket-relative paths, so they are unaffected.
- Supabase keeps the original `*.supabase.co` host serving after a custom domain is activated, so the stored URLs keep working and **no data rewrite is needed**. The CSP must simply allow both hosts.

## 4. Current Google callback
`https://gmggfxynconujrzlbtio.supabase.co/auth/v1/callback` is Supabase's standard callback for this project. **Owner:** confirm it appears in Google Cloud → Credentials → OAuth client → Authorised redirect URIs.

## 5. New callback
`https://auth.jointempa.com/auth/v1/callback`. **Add** it alongside the old one; do not replace the old one. Keeping both is what makes rollback work.

## 6. Google branding status — **owner**
Check Google Auth Platform → Branding / Audience:
- publishing status;
- verification status;
- app name;
- logo;
- authorised domains (should include `jointempa.com`).

The custom domain replaces the `…supabase.co` hostname the Google chooser shows (F-10). The chooser shows the app name only once branding is verified.

## 7. Site URL — **owner**
Expected: `https://jointempa.com`. Read it from Supabase → Authentication → URL Configuration.

## 8. Redirect allowlist — **owner**
- The app sends `emailRedirectTo` / `redirectTo` = `${window.location.origin}/auth/callback?next=…`.
- The allowlist must therefore contain at least `https://jointempa.com/auth/callback**`.
- Add any preview or `localhost` entries you deliberately use; remove any you don't.
- No change is needed for the custom domain: these are *app* URLs, not auth-host URLs.

## 9. Required CNAME
`auth.jointempa.com  CNAME  gmggfxynconujrzlbtio.supabase.co`

If jointempa.com's DNS is on Cloudflare, set this record to **DNS only** (not proxied).

## 10. Exact TXT value — **not yet available**
- Supabase generates the TXT record(s) only when the hostname is registered, via `supabase domains create --project-ref gmggfxynconujrzlbtio --custom-hostname auth.jointempa.com` or Dashboard → Settings → Custom Domains.
- The record is typically `_cf-custom-hostname.auth.jointempa.com` plus an ACME validation record.
- Registering the hostname does not route traffic. It is still a production configuration change, so it has not been done.
- After you (or I, with approval) register it, paste the exact record(s) here.

## 11. Add-on eligibility — **owner**
- Custom Domains is a paid add-on and needs a paid organisation plan.
- Confirm the plan and the add-on price under Dashboard → Settings → Add-ons.
- Vanity subdomains are a different feature and do not change the auth host shown to Google.

## 12. Session effects
- **With step 0 (pinned cookie name):** no forced sign-out.
  - Access and refresh tokens are issued by the same project and are valid through either host.
  - PKCE verifiers keep the same cookie key.
- **Without step 0:** every member is signed out at deploy, and any sign-in in progress at that moment fails.
- **Magic links already in inboxes:**
  - Links issued before activation point at the old host.
  - With step 0 they still work, because `/auth/confirm` accepts both hosts.
  - They expire under the normal OTP expiry.
- **Google sign-ins in progress at the moment of activation** may fail once. The member simply retries.

## 13. Environment-variable recommendation
| Variable | Value | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://auth.jointempa.com`, set **after** activation | Production (Preview optional) |
| `NEXT_PUBLIC_SUPABASE_PROJECT_URL` *(new)* | `https://gmggfxynconujrzlbtio.supabase.co` | All environments, set **before** step 0 deploys |

The new variable carries the stable project origin. It pins the cookie name (`sb-<ref>-auth-token`), is the second allowed origin in the CSP and in `validateConfirmationUrl`, and means rollback is a single variable flip. `NEXT_PUBLIC_*` values are inlined at build time, so every change needs a redeploy.

## 14. Migration steps
0. **Code PR (no production effect on its own).**
   - Pin `cookieOptions.name` to `sb-<ref>-auth-token`, derived from `NEXT_PUBLIC_SUPABASE_PROJECT_URL`, in all three SSR clients and in `proxy.ts`.
   - Accept both origins in the CSP and in `validateConfirmationUrl`.
   - Add tests for all of the above.
   - Deploy and verify that sessions survive the deploy.
1. **Owner:** confirm items 6, 7, 8 and 11.
2. Register `auth.jointempa.com` in Supabase and record the TXT record(s) in item 10.
3. DNS: add the CNAME (9) and the TXT record(s) (10).
4. Wait for Supabase to report the domain verified and the certificate issued (`supabase domains reverify`).
5. Google: **add** the redirect URI `https://auth.jointempa.com/auth/v1/callback` and keep the old one.
6. **Activate** the custom domain in Supabase. ← gated by "APPROVE AUTH DOMAIN ACTIVATION"
7. Vercel Production: set `NEXT_PUBLIC_SUPABASE_URL=https://auth.jointempa.com`, then redeploy.
8. Run the smoke tests (16).
9. Watch `[auth/callback]` errors and `/api/csp-report` for 48 hours. Keep the old Google URI indefinitely.

## 15. Rollback
- **Fast rollback (minutes):**
  - Set `NEXT_PUBLIC_SUPABASE_URL` back to `https://gmggfxynconujrzlbtio.supabase.co` and redeploy.
  - Sessions survive because the cookie name is pinned.
  - Both Google URIs remain registered.
  - The old host keeps serving throughout.
- **Full rollback:**
  - Deactivate or delete the custom domain in Supabase.
  - Remove the CNAME and TXT records.
  - Stored URLs are unaffected in both directions.
- **Rollback of step 0 alone:** revert the PR. This is harmless only while `NEXT_PUBLIC_SUPABASE_URL` is still the old host.

## 16. Smoke-test plan (production, the owner's own accounts only)
1. Signed in before the deploy → still signed in after it (reload `/home`, open a letter).
2. Google sign-in in a fresh browser.
   - The chooser shows `auth.jointempa.com`, or the app name if branding is verified.
   - The callback lands on `/home` or on the `next` path.
3. Magic link: request one, open it, and confirm `/auth/confirm` works. Also open a link issued *before* step 7.
4. Sign out → `/sign-in?signed_out=1`, and drafts are cleared.
5. Postcard artwork (old stored host) and a new admin upload (new host) both render. The Mark renders.
6. Realtime arrival updates still arrive.
7. The response `Content-Security-Policy-Report-Only` header lists both hosts, and `/api/csp-report` stays quiet.
8. The safety evaluate / send flow works (letter + Dispatch).
9. The admin gate works (staff account).
10. Check on a mobile browser as well.
