// The simulated engine's project and the states `pnpm sim` seeds into it.
//
// Each trak is reached the way a person reaches it: created, then pressed, with the
// scripted provider answering every turn from that trak's own queue. Nothing here
// writes a log — a state the engine would not produce cannot be seeded.
//
// The project uses the shipped fleet. Its one override gives `build` a stand-in check,
// because a trak resting mid-check needs a check and no shipped role declares one.
// The check reads which trak it runs in from its checkout's name, so one script both
// passes and gives the two check states their trak.

import { Console, Effect, Schema } from "effect"
import { McpToolResultDto } from "@orkestra/shared/dto/goals"
import type { ScriptedTurn } from "../../src/agent/adapters/scripted.js"
import type { SessionRequest } from "../../src/agent/types/session.js"
import { type Agent, requiredTitles } from "../../src/library/types/agent.js"
import type { Library } from "../../src/library/types/library.js"
import type { GoalSpec } from "../../src/workflow/domain/goal.js"
import { Actions, type HumanAction } from "../../src/workflow/domain/human-action.js"
import { reply } from "./scripted-agent.js"

/** The check `build` runs in the simulated project. */
const STAND_IN = `#!/bin/bash
# ---
# description: A stand-in check for the simulated engine. It passes, except in a trak named for a failing check or for one still running.
# cache: false
# timeout_seconds: 86400
# ---
case "$(basename "$PWD")" in
  *check-running*)
    # Running until the engine that started it is gone, so a stopped sim leaves nothing behind.
    while kill -0 "$PPID" 2>/dev/null; do sleep 1; done
    ;;
  *check-failed*)
    echo "the stand-in check failed, as this trak is seeded to"
    exit 1
    ;;
esac
echo "the stand-in check passed"
`

/** Every file the temporary project is committed with, by its path from the root. */
export const SIM_PROJECT: Readonly<Record<string, string>> = {
  "README.md": "# A simulated project\n\nEvery agent turn here is scripted; nothing spends.\n",
  ".orkestra/agents/build.md": "---\nchecks:\n  - stand-in\n---\n",
  ".orkestra/checks/stand-in.sh": STAND_IN,
}

/** One press at one position — `0` the plan, `1` the first step — as a person makes it. */
interface SimPress {
  readonly step: number
  readonly action: HumanAction
}

export interface SimTrak {
  /** The trak's id, and the name its checkout and branch are given. */
  readonly id: string
  /** The state it is left in, as the `sim` skill and the boot log name it. */
  readonly rests: string
  readonly description: string
  /** Its own queue, in the order its turns ask. The repeat answers past the end. */
  readonly answers: (lib: Library) => readonly ScriptedTurn[]
  readonly presses: readonly SimPress[]
  /** `false` where the last press starts something that never ends: a check still running. */
  readonly settles: boolean
}

const agentOf = (lib: Library, name: string): Agent => {
  const agent = lib.agents.get(name)
  if (agent === undefined) throw new Error(`the simulated project's fleet has no \`${name}\``)
  return agent
}

/** A document filling every section the agent owes, each saying where it came from. */
const documentOf = (agent: Agent, what: string): string =>
  reply.sectioned(
    Object.fromEntries(
      requiredTitles(agent).map((title) => [
        title,
        `${what}: the ${title} the simulated \`${agent.name}\` filed.`,
      ]),
    ),
  )

const planOf = (title: string): string =>
  reply.proposal(title, [
    { agent: "build", instruction: "Build the change." },
    { agent: "review", instruction: "Review the change." },
  ])

const turn = (text: string): ScriptedTurn => ({ text })

/** The document the simulated `build` files, and the plan every simulated trak proposes. */
export const simBuilt = (lib: Library, what: string): string =>
  documentOf(agentOf(lib, "build"), what)

const built = (lib: Library, what: string): ScriptedTurn => turn(simBuilt(lib, what))

const approve = (step: number): SimPress => ({ step, action: Actions.approve() })

