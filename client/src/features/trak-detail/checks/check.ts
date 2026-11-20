/**
 * One run of one check, as the card that filed the work draws it.
 *
 * **Two sources and neither is enough on its own.** `TrakDetailDto.check` is the daemon's
 * memory of the newest run on this trak — the only thing that carries live output, a
 * ceiling and a duration — and it is gone when the engine restarts. `CheckFailed` is on
 * the log and outlives everything, and it says nothing about how long the run took. So a
 * failure is drawn from whichever of the two is in hand, and a run that passed is drawn
 * only while the memory of it lasts.
 *
 * **And the log is what pairs them.** The daemon's run carries a position and no turn, so
 * it cannot say which of a re-entered position's documents it judged — `filed.ts`'s
 * `settledByTurn` says, by putting each `CheckFailed` and each `ChecksPassed` in the
 * window of the turn it followed. `judges` below is the whole of the matching.
 *
 * **A run nothing can fill draws no strip at all.** A pass that the daemon has forgotten
 * leaves `ChecksPassed{ran}` on the log and no output whatever, and the surface it would
 * buy is a tab leading to an empty console — so `runOf` answers `undefined` there and the
 * card is exactly what a card with no check is. What that costs is one thing: a position
 * whose check passed loses its strip when the engine restarts.
 */

import type { CheckRunDto, PlaceDto } from "../../../api/types"
import type { Tone } from "../../../format/tone"
import { withoutRoot } from "../../../format/paths"
import type { Settled } from "../filed"

/**
 * Where a run got to. Not `Tone` — the tone is what this looks like, below.
 *
 * `cancelled` is a person having ended the run, and `skipped` is a person's switch having
 * kept it from starting: neither is a verdict, and a card drawing either as one would say
 * something about the work that nothing has said. `reused` is a verdict — a pass over
 * exactly these files, taken from an earlier run — with nothing of this run's to show.
 */
export type CheckPhase = "running" | "passed" | "failed" | "cancelled" | "skipped" | "reused"

/** Which side of the card is showing. */
export type Face = "gate" | "document"

/**
 * What a person pressed, and the phase they pressed it in.
 *
 * **A press belongs to the run as it stood**, which is what lets both rules hold at once:
 * a reader who went to the document while a check ran stays there, and the moment the run
 * settles the card follows its own rule again — back to the document on a pass, and onto
 * the evidence on a failure, which is not optional.
 */
export interface Chosen {
  readonly phase: CheckPhase
  readonly face: Face
}

export interface CheckRun {
  /** The check's own name, from its filename — `verify`. */
  readonly name: string
  /** The line as spawned, cut back to the checkout. Absent on a log written before it. */
  readonly command: string | undefined
  readonly phase: CheckPhase
  /** Everything it has printed. Grows while it runs; empty on a run that printed nothing. */
  readonly output: string
  /** The check file's `timeout_seconds`. Absent on a run read off the log. */
  readonly limit: number | undefined
  /** Epoch milliseconds. Absent on a run read off the log. */
  readonly startedAt: number | undefined
  /** Seconds it took, on a settled run the daemon still holds. */
  readonly took: number | undefined
  /** Absent for a timeout, for a check that could not be spawned, and on an old log. */
  readonly exitCode: number | undefined
  /** How many times this check has failed at this position. Zero where it has not. */
  readonly attempts: number
  /**
   * Where it ran — the daemon's copy while it holds the run, the log's after. The log
   * carries it only on a failure, which is the one run the log can draw at all.
   */
  readonly place: PlaceDto | undefined
}

/**
 * Whether the daemon's run is the one that judged this turn's document.
 *
 * **A run that has ended says so on the log, and that is the only thing allowed to pair
 * it.** The daemon holds one run per trak with a position on it and no turn, so *which
 * document did this judge* cannot be answered from the run — a re-entered position has
 * several documents at that position, and the newest of them is by construction the one
 * no check has run over yet. So a settled run belongs to this turn only where this turn's
 * own window holds the settlement that matches its outcome. Asking the run instead is
 * what drew a green `verify passed` over work nothing had checked.
 *
 * **A run still in flight is the exception, and it is not a guess.** `decide` issues
 * `RunChecks` from its `artifact` arm on what was just filed, so a check in flight is
 * always over the newest document — which is the one the caller offers this for.
 *
 * The cost is one redraw. `CheckEnded` reaches a watcher before the `Appended` carrying
 * the settlement it corresponds to, so for the gap between them a just-ended run matches
 * nothing and the card draws no strip. An absence for one frame is the direction to be
 * wrong in: the failure this replaces was a verdict that was not true.
 */
