# Introduction recycling

People viewed without a sent letter should become eligible again, rather than be permanently removed by Next, profile viewing or opening Write.

## Selection contract

On sign-in: up to seven cards, unseen newcomers first (tier 0), unseen established members next (tier 1), previously encountered people after seven full days (tier 2). Each tier is freshly shuffled at each retrieval; random shuffles can occasionally repeat an order. Shared language/intent labels remain, but no longer dictate ordering. Existing active correspondents, recipients of an actual sent first letter, blocked/hidden/ineligible profiles remain excluded through the existing member-RLS surfaces. A visible representative question answer is still required for this writing-led introduction screen; Discover remains the broader directory.

The twenty-minute away return still uses tier 0 only. Menu navigation and ordinary refresh do not cause another check. Seven cards per check prevents interrupting members with the whole population; unseen people continue on later sign-ins. There is no immediate restart at Done.

## History and compatibility

No table, signature, return shape or client change. Keep historical consumed_at/reason as latest action metadata, not permanent eligibility denial. Both existing mutation RPCs update repeat encounters. The cooldown uses the later of presented_at/action time, including historical dismissals. Merely opening Write is not a sent letter. Retrieval now checks sent first-letter recipient identity instead of the current representative answer identity, so updating an answer cannot cause a contacted person to return. No history reset, new timer, message send or private profile field exposure.

## Release

Run docs/sql/2026-10-01-member-introductions-recycling.sql, then its -verify.sql. Expected INTRODUCTION_RECYCLING_VERIFIED with every flag true. Existing deployed PR61 client works with these replacement RPCs immediately; merging this PR records the reviewed SQL and tests. Do not re-run the older introduction installer afterward, which would restore its old function bodies. Both replacement SQL and verification are complete files, not patches. No Vercel configuration or email switch changes.

## Validation

Isolated PostgreSQL fixtures cover migration twice without history deletion, old consumed eligibility, six/seven/eight-day boundaries, repeat presentation/action cooldown, shuffled retrieval, unseen newcomer/established priority, seven-card clamp, actual sent-letter exclusion despite a different answer, established partners/block/closure exclusion, own history RLS and anonymous RPC denial. Existing card/timing/navigation tests remain applicable because application code is unchanged. Signed-in production acceptance follows owner SQL verification.
