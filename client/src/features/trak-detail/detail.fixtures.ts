/**
 * A whole trak, and the log behind it.
 *
 * This is the expensive one and it pays for the rest: `DrawerPane`, `FinishedView` and
 * `TrakDetailsView` all take a `TrakDetailDto`, `TrakDetailsView` takes the plan out of it,
 * and `TurnsView` takes the log. Everything the client *derives* — bands, spots, turns,
 * what was filed and why a turn ran — is computed from the same log by the pure functions
 * in `family.ts`, `turns.ts` and `filed.ts`.
 *
 * **The log is written to be worth deriving from.** Several steps, a check that failed and
 * then passed, a delegation, and a composer run — a log with one entry exercises none of
 * the branching those functions exist to do, and a component drawn from it is a picture of
 * the empty case.
 *
 * `makeDetail` and the event builders supply the floor; what is written out here is what
 * you are looking at. Ids are explicit for the reason `trak.fixtures.ts` gives: a value
 * that moved on its own would make a comparison against last time a lie.
 */

import type { PlanDto, TrakDetailDto } from "../../api/types"
import {
  makeAgentReturned,
  makeAgentStep,
  makeCheckFailed,
  makeChecksPassed,
  makeComposeEntry,
  makeComposerReturned,
  makeDetail,
  makeHumanActed,
  makePlan,
  makeTrakCreated,
  makeWorktreeReady,
} from "../../fixtures"
import { artifact, proposal } from "./turns/output.fixtures"

export const plan: PlanDto = makePlan({
  title: "Derive the catalogue panel from the props types",
  steps: [
    makeComposeEntry(),
    makeAgentStep({
      agent: "builder",
      instruction: "walk the exported components and classify each prop",
    }),
    makeAgentStep({ agent: "builder", instruction: "split a union props type into its branches" }),
    makeAgentStep({
      agent: "reviewer",
      instruction: "check the derived panel against a real client",
      conversational: true,
    }),
  ],
})

/** A plan of one, for the layouts that stack a row per entry. */
export const shortPlan: PlanDto = makePlan({
  title: "Bump the provider client",
  steps: [makeAgentStep({ instruction: "move to the streaming API" })],
})

/**
 * Enough log to derive from: a composer run, two agent turns, a check that failed and then
 * passed, and a human approval between them.
 */
export const log = [
  makeTrakCreated({ description: "derive the catalogue panel from the props types" }),
  makeWorktreeReady(),
  makeComposerReturned({ sessionId: "s-composer", output: proposal }),
  makeHumanActed({ step: 0, action: { _tag: "Approve" } }),
  makeAgentReturned({ step: 1, sessionId: "s-1", output: artifact }),
  makeCheckFailed({ step: 1, name: "verify", output: "knip: 2 unused exports" }),
  makeChecksPassed({ step: 1, ran: ["verify"] }),
  makeAgentReturned({ step: 2, sessionId: "s-2", output: artifact }),
] as const

export const working: TrakDetailDto = makeDetail({
  id: "01HQ8G",
  description: "stop splitting unions into separate entries",
  state: { _tag: "AgentWorking", step: 2 },
  plan,
  worktree: { path: "/tmp/orkestra/trak-01HQ8G", branch: "trak/01HQ8G", base: "9f2c1ab" },
  // A detail's decision carries `at` — the step it was taken at — and the `id` a later
  // one names it by, where the `DecidedDto` an artifact lists carries neither. Two
  // shapes, near enough to look like one.
  decisions: [
    {
      text: "A union props type is one component with variants, not two components",
      source: "assumed",
      at: "1-scope",
      id: "1-scope.1",
    },
    {
      text: "Props declared in node_modules are inherited rather than authored",
      source: "stated",
      at: "2-build",
      id: "2-build.1",
    },
  ],
  log: [...log],
  custody: { holder: { since: 1786400000000 } },
})

export const awaitingApproval: TrakDetailDto = makeDetail({
  id: "01HQ8H",
  description: "the hairline under the header is a pixel out in dark mode",
  state: { _tag: "AwaitingHuman", step: 4, kind: "approval" },
  plan: shortPlan,
  log: [...log],
})

export const finished: TrakDetailDto = makeDetail({
  id: "01HQ8J",
  description: "bring the seed design onto the new controls contract",
  state: { _tag: "Finished" },
  plan,
  worktree: { path: "/tmp/orkestra/trak-01HQ8J", branch: "trak/01HQ8J", base: "4b7e991" },
  log: [...log],
})

/**
 * Just created — no plan, no worktree, an empty log.
 *
 * The least interesting to write and the first thing a real user sees, which is the whole
 * argument for it being here.
 */
export const fresh: TrakDetailDto = makeDetail({
  id: "01HQ8N",
  description: "add a client for the traks list",
  state: { _tag: "Preparing" },
})
