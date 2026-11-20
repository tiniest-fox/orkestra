/**
 * The plan, as the drawer needs it — where the trak is, how each entry went, and what each
 * entry kept. Which of the agent's turns belongs to which entry is `turns.ts`, because that
 * reads the transcript rather than the plan; assembling the two into the rows a surface
 * draws is `rows.ts`, which is why this file knows nothing about the composer's runs.
 *
 * **Derived, never predicted.** Everything here reads a state the server reported and a
 * log it wrote; nothing infers what happens next. A second copy of the state machine is
 * the mistake this file would be one projection's worth of, and `client-style`'s
 * checklist item 6 is why.
 *
 * `at` is the one fact the whole file turns on, and it comes from `state` alone —
 * ten of the twenty-three states carry a step and the rest do not, which is why it is a
 * `number | undefined` rather than a default.
 */

import type { ComposerOutputDto, EventDto, PlanDto, TrakStateDto } from "../../../api/types"

/**
 * Whether what a composer run returned filled in its own compose entry — which is what
 * makes it a run that happened rather than a turn still owed.
 *
 * **Two answers land one**: a plan, and the answer that says the work is already done.
 * Questions, a prose reply and a failure all leave the entry standing empty, so the run
 * has returned without the plan having moved.
 *
 * One function because two places on this surface ask it and neither is checked against
 * the union — the entry a gate belongs to, and whether a run counts as `done`. Spelled
 * out twice, one of them fails silently. **What is still to come is not a third**: it
 * counts runs against compose entries rather than reading an output, which is already
 * right for an answer that appends no steps — see `stillToCome` in `rows.ts`.
 */
export const landedEntry = (out: ComposerOutputDto): boolean =>
  out.type === "proposal" || out.type === "finished"

/**
 * How one plan entry went.
 *
 * Five, and they are not `Tone` — a tone says how something is *going* and these say
 * where the plan has got to. `stepTone` below is the one place they meet.
 */
export type StepStatus = "done" | "running" | "gate" | "failed" | "todo"

/**
 * The entry the trak is at, or `undefined` when it is at none.
 *
 * Exhaustive over `TrakStateDto`, so a twenty-fourth state is a compile error here
 * rather than a step that silently reports `undefined` and a map with nothing marked.
 */
export const stepAt = (state: TrakStateDto): number | undefined => {
  switch (state._tag) {
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
      return state.step

    // Before a plan exists, and after it has run out. `Failed` is in this list on
    // purpose: it carries no step, and the entry that died is in the log — see
    // `failedStep`.
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return undefined
  }
}

/** Whether the trak is still at the composer — no plan to stand on yet. */
export const planning = (state: TrakStateDto): boolean =>
  state._tag === "Preparing" ||
  state._tag === "Composing" ||
  state._tag === "AwaitingProposal" ||
  state._tag === "AwaitingComposerAnswers"

/**
 * The entry a failed trak died at.
 *
 * `Failed` carries no step — deliberately: the kind is what a human reads and the error
 * is a provider's sentence — so the position comes from the last
 * thing in the log that named one. Last rather than first: a trak can fail, be
 * resumed, and fail again further on.
 */
const failedStep = (log: readonly EventDto[]): number | undefined => {
  const found = log.findLast(
    (e) =>
      (e._tag === "TurnFailed" && e.step !== undefined) ||
      e._tag === "CheckFailed" ||
      e._tag === "EffectFailed" ||
      e._tag === "WorktreeFailed" ||
      e._tag === "SetupFailed" ||
      e._tag === "MergeFailed",
  )
  if (found === undefined) return undefined
  if (found._tag === "TurnFailed") return found.step
  if (found._tag === "CheckFailed") return found.step
  // The step whose work it was sending. The position is behind its own gate by then —
  // the failure is downstream of the commit — and it is still the row a reader wants,
  // because what the script printed is drawn there.
  if (found._tag === "EffectFailed") return found.step
  // The step whose turn a failed setup killed; absent where none was running.
  if (found._tag === "SetupFailed") return found.step
  return undefined
}

/**
 * The gate a log has standing open — the composer's, or one step's.
 *
 * Which one is open decides what a press means, because **a composer gate records a
 * nominal `step: 0`** (`filed.ts` says why) and entry 0 is a real step on every child
 * trak and every trak opened with a named agent. Two readers need the same answer —
 * `failedAt` below, and `stoodAt` in `rows.ts` — so `opensGate` is the one place the set
 * is written down.
 */
