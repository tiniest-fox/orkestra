// Helpers for authoring flow tests. Each e2e file describes one theme
// (happy path, human gates, agent failures, …) and shares these.

import { Effect, type Layer } from "effect"
import type { Child } from "../../src/workflow/domain/outputs/proposal.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import type { RuntimeDeps, RuntimeError } from "../../src/workflow/runtime.js"
import type { Archive } from "../../src/workflow/ports/archive.js"
import type { Idle } from "../../src/workflow/ports/idle.js"
import type { EngineLog } from "../../src/workflow/ports/engine-log.js"
import type { Environment } from "../../src/workflow/ports/environment.js"
import type { Feed } from "../../src/workflow/ports/feed.js"
import type { GoalStore } from "../../src/workflow/ports/goal-store.js"
import type { Locks } from "../../src/workflow/ports/locks.js"
import type { Store } from "../../src/workflow/ports/store.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"
import type { Drives } from "../../src/app/drive.js"
import type { Conditions } from "../../src/app/conditions.js"
import type { Deploys } from "../../src/app/deploys.js"
import type { Details } from "../../src/app/details.js"
import type { HostGit } from "../../src/app/host-git.js"
import type { UsageMemory } from "../../src/app/plan-usage.js"
import type { Forge } from "../../src/vcs/ports/forge.js"
import type { Push } from "../../src/app/push.js"
import type { PushSent, PushSentTo } from "./push-memory.js"
import type { Openers } from "../../src/app/openers.js"
import type { Library } from "../../src/library/types/library.js"
import type { ProviderEvent } from "../../src/agent/types/provider-event.js"
import type { SessionRequest } from "../../src/agent/types/session.js"
import {
  hangsOn,
  onPrompt,
  onResume,
  reply,
  stopShort,
  type AgentLog,
  type ScriptedStep,
  type Turn,
} from "./scripted-agent.js"
import type { CheckScript, ChecksLog } from "./scripted-checks.js"
import { type FlowVcs, scenario } from "./scenario.js"
import { openPromptLog } from "./prompt-log.js"
import type { Views } from "../../src/app/views.js"
import type { GoalDrives } from "../../src/app/goal-drives.js"
import type { People } from "../../src/app/people.js"
import type { Preparation } from "../../src/vcs/ports/preparation.js"
import type { Uploads } from "../../src/workflow/ports/uploads.js"

/**
 * What a flow-test body may reach for: the engine, plus the two services the HTTP
 * surface drives through. A body that only calls `advance` uses none of the second
 * pair and pays nothing for them being in scope.
 */
export type FlowDeps =
  | RuntimeDeps
  | Drives
  | Conditions
  | Deploys
  | Details
  | HostGit
  | UsageMemory
  | Feed
  | Archive
  | Idle
  | Locks
  | Forge
  | Push
  | PushSent
  | PushSentTo
  | Openers
  | Views
  | GoalStore
  | GoalDrives
  | EngineLog
  | People
  | Preparation
  | Uploads

/**
 * What a flow test's body is handed.
 *
 * Most bodies take the id and stop there, which is why the rest are positional rather
 * than an options object: a function of fewer parameters is assignable to this, so the
 * common case stays `(id) => …`. Forwarded whole by `runFlow` — dropping them there is
 * how `repoDir` arrived as `undefined` at a call site that had asked for it.
 */
export type FlowBody = (
  id: TrakId,
  agentLog: Effect.Effect<AgentLog>,
  checksLog: Effect.Effect<ChecksLog>,
  /** The throwaway repository, for the cases whose subject is the host tree. */
  repoDir: string,
) => Effect.Effect<void, RuntimeError, FlowDeps>

/**
 * Runs `body` against a fresh trak with the given scripted agent and checks, on the
 * given `Vcs`.
 *
 * Offline: memory store, fixed session ids, no clock, no agent. The worktrees are
 * real directories in a throwaway project — see `scenario.ts`.
 */
