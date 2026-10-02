# Account access and release sweep

Reviewed release: PR70 / production merge e67e023be85df29d3a384ce124f877f4baade7e2.

## Urgent account access finding

The application already has soft retirement for voluntary deletion, but legacy
closed Auth identities require a separate remediation. Missing account-state
functions also cause deletion to fall back to an Auth ban. The Google callback
receives only `user_banned`, so changing its message cannot retire that identity.
Production counts and installed functions still need the owner's SQL diagnostic.

The new migration installs the state functions and narrow service-only repair
queue. A permanent admin ban takes precedence; closed accounts without that ban
can create a fresh identity. The admin Account access page and Server Action both
require the admin role before opening a service client. The action reloads the
exact candidate and the existing finalizer checks enforcement again before using
Supabase's supported soft-delete API. Old account ids, closure history and retained
letters are preserved. No active account is a candidate; no email-based public
recovery endpoint or sign-in bypass was added.

SQL installation is not itself the legacy identity repair. After deployment, the
administrator must run each eligible repair in the Account access screen and
verify that the queue empties. A returning member then signs up anew.

## Verification completed

- 223 focused authentication, onboarding and admin-repair tests pass.
- The new SQL migration and verifier pass in local PostgreSQL, including repeat
  installation, permanent-ban precedence, voluntary/restricted/suspended closure
  return, active/retired exclusions, exact candidate ids, changing enforcement,
  service-only permissions and unchanged closure records.
- Changed-file lint, TypeScript and production Next build pass.
- Literal application links were checked against 110 page/handler routes: no
  unmatched literal link destinations. Dynamic ids and live actions are outside
  this static check.
- Live public landing entry reaches `/sign-in?intent=join`, displaying Google
  sign-up and the email magic-link form. No credentials entered or test emails,
  letters or Dispatches sent. A full fresh Google registration and private member
  flows still require an authorized account/session.

## Wider suite findings

The unchanged production source baseline runs 5,898 passing tests and 36 failures
across 16 test files. The same failures were present before the urgent repair.
Examples inspected include retired `/minds` expectations, missing localization
or navigation mocks, old public-web wording, an old public RPC allowlist, and
JSON-LD tests predating the topic archive. These are not proof that every affected
live feature works; each needs a current-behavior assertion or a confirmed code
fix. The Account access tab expectation was updated separately for this release.

No claim is made that the entire site has been tested interactively. Priorities
after the returning-member repair are a fresh signup, the full durable onboarding
sequence, member introductions, Discover/profile/composer/back links, Letterbox
reply and attachment persistence, Board search and Dispatch publication, Room
question responses and admin selection. Production checks must avoid sending
messages or publishing content without explicit test authorization.
