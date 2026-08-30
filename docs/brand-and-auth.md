# Tempa — Brand & Auth Decisions

Locked product/copy decisions. This is a record of what's been agreed, not a
design brief — treat the wording below as final unless explicitly revisited.

## Messaging hierarchy

1. **Login / product invitation**
   `Find someone worth writing to.`
2. **Brand thesis**
   `People are more interesting than profiles.`
3. **Campaign / ads / waitlist**
   `Somewhere in the world, someone thinks the way you do. You just haven't met them yet.`
4. **Secondary brand / onboarding line**
   `Meet the mind before the person.`
   - Not used on the auth screen. Reserved for a later onboarding, Question,
     or brand context — do not discard, and do not repurpose it as auth copy.

## Auth screen copy (locked)

```
Welcome to Tempa
Find someone worth writing to.

Continue with Google
or
Continue with email
```

Rules:
- Do **not** use "Sign up," "Sign in," or "Send magic link" as the primary
  user-facing entry actions on this screen. The user just continues — the
  app determines new vs. returning, not the copy.
- Email must remain a genuine alternative to Google, not a hidden fallback
  (equal visual/copy weight, not buried behind the Google button).
- Sign in with Apple is a **future consideration for the native iOS stage**
  only — not something to build now.

Note: the current implementation at [app/sign-in/page.tsx](../app/sign-in/page.tsx)
predates this decision (heading "Sign in", button "Send magic link") and has
not been updated to match — that's a follow-up code change, not covered by
this doc update.

## Identity rule

Google/email is authentication only. It must never leak into Tempa's public
identity layer:
- Google display name, Google profile photo, and email address must never
  automatically become the user's public Tempa identity.
- None of the above may appear in discovery.
- Tempa's public identity remains **pseudonym-first**, full stop.