const runOn =
  (vcs: FlowVcs) =>
  (
    turns: readonly Turn[],
    body: FlowBody,
    lib?: Library,
    checks?: CheckScript,
    // Forwarded to `scenario`, which has taken one since `persistence.test.ts`
    // needed a real directory. A flow whose subject is what is *on disk* — a log
    // written by an older build, a file that will not read — cannot use the
    // memory store, and duplicating a twelve-layer set to say so is worse.
    storeLayer?: Layer.Layer<Store, StoreFailed>,
    // Likewise. Defaulted in `scenario` to *this branch has no pull request*, which
    // is what every theme but one wants; the theme about the forge passes its own.
    forgeLayer?: Layer.Layer<Forge>,
    // Likewise, for the one theme whose subject is the project's env script.
    environmentLayer?: Layer.Layer<Environment>,
  ): Promise<void> => {
    // Opened here rather than at the write, while this test is unambiguously the
    // running one: a flow vitest has already timed out finishes long after, when
    // neither its name nor its right to overwrite a good transcript still holds.
    // See `openPromptLog`.
    const promptLog = openPromptLog()
    return Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(
          scenario(turns, lib, checks, storeLayer, forgeLayer, environmentLayer, vcs),
          ({ id, layers, agentLog, checksLog, repoDir }) =>
            Effect.provide(body(id, agentLog, checksLog, repoDir), layers).pipe(
              // Written even when the body fails its assertions — a failing test is
              // exactly when you want to read what the agent was actually shown.
              // `ignore`: emitting a diagnostic must never change a test's outcome.
              // Not under `layers`: the log needs none of them, and providing them
              // here would build the whole set a second time — a repository probe
              // and every startup check again, per test.
              Effect.ensuring(Effect.ignore(Effect.map(agentLog, promptLog))),
            ),
        ),
      ),
    )
  }

/** A flow on the fake `Vcs`, plus a script for the checks. */
export const runFlowWithAgentLog = runOn("snapshots")

/** A flow on the fake `Vcs`: what every theme whose subject is not git runs on. */
export const runFlow = (
  turns: readonly Turn[],
  body: FlowBody,
  lib?: Library,
  storeLayer?: Layer.Layer<Store, StoreFailed>,
  forgeLayer?: Layer.Layer<Forge>,
): Promise<void> => runFlowWithAgentLog(turns, body, lib, undefined, storeLayer, forgeLayer)

/**
 * The same two on real git, in a throwaway repository — for a theme whose subject
 * is git, or a test that reads the repository with `git`. See `FlowVcs`.
 */
export const onGit = {
  runFlowWithAgentLog: runOn("git"),
  runFlow: (
    turns: readonly Turn[],
    body: FlowBody,
    lib?: Library,
    storeLayer?: Layer.Layer<Store, StoreFailed>,
    forgeLayer?: Layer.Layer<Forge>,
  ): Promise<void> => runOn("git")(turns, body, lib, undefined, storeLayer, forgeLayer),
}

// -- turn builders ----------------------------------------------------------

/** Distinguishes the composer's turn from a step's. Mirrors buildComposerPrompt. */
const COMPOSER_MARKER = "Compose a pipeline"

/**
 * A step, as a scripted composer names one: an agent, or an agent and the one
 * optional field a plan entry carries.
 *
 * A bare string is the common case and stays a bare string — the object form
 * exists so a flow about conversational steps can say so without every other
 * flow growing a field it does not care about, which is also what the schema's
 * optionality buys.
 */
export type Planned =
  | string
  | { readonly agent: string; readonly conversational: boolean }
  | ScriptedStep

const planned = (s: Planned): ScriptedStep =>
  typeof s === "string"
    ? { agent: s, instruction: `Produce the ${s}.` }
    : "instruction" in s
      ? s
      : { agent: s.agent, instruction: `Produce the ${s.agent}.`, conversational: s.conversational }

/**
 * One child of a spawn, written the way a log from before pieces had plans wrote
 * one — the bare pair, which still decodes as a piece of one step.
 *
 * `lens` is the thing that tells its prompt apart from a sibling's: two lenses over
 * the same change are both `review`, so the artifact name a scripted turn matches
 * on is identical and the instruction is not.
 */
export const child = (agent: string, lens: string): Child => ({
  agent,
  instruction: `Produce the ${agent} for ${lens}.`,
})