export type OpenGate =
  | { readonly _tag: "Composer"; readonly session: string | undefined }
  | { readonly _tag: "Step"; readonly at: number }

/**
 * How one event moves the gate that stands open — `undefined` where it moves it nowhere.
 *
 * **The whole set `decide` opens a gate from, not the three that are obvious.** A walk
 * that knew only `ComposerReturned`, `AgentReturned` and `CheckFailed` was wrong in both
 * directions on any log carrying a stop: `onStopped` parks a stopped re-compose at
 * `AwaitingProposal` — a composer gate no `ComposerReturned` opened — and parks a stopped
 * turn at its step's `conversation` gate, which offers `Skip`. `onChecksCancelled` opens
 * the `checks` gate the same way — listed because the set is what this answers, though it
 * can never change one on its own: checks run only after the step returned, so the gate
 * it opens is at the step `AgentReturned` had already named.
 *
 * **`Stopped.step` is what tells the two apart**, and it is the engine's own fact rather
 * than an inference: `stopRoute` stamps the killed turn's position, and the composer has
 * none. On a log written since `StopRequested` existed it is that event that carries the
 * position, and the `Stopped` after it carries nothing. `FilingAsked` shares the shape and is deliberately not here — it re-enters the
 * step at once rather than opening anything.
 *
 * A press that races the run it is stopping reaches `reparked`, which re-offers the gate
 * already open — at the same position this names, because the turn that was killed is the
 * one whose gate just opened. The one case that disagrees is a stop with no step at a
 * trak still on its first plan, where `reparked` settles on no gate at all; nothing acts
 * on the answer, because a press cannot arrive where there is no gate to make it at.
 */
export const opensGate = (e: EventDto): OpenGate | undefined => {
  if (e._tag === "ComposerReturned") return { _tag: "Composer", session: e.sessionId }
  if (e._tag === "AgentReturned" || e._tag === "CheckFailed" || e._tag === "ChecksCancelled")
    return { _tag: "Step", at: e.step }
  // A bare `Stopped` is a kill ending `Stopping`, which `StopRequested` already named the
  // gate for; it moves nothing.
  if (e._tag === "Stopped" && e.step === undefined && e.sessionId === undefined) return undefined
  if (e._tag === "StopRequested" || e._tag === "Stopped")
    return e.step === undefined
      ? { _tag: "Composer", session: e.sessionId }
      : { _tag: "Step", at: e.step }
  return undefined
}

/**
 * Whether one entry has already run, from the log alone.
 *
 * The three ways an entry gets behind the plan, and they are the engine's own three: a
 * turn returned for it, a person skipped it, or it was a spawn whose children went out.
 * Nothing here is positional, which is the point — this is the case where there is no
 * position to be before.
 */
const ranAt = (log: readonly EventDto[], step: number): boolean =>
  log.some(
    (e) =>
      (e._tag === "AgentReturned" && e.step === step) ||
      (e._tag === "ChildrenSpawned" && e.step === step) ||
      (e._tag === "HumanActed" && e.step === step && e.action._tag === "Skip"),
  )

/**
 * Whether one entry ran and failed, and nothing has answered the failure since — from
 * the log alone, for the same case `ranAt` serves.
 *
 * **The failure nothing came back from, not the latest one.** `failedStep` takes the
 * last failure in the log because a `Failed` trak is standing at it; at rest the trak is
 * standing nowhere, and a step that failed, was resumed and returned has a failure in its
 * past and nothing wrong with it now. So this walks the log in order and lets any of the
 * events that move the entry on — a turn returning, a person approving or skipping it,
 * its checks passing, its effects running, its pieces going out — clear the failure
 * before it. What is left set is a failure the trak was archived on top of.
 *
 * **A press answers the gate that was open, not the step it records.** A composer gate
 * records a nominal `step: 0` (`stoodAt` in `rows.ts` asks the same question, and
 * `filed.ts` says why the engine writes it), and entry 0 is a real step on every child
 * trak and every trak opened with a named agent — so read off `HumanActed.step`,
 * approving the plan cleared a failure on the first step nobody had looked at. Which
 * gate is open is `opensGate`'s, which is where the set of events that move it lives.
 */
