// The fixture library every flow runs against: a fleet of four roles and the engine's own
// `generic`, with no checks, processes or runner. Apart from `scenario.ts` because a test
// that wants a `Library` and runs no flow — a check, a runner, a sandbox — would otherwise
// import the runtime with it, and `verify-light` would run that test for every edit the
// runtime reaches.

import { Effect, Layer } from "effect"
import type { Agent } from "../../src/library/types/agent.js"
import type { Library } from "../../src/library/types/library.js"
import { NO_RUNNER_FILES, type RunnerFiles, Runners } from "../../src/vcs/ports/runners.js"

/**
 * The fleet every flow test runs against.
 *
 * Three of the four declare one required `Summary`, which is the degenerate
 * output shape and what most agents have — so `reply.artifact("v1")` satisfies
 * any of them and a flow that is not about sections never mentions one.
 * `design` is the exception, with two required and one optional, for the flows
 * that ARE about sections.
 *
 * `work` is the only one that writes. That difference is visible in the
 * `SessionRequest` rather than in the plan, which is what `library-from-disk`
 * asserts on.
 *
 * **`review` is the only one that cannot start a trak**, standing in for the real
 * fleet's `resolve` and `unblock`. A fixture where every agent were startable would
 * let `GET /api/agents` pass while filtering nothing, which is the one thing that
 * endpoint has to get right.
 */
const summaryOnly = (what: string) => [
  { title: "Summary", description: what, when: undefined, figure: undefined },
]

/**
 * The engine's own agent, as the fixture's copy of it.
 *
 * The real one is parsed out of `src/library/shipped/generic.md` — asserted against by
 * `library-from-disk`, which is the tier that reads the file. Here it is what makes a
 * flow that re-enters a finished trak with a question have something to run.
 *
 * `start: true` and its model is this fixture's `composer:`, both for the reason the
 * real one has them: New Chat opens a trak with it, and a file the engine ships names
 * no model of its own.
 */
const generic: Agent = {
  name: "generic",
  description: "No role of its own: does the one thing it was asked.",
  brief: "Do what the sentence asks and stop.",
  model: "haiku",
  permission: "write",
  sections: summaryOnly("The answer, or what changed."),
  checks: [],
  effects: [],
  conditions: [],
  processes: [],
  skills: [],
  start: true,
  place: "sandbox" as const,
  icon: "bot",
  effort: undefined,
}

/** The four roles of `library`, in a function so every flow gets maps of its own. */
const fleet = (): ReadonlyMap<string, Agent> =>
  new Map([
    [
      "design",
      {
        name: "design",
        description: "Decides how to build it, in sections.",
        brief: "Design it.",
        model: "opus",
        permission: "read-only",
        sections: [
          { title: "Summary", description: "What and why.", when: undefined, figure: undefined },
          { title: "Steps", description: "What to do.", when: undefined, figure: undefined },
          {
            title: "Risks",
            description: "What might bite.",
            when: "a step could fail",
            figure: undefined,
          },
        ],
        checks: [],
        effects: [],
        conditions: [],
        processes: [],
        skills: [],
        start: true,
        place: "sandbox" as const,
        icon: undefined,
        effort: undefined,
      },
    ],
    [
      "plan",
      {
        name: "plan",
        description: "Decides what to build before anything is built.",
        brief: "Plan it.",
        model: "opus",
        permission: "read-only",
        sections: summaryOnly("What and why."),
        checks: [],
        effects: [],
        conditions: [],
        processes: [],
        skills: [],
        start: true,
        place: "sandbox" as const,
        icon: undefined,
        effort: undefined,
      },
    ],
    [
      "review",
      {
        name: "review",
        description: "Reviews the work.",
        brief: "Review it.",
        model: "opus",
        permission: "read-only",
        sections: summaryOnly("Would you ship it."),
        checks: [],
        effects: [],
        conditions: [],
        processes: [],
        skills: [],
        start: false,
        place: "sandbox" as const,
        icon: undefined,
        effort: undefined,
      },
    ],
    [
      "work",
      {
        name: "work",
        description: "Implements the plan.",
        brief: "Do the work.",
        model: "sonnet",
        permission: "write",
        sections: summaryOnly("What changed."),
        checks: [],
        effects: [],
        conditions: [],
        processes: [],
        skills: [],
        start: true,
        place: "sandbox" as const,
        icon: undefined,
        effort: undefined,
      },
    ],
  ])

export const library = (over: Partial<Library> = {}): Library => ({
  models: {
    allowed: ["opus", "sonnet", "haiku"],
    efforts: new Map(),
    composer: "haiku",
    windows: {},
  },
  generic,
  composition: "Keep it lean.",
  goals: "",
  guidance: "",
  checks: new Map(),
  processes: new Map(),
  tools: new Map(),
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
  mcp: { servers: [], problems: [] },
  root: "/repo",
  agents: fleet(),
  ...over,
})

/**
 * `Runners` answering `over` — a runner, its file, a host runner's key, a backup file — with no
 * reattach window. Where a test provides a fixed library with a runner,
 * this stands beside it: the library holds no runner of its own.
 */
export const runners = (over: Partial<Omit<RunnerFiles, "reattachMs">> = {}) => {
  const files: RunnerFiles = {
    ...NO_RUNNER_FILES,
    ...over,
    reattachMs: 0,
  }
  return Layer.succeed(Runners, { current: Effect.succeed(files) })
}

/**
 * The same fleet, with `work` declaring the given checks.
 *
 * Checks belong to the agent now, so a flow about them changes policy rather
 * than the plan the composer writes — which is the whole of what decision 3 of
 * the epic moved.
 */
export const workDeclaring = (checks: readonly string[], over: Partial<Library> = {}): Library => {
  const lib = library(over)
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, checks }) }
}

/**
 * The same fleet, with `work` declaring the given effects.
 *
 * `workDeclaring`'s twin rather than a second parameter on it, because the two lists
 * name scripts out of one registry and what separates them is only what a non-zero
 * exit means — so a flow saying `effects` is saying which meaning it is about.
 */
export const workEffecting = (effects: readonly string[], over: Partial<Library> = {}): Library => {
  const lib = library(over)
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, effects }) }
}
