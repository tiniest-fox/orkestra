// The composer says the work this trak was asked for is done and on the branch, so
// there is nothing left to plan. `failed`'s opposite, and the one answer that ends a
// trak at rest rather than in front of a person.
//
// One required `reason`, and two optional fields that cannot both be present. A rung
// would inform a gate rule, and this answer takes no gate of its own. A requirements
// list would reach no later step of *this* trak, because there are none — but a child
// has one more reader, its parent at the join, and `handUp` is what reaches it. A trak
// with no parent has the other reader: a new trak, and `handOff` is what opens one — or
// a new goal, and `goal` is what proposes one.

import { Schema } from "effect"
import { HandOff } from "./hand-off.js"

export const Finished = Schema.Struct({
  type: Schema.tag("finished"),
  reason: Schema.String,
  /**
   * Work this trak found that belongs to none of its split, for the parent to plan.
   *
   * **A child's alone**, refused at decode on a trak with no parent — see
   * `ComposerOutputFor`. It is the one way a finding travels up: a child's step files
   * `unplanned_work`, that wakes the child's composer, and the composer is the only
   * party that has judged the work out of its piece. It rides home on `ChildLanded`
   * and becomes a `Raised` at the parent's join — or, from a landed child sent back
   * after that join, on `ChildRefiled` and onto `Trak.handUps`, for the parent's next
   * composer turn. Prose rather than a requirement either way, because the parent's
   * composer is what decides whether it is planned.
   */
  handUp: Schema.optional(Schema.String),
  /**
   * Work this trak found that belongs on a base it does not have, each opening a
   * trak of its own. See `HandOff` — and its counterpart above: a child hands up,
   * a trak with no parent hands off, and `ComposerOutputFor` refuses each on the
   * other. Here as well as on the proposal, because the trak that forced the
   * feature has nothing left it may plan.
   */
  handOff: Schema.optional(HandOff),
  /**
   * A goal this trak's work leads to, in markdown — what its composer drafts the goal
   * file from, beside every document this trak filed. It starts once this trak is at
   * rest, and stops at its drafted file as every goal asked for in words does.
   *
   * **A top-level trak's alone**: `ComposerOutputFor` refuses it on a child and on a
   * goal's trak, whose composer is never told the field exists. On the finish alone,
   * because the goal waits for this trak to finish whichever answer proposed it.
   */
  goal: Schema.optional(
    Schema.String.pipe(Schema.filter((g) => g.trim() !== "" || "`goal` says nothing")),
  ),
})
export type Finished = Schema.Schema.Type<typeof Finished>

// Exact optionals, built by hand: a `finished` with nothing to hand up or off carries
// no key for it.
export const finished = (
  reason: string,
  handUp?: string,
  handOff?: HandOff,
  goal?: string,
): Finished =>
  Finished.make({
    reason,
    ...(handUp === undefined ? {} : { handUp }),
    ...(handOff === undefined ? {} : { handOff }),
    ...(goal === undefined ? {} : { goal }),
  })
