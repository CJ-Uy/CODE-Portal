# Event Taxonomy and Multi-Type Points Review Log - Round 4

Verification-only pass against the current spec and the four round-3 findings.

1. Finding 1 - CLOSED
   Proof: Section 5 says Plan B2 keeps a shim that is a "distinct operation, not an alias for `setAwards`" (lines 524-525), explains that a `setAwards([{ pt_retention, points }])` shim would "erase every non-Retention award" (lines 527-531), and defines `setPoints` as "scoped, Retention-only" with these requirements: update, insert, or remove only Retention; leave every other `event_point_awards` row untouched; reconcile only affected Retention attendance rows; mirror to `crs_events.points`; return the distinct attendee count (lines 533-539).

2. Finding 2 - CLOSED
   Proof: Section 2 says inactive types "stop granting points going forward; existing rows are preserved" and reconciliation "does not delete rows already granted under a since-deactivated type" (lines 317-320). It adds the read-only affordance "Frontliner - retired, no longer grants points" (lines 330-333) and requires the active re-check "inside the set-based write" (lines 336-338). Section 5 step 3 now deletes no-longer-awarded attendance rows only when "restricted to active point types" (lines 460-464), then states step 3 "must never delete rows belonging to an inactive type" (lines 467-481).

3. Finding 3 - CLOSED
   Proof: Section 1 now names the admin policy screen as the third caller: "Three callers need this, not two" (lines 227-232), explains the "Any member" overwrite failure mode (lines 234-236), and requires that the admin screen "render an explicit unavailable state and refuse to submit" (lines 237-238). Section 9 Plan A carries the work across "all three callers - both calendar pages and the event-types admin screen" (lines 640-643).

4. Finding 4 - CLOSED
   Proof: Section B now says `crs_events.points` is "retained and deprecated", Plan B2 still writes it as a compatibility mirror, Plan B3 removes that write after no shipped UI reads it, and dropping the column is deferred (lines 54-56). Section 5 agrees that it "cannot stop being written until no shipped UI reads it" (lines 517-522), that `setPoints` mirrors Retention to `crs_events.points` (line 538), that `setAwards` mirrors Retention too (lines 545-546), and that B3 removes the shim and mirror only after replacing the old panel (lines 548-549). Section 9 Plan B2 and B3 match this split (lines 650-659).

IMPLEMENTATION READY: YES