/**
 * A child that runs several steps, written the way the composer writes one now.
 *
 * Every step of it shares the piece's `lens`, which is what `childStep` matches on
 * — a piece of two is two turns to script, told apart by their agents.
 */
export const piece = (lens: string, ...agents: readonly [string, ...string[]]): Child => {
  const at = (agent: string) => ({ agent, instruction: `Produce the ${agent} for ${lens}.` })
  const [first, ...rest] = agents
  return { steps: [at(first), ...rest.map(at)] }
}

/** A spawn entry, for `composer(...)`. */
export const spawn = (...children: readonly Child[]): ScriptedStep => ({
  type: "spawn",
  instruction: "These are independent — do them at once.",
  children,
})

/** Matches the turn a spawned child runs, by the instruction it was born with. */
export const childStep = (agent: string, lens: string, agentReply: string): Turn =>
  onPrompt(new RegExp(`Produce the ${agent} for ${lens}\\.`), agentReply, `child:${agent}:${lens}`)

/**
 * The same child's turn, started and never answered — `stepHangs` one level down.
 *
 * What a test about the daemon's fan-out needs: every other scripted turn is
 * instantaneous, so *one child still running while another finishes* is a race
 * rather than a state unless one of them refuses to end.
 */
export const childStepHangs = (agent: string, lens: string): Turn =>
  hangsOn(new RegExp(`Produce the ${agent} for ${lens}\\.`), `child-hangs:${agent}:${lens}`)

/**
 * What a scripted composer proposes: one agent name per step.
 *
 * A step carries nothing else: the artifact's name, its shape and its checks all
 * belong to the agent, so a flow that is about any of those changes the library in
 * `scenario.ts` rather than the plan.
 */
export const composer = (...agents: readonly Planned[]): Turn =>
  onPrompt(
    new RegExp(COMPOSER_MARKER),
    reply.proposal("Add a --json flag", agents.map(planned)),
    "compose",
  )

/**
 * The same plan, ending in a compose entry — which is what makes the trak ask the
 * composer again instead of coming to rest once the steps before it have run.
 *
 * Its own builder rather than an argument to `composer`, because that one takes
 * the agents as varargs and there is nowhere to put a second thing.
 */
export const composerStopping = (question: string, ...agents: readonly Planned[]): Turn =>
  onPrompt(
    new RegExp(COMPOSER_MARKER),
    reply.proposal("Add a --json flag", [...agents.map(planned), stopShort(question)]),
    "compose",
  )

/**
 * The same plan, from a run that says it met a fork nobody had settled.
 *
 * Its own builder rather than an argument to `composer`, which takes the agents as
 * varargs — and because a flow that is not about the rung should not have to write one.
 */
export const composerUnsure = (...agents: readonly Planned[]): Turn =>
  onPrompt(
    new RegExp(COMPOSER_MARKER),
    reply.proposal("Add a --json flag", agents.map(planned), "a_lot"),
    "compose unsure",
  )

/**
 * The composer answering that the work is already done, on the turn a fresh compose
 * reaches — handing work off to traks of its own where `handOff` names any.
 */
export const composerFinishes = (reason: string, handOff?: readonly [string, ...string[]]): Turn =>
  onPrompt(new RegExp(COMPOSER_MARKER), reply.finished(reason, handOff), "compose finishes")

/**
 * A plan with work handed off beside it. `composer`'s shape with the one more list,
 * because that one takes the agents as varargs.
 */
export const composerHandingOff = (
  handOff: readonly [string, ...string[]],
  ...agents: readonly Planned[]
): Turn =>
  onPrompt(
    new RegExp(COMPOSER_MARKER),
    reply.proposalHandingOff("Add a --json flag", agents.map(planned), handOff),
    "compose handing off",
  )

/**
 * The composer of a trak another trak's composer handed off, matched on the
 * description it was opened with — which is the hand-off's own words, and the one thing
 * that tells its prompt from the composer turn that wrote it.
 */
export const composerOf = (description: string, ...agents: readonly Planned[]): Turn =>
  onPrompt(
    new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    reply.proposal("The handed-off work", agents.map(planned)),
    `compose:${description}`,
  )