const judges = (live: CheckRunDto, settled: Settled | undefined): boolean => {
  if (live.finished === undefined) return true
  switch (live.finished.verdict) {
    case "passed":
      return settled?._tag === "Passed"
    case "failed":
      return settled?._tag === "Failed"
    case "cancelled":
      return settled?._tag === "Cancelled"
  }
}

/** The phase a settled run of the daemon's is in, from the verdict it reported. */
const phaseOf = (verdict: NonNullable<CheckRunDto["finished"]>["verdict"]): CheckPhase => {
  switch (verdict) {
    case "passed":
      return "passed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
  }
}

/**
 * A run the log alone knows about, with nothing the daemon would have had: no output, no
 * ceiling, no duration. `Passed` draws nothing at all — see the note at the head of this
 * file — and the two a person caused draw a strip with the verdict line saying so, because
 * the absence is the fact the card exists to show.
 */
const offLog = (settled: Settled): CheckRun | undefined => {
  const bare = {
    command: undefined,
    output: "",
    limit: undefined,
    startedAt: undefined,
    took: undefined,
    exitCode: undefined,
    place: undefined,
  }
  switch (settled._tag) {
    case "Passed":
      return undefined
    case "Skipped":
      return { ...bare, name: settled.names.join(", "), phase: "skipped", attempts: 0 }
    case "Reused":
      return { ...bare, name: settled.names.join(", "), phase: "reused", attempts: 0 }
    case "Cancelled":
      // `checks` where the press raced the run starting and the engine had no name.
      return { ...bare, name: settled.name ?? "checks", phase: "cancelled", attempts: 0 }
    case "Failed": {
      const failed = settled.failed
      return {
        ...bare,
        name: failed.name,
        command: failed.command,
        phase: "failed",
        output: failed.output,
        exitCode: failed.exitCode,
        attempts: failed.attempts,
        place: failed.place,
      }
    }
  }
}

/**
 * The run to draw over one turn's document, from the log's account of it and the daemon's.
 *
 * Two sources, asked in that order: the daemon's copy where it judged this document, since
 * it is the only one carrying output, a ceiling and a duration; then the log's, which is
 * all a failure has left once the daemon has forgotten the run. A pass has nothing on the
 * log to fall back to, so it draws nothing at all — see the note at the head of this file.
 */
export const runOf = (
  /** How this turn's check came out, off the log. `filed.ts` does the window arithmetic. */
  settled: Settled | undefined,
  /** The daemon's newest run, where it is this position's and this is the newest document. */
  live: CheckRunDto | undefined,
  /** The checkout the run happened in, taken off the front of the command. */
  root: string | undefined,
): CheckRun | undefined => {
  const failed = settled?._tag === "Failed" ? settled.failed : undefined
  if (live !== undefined && judges(live, settled))
    return {
      name: live.name,
      command: withoutRoot(live.command, root),
      phase: live.finished === undefined ? "running" : phaseOf(live.finished.verdict),
      output: live.output,
      limit: live.limit,
      startedAt: live.startedAt,
      took:
        live.finished === undefined
          ? undefined
          : Math.max(0, Math.round((live.finished.at - live.startedAt) / 1000)),
      exitCode: live.finished?.exitCode,
      attempts: failed?.attempts ?? 0,
      place: live.place,
    }
  if (settled === undefined) return undefined
  const off = offLog(settled)
  return off === undefined
    ? undefined
    : { ...off, command: off.command === undefined ? undefined : withoutRoot(off.command, root) }
}

/**
 * `1m12s`, `5m00s`, `41s`.
 *
 * Zero-padded past the minute and closed up, unlike `format/activity`'s `1m 52s`: this one
 * is read against a ceiling in the same line — `1m12s of 5m00s` — and two durations that
 * change width as they count are a number that moves while you watch it.
 */
export const clock = (seconds: number): string =>
  seconds < 60
    ? `${String(seconds)}s`
    : `${String(Math.floor(seconds / 60))}m${String(seconds % 60).padStart(2, "0")}s`

