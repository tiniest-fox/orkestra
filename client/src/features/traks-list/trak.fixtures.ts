/**
 * What a trak looks like, for the atelier catalogue.
 *
 * `TrakSummaryDto` is the one thing no type can describe well enough to draw — its `state`
 * is a twenty-one-member tagged union and its shape is Schema-derived, so the catalogue would
 * otherwise leave every component that takes one blocked. These are the values it offers
 * instead, matched to a prop by **assignability** rather than by name, which is why one
 * file serves `TrakRow`, `BandPiece`, `TrakBand` and `TrakSections` without naming any of
 * them.
 *
 * **Each export becomes an option on the knob**, so the names here are read in the panel
 * and belong in the same care as any other label. They are named after the state they are
 * in, because the state is the axis worth sweeping: a preview would freeze one of twenty-one.
 *
 * `makeTrak` supplies the floor every one of these shares; everything below is written out
 * because it is what you are looking at. **Nothing here takes a generated default, `id`
 * included** — a fixture is compared against the one you saw last time, and a value that
 * moved on its own would make that comparison a lie.
 *
 * Ordinary source, in the client's own project, typechecked by the client's own `tsc`.
 * That is the whole mechanism — a fixture outside the project has no type, and a value
 * with no type matches nothing.
 */

import type { TrakSummaryDto } from "../../api/types"
import { makeTrak } from "../../fixtures"

export const composing: TrakSummaryDto = makeTrak({
  id: "01HQ8F",
  description: "add a client for the traks list",
  state: { _tag: "Composing" },
  running: true,
})

export const working: TrakSummaryDto = makeTrak({
  id: "01HQ8G",
  title: "Rewrite the catalogue walk",
  description: "stop splitting unions into separate entries",
  state: { _tag: "AgentWorking", step: 2 },
  running: true,
  touched: 3,
})

export const awaitingApproval: TrakSummaryDto = makeTrak({
  id: "01HQ8H",
  title: "Fix the header rule",
  description: "the hairline under the header is a pixel out in dark mode",
  state: { _tag: "AwaitingHuman", step: 4, kind: "approval" },
  running: false,
  touched: 41,
})

export const finished: TrakSummaryDto = makeTrak({
  id: "01HQ8J",
  title: "Port the seed design",
  description: "bring the seed design onto the new controls contract",
  state: { _tag: "Finished" },
  running: false,
  touched: 190,
})

export const failed: TrakSummaryDto = makeTrak({
  id: "01HQ8K",
  title: "Upgrade the provider",
  description: "move to the streaming provider API",
  state: { _tag: "Failed", error: "provider returned 502 after 3 retries", kind: "provider" },
  running: false,
  touched: 12,
})

/**
 * The three-line row, which is the one the list actually draws most of the time.
 *
 * `instruction` and `activity` are what make it three lines rather than two, and no fixture
 * above sets either — so every entry drawn from those renders the short row and a layout
 * judged on them is judged on the uncommon case. `activity` is sent only while `running`,
 * so this one is.
 */
export const busy: TrakSummaryDto = makeTrak({
  id: "01HQ8L",
  title: "Derive the knobs from props",
  description: "resolve each entry from the types rather than a list somebody maintains",
  state: { _tag: "AgentWorking", step: 3 },
  running: true,
  instruction: "fold the branches back together so a union is one entry with a knob",
  activity: [
    { _tag: "Tool", name: "Read", kind: "Read", detail: "client/src/api/types.ts" },
    { _tag: "Tool", name: "Read", kind: "Read", detail: "client/src/format/activity.ts" },
    { _tag: "Tool", name: "Bash", kind: "Bash", detail: "pnpm --filter @orkestra/client test" },
  ],
  touched: 2,
})

/** A child, for the lifted line that says which spawn it belongs to. */
export const child: TrakSummaryDto = makeTrak({
  id: "01HQ8M",
  title: "Take the second half",
  description: "port the drawer's action bar",
  state: { _tag: "AgentWorking", step: 1 },
  running: true,
  parent: { id: "01HQ8L", step: 3, child: 1, depth: 1 },
  instruction: "port the drawer's action bar onto the new controls contract",
  touched: 1,
})