/**
 * The composer asking instead of proposing, on the turn a fresh compose reaches.
 *
 * What answers it is `composerResumes`, and it has to be matched on the resume rather
 * than on the marker: every body that carries the composer's whole framing is a fresh
 * session, so the second turn of one run — answered, or told nobody will answer —
 * contains none of it.
 */
export const composerAsks = (...questions: readonly [string, ...string[]]): Turn =>
  onPrompt(new RegExp(COMPOSER_MARKER), reply.questions(...questions), "compose asks")

/** The plan that run proposes once its session is resumed. See `composerAsks`. */
export const composerResumes = (...agents: readonly Planned[]): Turn =>
  onResume(reply.proposal("Add a --json flag", agents.map(planned)), "compose resumed")

/**
 * The things a re-consulted composer can be answering, each matched on the one
 * line of `reconsult.md` only its own branch renders.
 *
 * One builder each rather than one shared, and each matching on its own branch,
 * because that is what makes a test fail loudly if the composer is ever asked for
 * a plan without being told what it is answering. Matching the block's shared
 * heading would let them all pass while any of them was silently blank.
 *
 * The title is deliberately not the one `composer` proposes: `revise` takes the newest,
 * so a re-consulted flow renames its trak and a test can see that it did.
 *
 * Each hands back a plan of plain steps, which is what stops a scripted flow
 * composing forever: the entry that asks again is one the composer has to propose.
 */
const asked =
  (marker: string, label: string) =>
  (...agents: readonly Planned[]): Turn =>
    onPrompt(new RegExp(marker), reply.proposal("the work, re-cut", agents.map(planned)), label)

/** A person stopped somewhere and said what should happen instead. */
export const afterReplan = asked("A person stopped at", "replan")

/** A step filed its work and sent the plan back with it. */
export const afterRaised = asked("did its work and filed its artifact", "raised")

/** The world came back to work that had already finished. */
export const afterReentry = asked("This work already finished", "reentry")

/** The plan reached the compose entry the composer wrote for itself. */
export const afterStoppingShort = asked("You planned this turn yourself", "planned")

/** A person pressed merge and the two branches disagreed. */
export const afterConflict = asked("The merge did not go in", "conflict")

/**
 * The artifact key the engine assigns a step: its position, then its agent.
 *
 * Spelled out here rather than imported, so a test that asserts on `0-work` is
 * asserting against the string the prompt actually carries rather than against
 * the function that built it.
 */
export const key = (index: number, agent: string): string => `${index}-${agent}`

/** The step at `index` starts and never answers — see `hangsOn`. */
export const stepHangs = (index: number, agent: string): Turn =>
  hangsOn(new RegExp(`artifact named \`${key(index, agent)}\``), `hangs:${key(index, agent)}`)

/** The same, after reporting what it has spent — see `Turn.spends`. */
export const stepHangsAfterSpending = (
  index: number,
  agent: string,
  spends: Parameters<typeof ProviderEvent.Usage>[0],
): Turn =>
  hangsOn(
    new RegExp(`artifact named \`${key(index, agent)}\``),
    `hangs:${key(index, agent)}`,
    spends,
  )

/** Matches the prompt for the step at `index`, which names `agent`. */
export const step = (index: number, agent: string, agentReply: string, label?: string): Turn =>
  onPrompt(
    new RegExp(`artifact named \`${key(index, agent)}\``),
    agentReply,
    label ?? `step:${key(index, agent)}`,
  )

/**
 * The step invocations only — the composer's turn filtered out, so a test can
 * assert on session reuse without knowing the composer ran first.
 *
 * Identified by the absence of the marker, which a step *resume* also lacks — that
 * is deliberate, since a retry is an invocation of the step. The cost is that a
 * composer resume counts here too, so a flow with both needs to assert on the
 * prompt text ("artifact named") rather than on this count.
 */
export const stepRuns = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => !r.prompt.includes(COMPOSER_MARKER))

/**
 * The composer's invocations only — including its retries and its resume after
 * answering, which do NOT carry the marker because a resume prompt is new context
 * only. Identified by what they are NOT: a step names the artifact it wants.
 */
export const composerRuns = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => !r.prompt.includes("artifact named"))
