# Tempa installed-web-app acceptance gate — iOS first

Status: **manual device verification pending**. This checklist is a release gate, not a claim that physical-device tests have passed.

## Scope and guardrails
- Do not change production authentication, navigation, draft storage, letter sending, service workers, or caching in this phase.
- Keep Safari browser and iOS Home Screen app sessions **independent**; never copy tokens or drafts between storage containers.
- Test Android Chrome install flow as a regression, without changing its working manifest.
- Use two test accounts, disposable correspondence and non-sensitive content.

## iPhone Safari → installed web app
1. Open the canonical production origin in Safari. Verify Apple icon, name and Add to Home Screen; launch the installed app and confirm no Safari chrome.
2. Verify safe-area padding in portrait/landscape, dynamic type, status bar, bottom controls and scroll restoration.
3. Confirm Safari authentication does **not** imply the installed app is authenticated. Sign in separately if required.
4. Request a magic link in the installed app, open the link from Mail, and record whether verification completes in Safari rather than the installed app. Do not promise automatic session transfer. Return to installed app and verify whether sign-in remains required.
5. Verify Google sign-in, refresh, cold start, background/foreground, session expiry, sign-out and re-entry.
6. Navigate Home → Board → Letterbox → You → correspondence → Back. Test deep links and back navigation.
7. Write a long first letter and a correspondence reply. Check caret, text selection, bold/italic, emoji, formatting toolbar, keyboard dismissal, orientation change, scrolling, and safe areas.
8. Background app while keyboard is open; relaunch. Check that draft survives. Force-close and reopen. Check draft again.
9. Verify drafts are scoped to the correct recipient and that successful sending clears only the sent draft.
10. Attach photos/postcards where available; verify previews, draft restoration, permissions and sending.
11. Repeat with poor connectivity, interrupted send and an expired magic link. Confirm no duplicate letters or silent draft loss.

## Android regression
- Existing install banner and maskable icon remain unchanged.
- Installed app opens standalone; Home/Board/Letterbox/You, sign-in, keyboard and drafts still work.
- Return Card viewer and selection still behave correctly.

## Release decision
- **Block** install invitation if any iOS authentication or unsent-draft loss issue remains.
- **Block** any caching/service worker change until explicit cache invalidation and offline safety testing.
- No notification permission request on install.
- Add a quiet, opt-in install affordance only after device acceptance. Trigger only on a subsequent Home visit after onboarding, 2 distinct active days and meaningful participation. Suppress during composing, reading, sending or onboarding; 30-day dismissal cooldown; stop after 2 dismissals; never show in standalone mode.
- Capture OS version, browser, test account type, expected/actual, screenshots and reproducible steps for each failure.
