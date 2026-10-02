# Multiple Moments in Dispatch passages

The owner clarified that Dispatch passages must accept multiple photo Moments.
The preceding overlap-placement release preserved a rule the owner does not want.
This release removes that rule for member, Tempa and Sponsored Dispatches.

Every photo remains attached: the reader groups attachments rather than reducing
them to one per position, and editing reconstructs every photo node. The composer
allows additions at occupied, current and following paragraphs. Photo-only
paragraphs retain all their attachments when mapped to a written passage.
The previous collision guard and forced-move UI are removed.

The migration drops only the Dispatch unique-gap constraint, adds an identity
attachment order and a nonunique ordered index, and changes only the two installed
anonymous readers' aggregate sort clauses. The migration rejects an unexpected
reader definition and rolls back. It preserves function ACLs, privacy gates,
publication checks, storage ownership, row security and valid-position checks.
Private-letter schemas and their attachment controls are unchanged.

Validation: 398 focused tests pass, including real editor attachment controls,
multi-photo rendering, edit/serialize round trips and 100 same-passage photos.
TypeScript and production build pass. Changed-file lint has no errors; the
composer retains one existing unused-disable warning. Local PostgreSQL/PGlite
tests verify repeatable migration, ordered retention of every photo (including a
repeated path), unchanged reader definitions apart from sorting, preserved ACLs,
anonymous/member direct-write denial and untouched letter constraints.

Production SQL has not been executed by the assistant. Run the migration and
verification before merging the dependent application release. Expected result:
`MULTIPLE_DISPATCH_MOMENTS_READY` with every check true.

After deployment, verify a member and an admin Dispatch with multiple photos in
one passage through preview, publish, refreshed reading, editing and public/shared
reading. No live Dispatch was published as a test by the assistant.