const failedAt = (log: readonly EventDto[], step: number): boolean => {
  let failed = false
  let composerGate = false
  for (const e of log) {
    const opened = opensGate(e)
    if (opened !== undefined) composerGate = opened._tag === "Composer"
    if (!("step" in e) || e.step !== step) continue
    switch (e._tag) {
      case "TurnFailed":
      case "CheckFailed":
      case "EffectFailed":
      // A setup that failed while this step's turn ran, and killed it.
      case "SetupFailed":
        failed = true
        break
      case "AgentReturned":
      case "ChildrenSpawned":
      case "ChecksPassed":
      case "EffectsRan":
        failed = false
        break
      case "HumanActed":
        if (!composerGate && (e.action._tag === "Approve" || e.action._tag === "Skip"))
          failed = false
        break
      // Listed rather than defaulted, so a new event that names a step has to say here
      // whether it answers a failure. None of these does: a restart or a stop is the
      // trak being driven, an archive that names the step it killed a turn at is the
      // trak being ended, and the rest are facts beside it.
      case "Abandoned":
      case "ChecksCancelled":
      case "ChildLanded":
      case "ChildRefiled":
      case "ChildrenJoined":
      case "ConditionsMet":
      case "ConditionsUnmet":
      case "FilingAsked":
      case "HandedOff":
      case "GoalOpened":
      case "Restarted":
      case "StepRefused":
      case "StopRequested":
      case "Stopped":
      case "WaitSkipped":
      case "WorkCommitted":
        break
    }
  }
  return failed
}

/**
 * How every entry in the plan went.
 *
 * The rule is positional and deliberately dumb: everything before where the trak is has
 * happened, everything after has not, and the entry it is at takes its status from the
 * state's own tag. **A skipped step therefore reads as `done`**, which is honest — the
 * plan moved past it — and the log line saying it was skipped is what says otherwise.
 *
 * **Thirteen of the twenty-three states carry no position, and the plan is over in none
 * of them — the at-rest states included.** `Composing` and `AwaitingProposal` are the
 * composer being asked again with work behind it; `Failed` is deliberately step-less, and
 * a failure with no step to blame — an action that does not apply where the trak stands —
 * reaches none of `failedStep`'s three events; a `Finished` trak may be waiting on a
 * condition with a step still to run, and a trak archived mid-plan has entries nothing
 * reached. A single verdict for the whole plan was wrong both ways: it greyed out every
 * step that had returned, passed its checks and committed, and it drew a held step green
 * under a flag. So with no position each entry answers for itself out of the log —
 * `ranAt` is the engine's own three ways of getting behind the plan, and it is right at
 * rest as much as anywhere. **A failure is asked first**: the entry a trak stopped at
 * has usually also returned once, and `ranAt` alone read it *done* — or, where the turn
 * itself died, *not started* over a whole transcript. `failedAt` is what tells a failure
 * the trak was archived on from one it was resumed past.
 */
export const stepStatuses = (
  state: TrakStateDto,
  log: readonly EventDto[],
  count: number,
): readonly StepStatus[] => {
  const here = stepAt(state)
  const died = state._tag === "Failed" ? failedStep(log) : undefined
  const mark = here ?? died

  return Array.from({ length: count }, (_, i): StepStatus => {
    if (mark === undefined) return failedAt(log, i) ? "failed" : ranAt(log, i) ? "done" : "todo"
    if (i < mark) return "done"
    if (i > mark) return "todo"
    if (died !== undefined) return "failed"

    switch (state._tag) {
      case "AwaitingHuman":
        return "gate"
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
        return "running"

      // Reachable only through `died`, which the branch above has already answered —
      // listed rather than defaulted so a new state has to say what it looks like here.
      case "Preparing":
      case "Composing":
      case "AwaitingProposal":
      case "AwaitingComposerAnswers":
      case "Integrating":
      case "Abandoning":
      case "Finished":
      case "Merging":
      case "Closing":
      case "Closed":
      case "Merged":
      case "Abandoned":
      case "Failed":
        return "todo"
    }
  })
}

