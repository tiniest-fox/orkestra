// logic: what a trak looks like written down, from the DTOs alone.
//
// Everything here used to read the engine's own types, one import away from the state
// machine. It reads the wire now, which is the same move `client/src/format/` made and
// for the same reason: a surface that can reach the domain will, and then two things
// decide what a gate is.
//
// **Every switch over a wire union is exhaustive**, so a state the daemon grows is a
// compile error here rather than a command that silently treats it as terminal and
// exits. That is the one guard this file exists to keep.

import type { ComposerOutputDto, EntryDto, PlanDto, StepOutputDto } from "@orkestra/shared/dto/log"
import type { TrakStateDto } from "@orkestra/shared/dto/trak"

/** What names an entry: its agent, the fact that it is several, or the composer. */
const entryName = (entry: EntryDto): string =>
  entry.type === "compose" ? "compose" : entry.type === "spawn" ? "spawn" : entry.agent

/**
 * What an entry files under — `1-review`, `2-spawn`.
 *
 * The same shape the engine's `artifactKey` writes, restated here because this module
 * may not reach it. Two copies of a naming rule is a real cost; the alternative was a
 * client that could reach into `workflow/`, which is a larger one.
 */
export const artifactKeyOf = (entry: EntryDto, index: number): string =>
  `${String(index)}-${entryName(entry)}`

/** What an entry was told to do. Absent for a compose the engine appended itself. */
export const instructionOf = (entry: EntryDto): string | undefined => entry.instruction

/** `step 1/3 · 1-review`. Every line that names a step uses this, so they align. */
export const stepLabel = (plan: PlanDto | undefined, step: number): string => {
  const entry = plan?.steps[step]
  const name = entry === undefined ? "?" : artifactKeyOf(entry, step)
  const total = plan === undefined ? "" : `/${String(plan.steps.length)}`
  return `step ${String(step)}${total} · ${name}`
}

/**
 * `AgentWorking(1)` — the tag alone made two consecutive steps indistinguishable.
 *
 * A `Failed` shows its *kind* and not its error: this is padded into a column by the
 * live transition line and printed inline by `list`, and an error is arbitrary prose
 * that may well have newlines in it. What the kind buys on its own is telling "the
 * network went, try again" from "this is a bug and a retry lands in the same place".
 */
export const stateLabel = (state: TrakStateDto): string => {
  if (state._tag === "Failed") return `Failed(${state.kind})`
  return "step" in state ? `${state._tag}(${String(state.step)})` : state._tag
}

/**
 * Which reduction the engine made to reach this state.
 *
 * The live commentary used to print `decision._tag` because it was standing inside
 * `advance`. From out here it is a function of the state that came back — parked states
 * are an `Await`, states nothing moves from are a `Settle`, and everything else was an
 * `Advance`. Exhaustive, so a new state has to be classified rather than defaulted.
 */
export const decisionOf = (state: TrakStateDto): "Advance" | "Await" | "Settle" => {
  switch (state._tag) {
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AwaitingHuman":
    // Parked on traks rather than on a person, but parked: the engine does nothing
    // further here on its own.
    case "AwaitingChildren":
      return "Await"
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return "Settle"
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Closing":
    case "Merging":
      return "Advance"
  }
}

/** What a human can be asked. Not the same set as the gate kinds — see `decide`. */
export type Ask =
  | "plan"
  | "approval"
  | "answers"
  | "checks"
  | "stuck"
  | "conversation"
  | "permission"

export interface Parked {
  readonly title: string
  readonly ask: Ask
  /** What `HumanActed` records. Nominal at the plan gates, where nothing has run. */
  readonly step: number
}

const GATE: Record<Exclude<Ask, "plan">, string> = {
  approval: "the step's work. approve to keep it and carry on",
  answers: "the agent asked you something. it waits until you answer",
  checks: "a check keeps failing and the step is not fixing it. approve to take it anyway",
  stuck: "the step could not do the work. nothing is filed, and nothing plans from this",
  conversation: "the step is talking it through. nothing is filed yet",
  permission: "the step asks to run a command that was refused. it waits until you answer",
}

/**
 * The gate a trak is sitting at, or `undefined` if it is working or done.
 *
 * Exhaustive on purpose: a new parked state is a compile error here, which is the only
 * thing that stops a command silently treating one as terminal and exiting.
 */