/**
 * The one line of fact about the run, at the right of the strip.
 *
 * Every part of it is dropped where the run does not have it rather than guessed at: a
 * failure off the log has no duration and says none, and a timeout has no exit code —
 * `verify failed · exit undefined` would read as a fact.
 */
export const verdictText = (run: CheckRun, now: number): string => {
  switch (run.phase) {
    case "running": {
      const from = run.startedAt
      // The browser's clock and the engine's disagreeing, which is not a negative
      // duration — the same answer `elapsedText` gives it.
      const elapsed = from === undefined || now < from ? undefined : Math.floor((now - from) / 1000)
      if (elapsed === undefined) return run.name
      return `${run.name} · ${clock(elapsed)}${run.limit === undefined ? "" : ` of ${clock(run.limit)}`}`
    }
    case "passed":
      return run.took === undefined
        ? `${run.name} passed`
        : `${run.name} passed · ${clock(run.took)}`
    case "failed":
      return run.exitCode === undefined
        ? `${run.name} failed`
        : `${run.name} failed · exit ${String(run.exitCode)}`
    // *By you* rather than *cancelled*: a run somebody ended is a thing they did, not a
    // thing that went wrong, and the line says who.
    case "cancelled":
      return run.took === undefined
        ? `${run.name} ended by you`
        : `${run.name} ended by you · ${clock(run.took)}`
    case "skipped":
      return "checks skipped"
    case "reused":
      return `${run.name} passed before on these files`
  }
}

/**
 * What the verdict is, in the closed vocabulary. Exhaustive so a new phase is an error.
 *
 * A run a person ended is `neutral` — not the failure's red, and not `waiting` either:
 * what is owed at the gate it parks at is the presses' to say. A skipped run is `waiting`
 * because the absence is what a reader has to weigh before taking the work.
 */
export const verdictTone = (phase: CheckPhase): Tone => {
  switch (phase) {
    case "running":
      return "working"
    case "passed":
      return "good"
    case "failed":
      return "bad"
    case "cancelled":
      return "neutral"
    case "skipped":
      return "waiting"
    case "reused":
      return "good"
  }
}

/**
 * Which face the card opens on when nobody has pressed anything.
 *
 * **A failure is on the gate whatever else is true.** That is settled rather than
 * configurable: the press on offer takes work a script says is wrong, so the evidence is
 * not optional. A run a person ended is on the gate for the same reason: what it printed
 * before the kill is the only evidence there is.
 */
export const autoFace = (run: CheckRun): Face =>
  run.phase === "passed" || run.phase === "skipped" || run.phase === "reused" ? "document" : "gate"

/**
 * Whether the run has a console behind its gate face. A skipped run and a reused one
 * have none — nothing ran this time — and the strip draws that tab unpressable.
 */
export const hasConsole = (run: CheckRun): boolean =>
  run.phase !== "skipped" && run.phase !== "reused"

/**
 * The face showing, which is what a person picked while the run stood as it does now.
 *
 * A run with no console is on the document whatever was pressed, so a press that reached
 * the unpressable tab anyway lands there.
 */
export const faceFor = (run: CheckRun, chosen: Chosen | undefined): Face =>
  !hasConsole(run) ? "document" : chosen?.phase === run.phase ? chosen.face : autoFace(run)

/**
 * What is being asked, under a console holding a failure.
 *
 * Only where there is a press on the table: this is the `checks` gate's sentence and it
 * describes what the two things a person can do here would do. A superseded attempt's
 * failure is history and has nothing to offer.
 *
 * The count is what makes it a gate rather than another loop — reaching this point means
 * the engine has stopped paying for retries.
 */
export const askedText = (attempts: number): string =>
  `${attempts > 1 ? `Ran ${String(attempts)} times and failed each time. ` : ""}Approving takes the work anyway; replying sends the agent back with what you say.`

/**
 * The same sentence under a console a person ended: the gate is the one a failure opens,
 * so the two presses do the same two things, and the first clause says why they are here.
 */
export const endedText =
  "You ended the run before it finished. Approving takes the work anyway; replying sends the agent back with what you say."

/**
 * What the card's body says about checks that did not run — the second of the two places
 * it is said, because the band's line is read at a glance and this is read.
 */
export const skippedText = (names: readonly string[]): string =>
  `${listed(names)} did not run. This step was accepted without ${names.length === 1 ? "it" : "them"}.`

/** Check names as a sentence lists them — *a, b and c* — shared with the panel's foot. */
export const listed = (names: readonly string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`
