// Layer 2: what the COMPOSER agent is allowed to return.
//
// `Questions` is here on purpose. Composing is the point where ambiguity is
// cheapest to resolve — asking "is this a bugfix or a redesign?" before any step
// runs costs one turn, whereas discovering it mid-implementation costs the whole
// pipeline. The composer previously had no way to ask, so it had to guess.
//
// `Finished` is here for the mirror reason. Composing is also the point where the
// answer *there is nothing left to do* is cheapest — a person sends a finished trak
// back, or a merge conflicts, and what comes back turns out to need no work. Without
// it the composer has to invent a step, ask a question nobody needs to answer, or
// file `failed` and leave a red trak holding a worktree.
//
// `Artifact` and `Rejection` are absent: the composer produces a plan, not work,
// and has nothing to send back — there is no step before it.

import { Schema } from "effect"
import { checkAmbiguity } from "./ambiguity.js"
import { Failed } from "./failed.js"
import { Finished } from "./finished.js"
import { Message } from "./message.js"
import {
  type ChildStep,
  childSteps,
  isSpawn,
  modelOf,
  Proposal,
  type ProposedStep,
  waitForOf,
} from "./proposal.js"
import { Questions } from "./questions.js"

/** What the composer may WRITE — the set its output contract describes. */
export const AgentComposerOutput = Schema.Union(Proposal, Questions, Failed, Finished)

/**
 * The discriminator alone — `MeantAsStepOutput`'s reason, for the composer's chat.
 * `step-output.test.ts` holds this to every member of the union above too, so a
 * shape added there cannot be left out of it silently.
 */
export const MeantAsComposerOutput = Schema.Struct({
  type: Schema.Literal("proposal", "questions", "failed", "finished"),
})

/**
 * What the log carries. `Message` is the runtime's, not the agent's: see
 * `step-output.ts` for why the two sets are kept apart.
 */
export const ComposerOutput = Schema.Union(AgentComposerOutput, Message)
export type ComposerOutput = Schema.Schema.Type<typeof ComposerOutput>

/**
 * What the branch's merge does to a plan: which agents write, which declare a wait on
 * the branch merging (`merged` or `deployed`), whether it already has, and whether the
 * project has a deploy script for a step's `wait_for: "deployed"` to ask.
 *
 * The sets and `deploys` are the library's to say and are handed in as plain values, on
 * the argument `agents` makes. `landed` is the trak's — see `Trak.landed`.
 */
export interface AfterMerge {
  readonly landed: boolean
  readonly writes: ReadonlySet<string>
  readonly waits: ReadonlySet<string>
  readonly deploys: boolean
}

/** No agent writes, none waits, and nothing deploys — a decode that is not about the merge. */
export const noMerge: AfterMerge = {
  landed: false,
  writes: new Set(),
  waits: new Set(),
  deploys: false,
}

/**
 * `ComposerOutput`, narrowed to the agents this project actually has.
 *
 * An unknown name is the composer producing an unusable response, so it belongs
 * in the decode step where `elicit` already retries with the error as feedback —
 * not later at spawn time, where it escaped through the error channel after
 * `ProposalAccepted` was committed and stranded the trak in `AgentWorking`.
 *
 * **One narrowing, and only one is needed.** Output shapes and checks are
 * properties of the agent, validated when the library loads, so the agent name is
 * the only thing the composer picks that could be wrong here.
 *
 * Takes a set of names rather than a `Library`, which keeps this pure and keeps
 * `domain/` free of a `library/` import.
 *
 * `spawning` is the depth ceiling, and it is here for the same reason: a trak
 * that spawns traks spawns traks, and a composer told *no* at decode time is
 * re-prompted with the reason, where one told *no* at spawn time has already
 * committed the proposal. One level is what the worked examples need — parallel
 * review lenses, and a breakdown split into three own-PR children — and
 * a dumb constant is deliberate: the real cost of this tier is human attention,
 * and it should feel expensive when someone reaches for it.
 *
 * **Where a compose entry may sit** is the third rule, and it is the same shape for
 * the same reason. A compose says *I cannot see past this point*, so one anywhere but
 * the end is the composer planning around an answer it has just said it does not have
 * — and a plan of nothing else is a turn that proposes another turn, which never
 * reaches any work. Both are re-prompted rather than accepted and then coped with.
 *
 * **No write agent after the branch's merge is the fourth** — `after`, and see
 * `afterMerge`. A step's own `wait_for` is held to it beside the agents that wait, and
 * is refused outright on a piece of a spawn, and as `deployed` on a project with no
 * deploy script.
 *
 * **No `model` on any entry is the fifth.** The field is on the schema for a person's
 * pick — on New Chat, or at the plan gate — and the composer is never told of it, and one it wrote anyway is refused rather than dropped —
 * see `AgentStep.model`.
 *
 * **The rung the run owes is the sixth**, and it is asked last: a plan whose shape is
 * wrong has a more useful thing to be told first, and `elicit` hands back one reason.
 *
 * **The proposal rules are the six above; `finished` has one of its own, and a seventh
 * holds both answers.** A `handUp` is a message to a parent, so on a trak with none
 * it is refused here for the reason a spawn is — a composer told *no* at decode is
 * re-prompted, where one accepted has written a field that silently goes nowhere.
 * `child` is that flag: whether this trak has a parent. A `handOff` is its inverse
 * and is refused on the same flag the other way round: a child's branch goes back to
 * its parent, so work it cannot do on that branch is the parent's to place — and its
 * composer is never told the field exists (`composer.md`), so one it wrote anyway is
 * a guess to be corrected rather than a message to drop. The finishing answer itself
 * passes unrefined: it is judged against the request and the artifacts, which is the
 * composer's reading and not a shape a trak can check. Refusing it on a trak with no
 * plan yet would need this to know about the plan, which it does not.
 *
 * **A finish's `goal` is refused on a child and on a goal's trak** — `inGoal` — whose
 * composers are never told of it: a child's work is its parent's to place, and a goal's
 * composer opens sub-goals itself.
 */
