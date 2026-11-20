// What a composer says when it finds work belonging on a base this trak does not
// have: a fix to code its branch already merged, a piece wanting its own pull
// request. Each description opens a trak of its own, cut from the repository's
// default branch, and none of them comes back — no join, no merge, no wait. That
// last is what separates it from a spawn, whose children branch from this trak's
// branch and land on it.
//
// **A description and nothing else.** A hand-off names work, not a plan: an agent, a
// title or a base written here would be planned against a base the composer has
// never seen. The new trak's own composer reads what it needs fresh.
//
// Both composer answers may carry one — the proposal and the finish — because the
// trak that forced this has nothing left it may plan, and an ordinary trak whose
// composer finds such work mid-plan has a plan to propose beside it.

import { Schema } from "effect"

/** One or more descriptions, each a trak. Never empty: a key with nothing in it is left off. */
export const HandOff = Schema.NonEmptyArray(Schema.String)
export type HandOff = Schema.Schema.Type<typeof HandOff>