export const SIM_TRAKS: readonly SimTrak[] = [
  {
    id: "sim-plan-gate",
    rests: "at the plan gate",
    description: "Add a plan gate to look at.",
    answers: () => [turn(planOf("A plan waiting to be approved"))],
    presses: [],
    settles: true,
  },
  {
    id: "sim-at-gate",
    rests: "at the build step's gate, its document filed and its check passed",
    description: "Leave a document at its gate.",
    answers: (lib) => [turn(planOf("A document at its gate")), built(lib, "At the gate")],
    presses: [approve(0)],
    settles: true,
  },
  {
    id: "sim-questions",
    rests: "at a question card from the build step",
    description: "Ask a question at the build step.",
    answers: () => [
      turn(planOf("A step with a question")),
      turn(reply.askWithOptions("Which way should it go?", "This way", "That way")),
    ],
    presses: [approve(0)],
    settles: true,
  },
  {
    id: "sim-stuck",
    rests: "stuck at the build step",
    description: "Get stuck at the build step.",
    answers: () => [turn(planOf("A step that got stuck")), turn(reply.stuck("built it twice"))],
    presses: [approve(0)],
    settles: true,
  },
  {
    id: "sim-check-running",
    rests: "mid-check: the build step's check running, and running until the engine stops",
    description: "Run a check that does not finish.",
    answers: (lib) => [turn(planOf("A check still running")), built(lib, "Mid-check")],
    presses: [approve(0)],
    settles: false,
  },
  {
    id: "sim-check-failed",
    rests: "at the gate a failing check opens, after the build step",
    description: "Fail the build step's check.",
    answers: (lib) => [turn(planOf("A check that failed")), built(lib, "Before the failed check")],
    presses: [approve(0)],
    settles: true,
  },
  {
    id: "sim-second-step",
    rests: "at the review step's gate, the build step accepted",
    description: "Reach the second step.",
    answers: (lib) => [
      turn(planOf("A second step at its gate")),
      built(lib, "The first step"),
      turn(documentOf(agentOf(lib, "review"), "The second step")),
    ],
    presses: [approve(0), approve(1)],
    settles: true,
  },
  {
    id: "sim-finished",
    rests: "finished, every step accepted",
    description: "Finish every step.",
    answers: (lib) => [
      turn(planOf("A finished trak")),
      built(lib, "The first step"),
      turn(documentOf(agentOf(lib, "review"), "The second step")),
    ],
    presses: [approve(0), approve(1), approve(2)],
    settles: true,
  },
]

/**
 * The answers a turn takes once its queue is spent, or where it has none — a trak opened
 * on the page, or a goal's. A plan for a composer, a document for each role, fewest
 * sections first so a turn takes the closest fit, and prose for a turn none of them
 * settles.
 */
export const simRepeat = (lib: Library): readonly [string, ...string[]] => {
  const documents = [lib.generic, ...lib.agents.values()]
    .toSorted((a, b) => requiredTitles(a).length - requiredTitles(b).length)
    .map((agent) => documentOf(agent, "Repeated"))
  return [
    planOf("A trak in the simulated engine"),
    ...documents,
    reply.prose("The simulated engine has nothing more to say."),
  ]
}

/**
 * One goal tool call, made the way the CLI's `orkestra goal-tools` server makes it: to the
 * engine, goal and token the session's server was handed. A refusal is printed, since
 * nothing else would say why the goal never reached its state.
 */
const goalTool =
  (name: string, args: unknown) =>
  (req: SessionRequest): Effect.Effect<void> => {
    const env = Object.values(req.mcpServers ?? {})
      .flatMap((server) => (server._tag === "Stdio" ? [server.env] : []))
      .find((e) => e["ORK_GOAL_ID"] !== undefined)
    const engine = env?.["ORK_GOAL_ENGINE"]
    const goal = env?.["ORK_GOAL_ID"]
    if (engine === undefined || goal === undefined) {
      return Console.error(`sim: the goal's turn was handed no tool server to call ${name} on`)
    }
    return Effect.promise(async () => {
      const response = await fetch(`${engine}/api/goals/${goal}/tools/${name}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env?.["ORK_GOAL_TOKEN"] ?? ""}`,
        },
        body: JSON.stringify({ call: `sim-${name}`, arguments: args }),
      })
      const answer: unknown = await response.json()
      return answer
    }).pipe(
      Effect.flatMap(Schema.decodeUnknown(McpToolResultDto)),
      Effect.flatMap((result) =>
        result.isError ? Console.error(`sim: ${name} was refused: ${result.text}`) : Effect.void,
      ),
      Effect.catchAll((e) => Console.error(`sim: ${name} failed: ${String(e)}`)),
    )
  }

const PLANNED = [
  { title: "The first trak", description: "Open the goal's first trak.", mode: "manual" },
  { title: "The second trak", description: "Open the goal's second trak.", mode: "manual" },
] as const

/**
 * A goal partway through: its first turn opened the first trak, which is at its own plan
 * gate, and kept the second in its plan. Its composer's turns run in the project root, so
 * they are that directory's queue.
 */
export const SIM_GOAL = {
  spec: {
    file: "sim-goal",
    title: "Ship the simulated goal",
    line: "Two traks, opened one after the other.",
    finished: "Both traks have landed.",
    limits: { modes: ["manual"] },
  } satisfies GoalSpec,
  rests: "watching: the first trak open, the second still to open",
  answers: [
    {
      text: reply.prose("Opened the first trak, and planned the second."),
      during: (req: SessionRequest) =>
        Effect.andThen(
          goalTool("replan", { traks: PLANNED, why: "The second waits on the first." })(req),
          goalTool("open_trak", PLANNED[0])(req),
        ),
    },
  ] satisfies readonly ScriptedTurn[],
}