export const ComposerOutputFor = (
  agents: ReadonlySet<string>,
  spawning: boolean,
  child: boolean,
  inGoal: boolean,
  after: AfterMerge,
) =>
  AgentComposerOutput.pipe(
    Schema.filter((out) => {
      if (out.type === "finished" && out.goal !== undefined && (child || inGoal)) {
        return child
          ? "`goal` proposes a goal from a trak on its own, and this trak is a piece of its parent's work: answer `finished` with a `handUp` for the parent to place it"
          : "`goal` proposes a goal from a trak on its own, and this trak is already part of a goal: answer with a `handOff` for the goal's composer to place it"
      }
      if (
        (out.type === "finished" || out.type === "proposal") &&
        out.handOff !== undefined &&
        child
      ) {
        return "`handOff` opens a trak on the main line, and this trak is a piece of its parent's work: answer `finished` with a `handUp` for the parent to place it"
      }
      if (out.type === "finished") {
        return out.handUp === undefined || child
          ? undefined
          : "`handUp` is for a spawned trak's parent, and this trak has none: file the work as a requirement, or plan it, or answer with a `handOff` where it belongs on another base"
      }
      if (out.type !== "proposal") return undefined
      if (!spawning && out.steps.some(isSpawn)) {
        return "a spawned trak may not spawn again: plan this as ordinary steps"
      }
      const composes = out.steps.filter((s) => s.type === "compose")
      if (composes.length > 0 && composes.length === out.steps.length) {
        return "a plan of nothing but a compose does no work: propose the steps that find the answer, then the compose"
      }
      if (out.steps.slice(0, -1).some((s) => s.type === "compose")) {
        return "a compose may only be the last entry: it says where you stop, so nothing can be planned after it"
      }
      // The field exists for a person's pick, and the composer is never
      // told of it (`composer.md`). Refused rather than dropped: accepting it would hand
      // the composer the one cost lever that is a human's, and dropping it silently
      // would leave a plan that did not do what it said.
      if (out.steps.some((s) => modelOf(s) !== undefined || pieceModelled(s))) {
        return "`model` is not a field a plan entry takes: every step runs on its agent file's `model:`, so leave it off"
      }
      // Deduped and in order, so a plan that names the same missing agent on
      // four steps re-prompts with one name rather than four.
      const named = out.steps.flatMap(agentsNamed)
      const unknown = [...new Set(named)].filter((n) => !agents.has(n))
      if (unknown.length > 0) {
        return `unknown agent(s): ${unknown.join(", ")}. Available: ${[...agents].join(", ")}`
      }
      return (
        waitForRefusal(out.steps, after.deploys) ??
        afterMerge(out.steps, after) ??
        checkAmbiguity(out.ambiguity)
      )
    }),
  )

/**
 * The sentence a write agent is refused with once the branch is in — said at decode,
 * and said again by the runtime when the branch merged between the plan being
 * accepted and the step starting, so the composer reads one reason either way.
 */
export const landedRefusal = (agent: string): string =>
  `\`${agent}\` writes, and this trak's branch has merged: nothing may write to it now. Plan read-only work, or hand what has to change off to a new trak`

/**
 * Where a step's `wait_for` may not go: on a piece of a spawn, which nobody has traced
 * being released from a wait, and as `deployed` on a project with nothing to ask it.
 */
const waitForRefusal = (steps: readonly ProposedStep[], deploys: boolean): string | undefined => {
  if (steps.some((s) => isSpawn(s) && s.children.some((c) => childSteps(c).some(pieceWaits)))) {
    return "`wait_for` is for a step of this plan, not a step of a spawn's piece: put the wait on the step after the spawn"
  }
  if (!deploys && steps.some((s) => waitForOf(s) === "deployed")) {
    return '`wait_for: "deployed"` needs the project\'s deploy script, and this project has none: wait for `merged`, or leave the wait off'
  }
  return undefined
}

const pieceWaits = (s: ChildStep): boolean => s.wait_for !== undefined