export const parkedAt = (state: TrakStateDto, plan: PlanDto | undefined): Parked | undefined => {
  switch (state._tag) {
    case "AwaitingProposal":
      return {
        title: `THE PLAN · ${String(plan?.steps.length ?? 0)} step(s) — approve to start, or say what to change`,
        ask: "plan",
        step: 0,
      }
    case "AwaitingComposerAnswers":
      return {
        title: "THE PLAN · the composer cannot plan without an answer",
        ask: "answers",
        step: 0,
      }
    case "AwaitingHuman":
      return {
        title: `${stepLabel(plan, state.step)} · ${state.kind.toUpperCase()} — ${GATE[state.kind]}`,
        ask: state.kind,
        step: state.step,
      }
    // A spawn has no gate of its own — each child gated its own work, and what is owed
    // here is N traks running, which the daemon is doing.
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Closing":
    case "Merging":
    // A trak holding its checkout is not at a gate: nothing is being asked, and what it
    // offers — merge, archive, re-enter — is a command rather than an answer.
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return undefined
  }
}

/** True once the engine will do nothing further on its own. Not "this trak is over". */
export const atRest = (state: TrakStateDto): boolean =>
  state._tag === "Finished" ||
  state._tag === "Closed" ||
  state._tag === "Merged" ||
  state._tag === "Abandoned"

/** Indented, so a multi-line artifact still reads as one block. */
export const block = (text: string): string =>
  text
    .split("\n")
    .map((line) => `│   ${line}`)
    .join("\n")

const sections = (record: Readonly<Record<string, string>>): string =>
  Object.entries(record)
    .map(([title, body]) => `## ${title}\n\n${body}`)
    .join("\n\n")

const requirements = (
  filed:
    | readonly {
        readonly text: string
        readonly source: string
        readonly kind?: string | undefined
      }[]
    | undefined,
  /**
   * Whether entries on THIS envelope can reach the composer at all.
   *
   * The mark answers *does approving this buy a planning turn*, and routing is a
   * property of the envelope as much as of the kind: the engine only asks an
   * artifact what it raised, so a `stuck` account's requirements land on the intent
   * and the trak stops in front of a person whatever they are marked. A renderer
   * reading `kind` alone drew the promise on the one shape that cannot keep it.
   */
  routes: boolean,
): string =>
  filed === undefined || filed.length === 0
    ? ""
    : `## Requirements recorded\n\n${filed
        .map(
          // Marked on the entry rather than lifted into the section above, which is
          // for what a step said about somebody else's document. Only this kind sends
          // the plan back, and a gate that drew all five alike would say approving
          // buys a planning turn when four times in five it does not.
          (d) =>
            `- ${routes && d.kind === "unplanned_work" ? "(redraws the plan)  " : ""}${d.text}${d.source === "assumed" ? "  (assumed)" : ""}`,
        )
        .join("\n")}\n\n`

/**
 * Whatever the agent last said, written out.
 *
 * In full, deliberately. Truncating is fine for a trace and useless for the thing you
 * are being asked to approve.
 */
export const show = (out: ComposerOutputDto | StepOutputDto): string => {
  switch (out.type) {
    // The agent answered rather than producing work, so the gate below is the one that
    // was already there and the artifact it is about has scrolled up.
    case "message":
      return out.text

    case "artifact": {
      // What sends the plan back goes above everything else, because it is the one
      // thing here about what happens *next* — approving keeps the work, then asks
      // the composer what the rest of the plan should be. `uncovered_work` is what a
      // stored envelope wrote before the channels merged, and reads the same way.
      const sentBack = [
        ...(out.corrections ?? []).map((c) => `- \`${c.at}\` — ${c.text}`),
        ...(out.uncovered_work ?? []),
      ]
      const back =
        sentBack.length === 0
          ? ""
          : `## What this sends back\n\n${sentBack.join("\n")}\n\nApproving keeps this work, then asks the composer what the rest of the plan should be.\n\n`
      return `${back}${requirements(out.requirements, true)}${sections(out.sections)}`
    }

    // Not a document, and the framing says so first: what is here is an account of why
    // there is no work, and the diagnosis in it is a guess by an agent that is stuck.
    case "stuck":
      return `could not do the work — this is its account, not a finding\n\n${sections({
        Tried: out.tried,
        Happened: out.happened,
        Diagnosis: out.diagnosis,
      })}\n\n${requirements(out.requirements, false)}`

    case "proposal":
      return [
        out.title,
        ...(out.rationale === undefined ? [] : ["", out.rationale]),
        "",
        ...out.steps.map((s, i) => `${String(i)}. ${artifactKeyOf(s, i)}\n   ${s.instruction}`),
      ].join("\n")

    // Rendered beside the prompt that collects each answer, not here.
    case "questions":
      return ""

    // The command in full and on its own line: it is what a yes allows, byte for byte.
    case "permission":
      return `asks to run a command that was refused\n\n    ${out.command}\n\n${out.reason}`

    case "failed":
      return `gave up: ${out.error}`

    // No plan, and no gate below it either: the trak comes to rest as this is drawn.
    case "finished":
      return `nothing left to plan: ${out.reason}`
  }
}