/**
 * How one of the composer's runs went.
 *
 * It cannot come from `stepStatuses` — that walks `steps`, and the composer is what
 * produced them. So it reads the state, with one fact from the log: whether *this run's
 * session* ever **landed its entry**. That is what tells a trak whose later step failed
 * from one that never got a plan at all, and both are `Failed` on the state.
 *
 * **Landed, not merely replied.** `ComposerReturned` is written for questions too, so a
 * run that asked one and was never answered has returned — and a compose entry the plan
 * stopped at would read `done` off a turn that produced nothing. Its own entry is still
 * sitting there unfilled, which is the state that has to survive being drawn. Two answers
 * land one: a plan, and the answer that says the work is already done — that one appends
 * no steps, and a run of it drawn as *not started* is the quiet way this goes wrong.
 *
 * **`live` is what makes it per-run.** The state describes the newest run and no other,
 * so an earlier one is settled and answers from the log alone. Asking the state about a
 * run it has moved past is how a re-compose that failed after an earlier compose
 * succeeded used to read `done`: `composed` was a global *has one ever returned*, and one
 * always had.
 *
 * **`session` is `undefined` where no session has landed this entry** — `rows.ts` reads
 * which one did off the log — and then nothing has: the placeholder row a trak with no
 * composer turns draws, a run still out or still asking, and the entry something asked
 * for whose turn has not started. That last one is written the moment a step raises work
 * and stands in the plan while the person decides at the step's own gate; read against
 * *has any run landed*, it drew `done` off the plan that preceded it, before the composer
 * had been asked at all.
 */
export const composerStatus = (
  state: TrakStateDto,
  log: readonly EventDto[],
  session: string | undefined,
  live: boolean,
): StepStatus => {
  const returned = (e: EventDto): boolean =>
    e._tag === "ComposerReturned" && landedEntry(e.output) && e.sessionId === session
  const composed = session !== undefined && log.some(returned)

  // A run the trak has moved past cannot be running, and nobody is standing at its gate.
  if (!live) return composed ? "done" : "failed"

  switch (state._tag) {
    case "Preparing":
    case "Composing":
      return "running"

    // The composer's own turn being stopped is still that turn; a step's is past the plan.
    case "Stopping":
      return state.step === undefined ? "running" : composed ? "done" : "todo"

    // Both are a human standing in front of the composer's output — the plan itself,
    // or the questions it asked before writing one.
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
      return "gate"

    // Everything past the plan. `composed` is what keeps a trak that died before the
    // composer returned from claiming it had a plan.
    case "AgentWorking":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return composed ? "done" : "todo"

    case "Failed":
      return composed ? "done" : "failed"
  }
}

/**
 * The one place a plan status becomes words, and it is written for a screen reader.
 *
 * **Inside a trak, how a position is going is the square's colour and the segment
 * travelling its edge — and that is all it is.** The glyph that used to say it belongs to
 * the agent now, so this is where the fact goes for anyone who cannot see either: every
 * position's press names it, and nothing draws it. A status word back on the row would
 * cost the caption its measure and put on screen exactly what was just taken off it.
 *
 * `todo` is *not started* rather than *pending*: the plan has an entry there and nothing
 * has reached it, which is a fact about the plan rather than a promise about the queue.
 */
export const statusText = (s: StepStatus): string => {
  switch (s) {
    case "done":
      return "done"
    case "running":
      return "running"
    case "gate":
      return "waiting for you"
    case "failed":
      return "failed"
    case "todo":
      return "not started"
  }
}

/** The one place a plan status becomes a tone. Nothing else may map these. */
export const stepTone = (s: StepStatus): "neutral" | "working" | "waiting" | "good" | "bad" => {
  switch (s) {
    case "done":
      return "good"
    case "running":
      return "working"
    case "gate":
      return "waiting"
    case "failed":
      return "bad"
    case "todo":
      return "neutral"
  }
}

/**
 * What an entry kept on the branch, if anything.
 *
 * `WorkCommitted.sha` is the branch tip after that commit rather than a commit the step
 * necessarily produced — `Vcs.commitWork` is re-runnable and reads its answer off the
 * branch — so two entries in a row that changed nothing report the same sha. That is
 * the wire's own caveat, not this file's, and the map shows what the log says.
 */
export const keptAt = (log: readonly EventDto[], step: number): string | undefined => {
  const found = log.findLast(
    (e) => e._tag === "WorkCommitted" && e.step === step && e.sha !== undefined,
  )
  // `findLast` does not narrow the union, so the tag is re-checked rather than asserted.
  return found?._tag === "WorkCommitted" ? found.sha : undefined
}

/**
 * What the composer's row is doing, in its own words.
 *
 * The plan's title is the composer's one-line answer to *what did you decide to do*, so
 * it is the caption once there is one. Before that there is nothing to report, and
 * saying so beats a blank where every other row has a caption. One function because two
 * surfaces show it — the map's first row and the bar, when you are standing there.
 */
export const composerCaption = (plan: PlanDto | undefined): string =>
  plan?.title ?? "Working out what to do"