/**
 * The branch after a merge is not a base anything may write to — the rule
 * `COMPOSITION.md` states, held here where the composer can be told rather than at
 * the step, where the plan is already approved.
 *
 * Two readings of one rule. A trak that has **landed** takes no write agent anywhere
 * in the plan: the merge already happened. A trak that has not yet is refused a write
 * agent at or **after** a step that waits on the merge, in plan order — one whose agent
 * declares the wait, or one carrying its own `wait_for`: that step runs once the branch
 * is in, and the writer would write to it. A spawn is one position, so a wait inside
 * any of its pieces holds every position after it, and the steps inside one piece hold
 * to the order they run in.
 */
const afterMerge = (steps: readonly ProposedStep[], after: AfterMerge): string | undefined => {
  const writing = (agent: string): boolean => after.writes.has(agent)
  if (after.landed) {
    const writer = steps.flatMap(agentsNamed).find(writing)
    return writer === undefined ? undefined : landedRefusal(writer)
  }
  let waited: Waiter | undefined = undefined
  for (const [i, step] of steps.entries()) {
    // Each sequence runs in order on its own; the pieces of a spawn run beside one
    // another, so each starts from what waited *before* the spawn.
    let waitedAfter: Waiter | undefined = waited
    for (const sequence of sequencesOf(step, i)) {
      const walked = walk(sequence, waited, after)
      if (walked.refused !== undefined) return walked.refused
      waitedAfter ??= walked.waited
    }
    waited = waitedAfter
  }
  return undefined
}

/**
 * One turn as the merge rule reads it: its agent, and — for a step of the plan itself
 * rather than of a piece — its place, counted from one, and the wait it carries.
 */
interface Turn {
  readonly agent: string
  readonly place?: number
  readonly waitFor?: string
}

/** The turn that first waited, and how a refusal names it. */
interface Waiter {
  readonly turn: Turn
  readonly named: string
}

/** The runs of turns an entry holds that happen one after another: one per piece of a spawn. */
const sequencesOf = (s: ProposedStep, i: number): readonly (readonly Turn[])[] => {
  if (isSpawn(s)) return s.children.map((c) => childSteps(c).map((step) => ({ agent: step.agent })))
  if (s.type === "compose") return []
  const waitFor = waitForOf(s)
  return [[{ agent: s.agent, place: i + 1, ...(waitFor === undefined ? {} : { waitFor }) }]]
}

/** The turn's own name in a refusal: its agent, and its step where it is one of this plan's. */
const turnName = (t: Turn): string =>
  t.place === undefined ? `\`${t.agent}\`` : `\`${t.agent}\` at step ${String(t.place)}`

/** What a turn waits on, as a refusal says it, or nothing for a turn that waits on nothing. */
const waiterOf = (t: Turn, after: AfterMerge): Waiter | undefined => {
  if (t.waitFor !== undefined) {
    return { turn: t, named: `${turnName(t)}, which waits for \`${t.waitFor}\`` }
  }
  return after.waits.has(t.agent)
    ? { turn: t, named: `\`${t.agent}\`, which waits on the branch merging` }
    : undefined
}

/** One sequence, from what waited before it: the refusal it earns, or what waits by its end. */
const walk = (
  sequence: readonly Turn[],
  waitedBefore: Waiter | undefined,
  after: AfterMerge,
): { readonly refused?: string; readonly waited?: Waiter } => {
  let waited = waitedBefore
  for (const turn of sequence) {
    // A turn that waits and writes is its own case: the wait is the merge, and the
    // turn after it is the write. The loader refuses such an agent file; this holds
    // the plan, and a step's own `wait_for` on a writer.
    waited ??= waiterOf(turn, after)
    if (waited !== undefined && after.writes.has(turn.agent)) {
      return {
        refused:
          waited.turn === turn
            ? `${turnName(turn)} writes, and it waits on the branch merging: it would run once the branch is in and write to it. Wait with a read-only agent, or hand the writing off to a new trak`
            : `${turnName(turn)} writes, and it comes after ${waited.named}: nothing may write to the branch once it is in. Put the writing before the wait, or hand it off to a new trak`,
      }
    }
  }
  return waited === undefined ? {} : { waited }
}

/**
 * Every agent an entry commits to — one for a turn, one per step of every piece for
 * a spawn, none for a compose.
 *
 * A piece's later steps are named here too, and they have to be: approving the plan
 * commits every one of them, and a name only resolved when that step comes round
 * would strand a child three gates in.
 */
const agentsNamed = (s: ProposedStep): readonly string[] =>
  isSpawn(s)
    ? s.children.flatMap((c) => childSteps(c).map((step) => step.agent))
    : s.type === "compose"
      ? []
      : [s.agent]

/** Does any step of any piece of this spawn name a model — `modelOf`'s question, a level down. */
const pieceModelled = (s: ProposedStep): boolean =>
  isSpawn(s) && s.children.some((c) => childSteps(c).some((step) => step.model !== undefined))
