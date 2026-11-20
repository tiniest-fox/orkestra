/**
 * A check the agent ran through the engine's check tool, as its card in the transcript
 * draws it: where it stands, and what it printed.
 *
 * **Two sources, as a document's check has.** The `Check` line on the transcript is the
 * account that outlives everything, and it says where the call stands and nothing else.
 * The daemon's run is the only thing holding output, a ceiling and a duration, and it is
 * this call's only while its `call` is the line's — the daemon holds one run per trak, so
 * the engine's own run after the turn replaces it.
 */

import type { CheckEntryDto, CheckRunDto } from "../../../../api/types"
import type { Tone } from "../../../../format/tone"
import { withoutRoot } from "../../../../format/paths"
import { clock } from "../../checks/check"

/**
 * Where the call got to. `unrecorded` is a pass the files moved under, which the engine
 * kept nowhere; `stopped` is a run the turn's end took with it — both are said in words,
 * and neither is a verdict on the work.
 */
export type CallPhase =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "unrecorded"
  | "reused"
  | "stopped"

export interface CheckCall {
  readonly name: string
  readonly phase: CallPhase
  /** What it printed. Empty where the daemon holds nothing for this call. */
  readonly output: string
  /** The line as spawned, cut back to the checkout. */
  readonly command: string | undefined
  /** Epoch milliseconds the run, or its wait, began. */
  readonly startedAt: number | undefined
  /** Seconds it took, on a run that ended while the daemon still holds it. */
  readonly took: number | undefined
  readonly exitCode: number | undefined
}

/** The newest line's outcome, where the call has one. */
const settled = (outcome: NonNullable<CheckEntryDto["outcome"]>): CallPhase =>
  outcome === "ended" ? "stopped" : outcome

/**
 * The call as its card draws it.
 *
 * A line with no outcome on a turn nothing is driving is a call that never answered —
 * the turn ended, or the engine did, under it — so it is `stopped` rather than a run
 * counting up forever.
 */
export const checkCallOf = (
  line: CheckEntryDto,
  live: CheckRunDto | undefined,
  driving: boolean,
  root: string | undefined,
): CheckCall => {
  const run = live?.call === line.call ? live : undefined
  const phase: CallPhase =
    line.outcome !== undefined
      ? settled(line.outcome)
      : !driving
        ? "stopped"
        : run?.queued === true
          ? "queued"
          : "running"
  return {
    name: line.name,
    phase,
    output: phase === "reused" ? "" : (run?.output ?? ""),
    command: run === undefined ? undefined : withoutRoot(run.command, root),
    startedAt: run?.startedAt,
    took:
      run?.finished === undefined
        ? undefined
        : Math.max(0, Math.round((run.finished.at - run.startedAt) / 1000)),
    exitCode: run?.finished?.exitCode,
  }
}

/** Whether the card has a console to open: nothing ran on a reused pass. */
export const hasConsole = (call: CheckCall): boolean =>
  call.phase === "queued" || (call.phase !== "reused" && call.output !== "")

/** Open while it waits or runs, and on what a reader has to see — a failure or a stop. */
export const opensOn = (phase: CallPhase): boolean =>
  phase === "queued" || phase === "running" || phase === "failed" || phase === "stopped"

export const callTone = (phase: CallPhase): Tone => {
  switch (phase) {
    case "queued":
    case "running":
      return "working"
    case "passed":
    case "reused":
      return "good"
    case "failed":
      return "bad"
    case "unrecorded":
      return "waiting"
    case "stopped":
      return "neutral"
  }
}

/** Seconds since `from`, or nothing where the two clocks disagree. */
const since = (from: number | undefined, now: number): string | undefined =>
  from === undefined || now < from ? undefined : clock(Math.floor((now - from) / 1000))

const after = (words: string, took: number | undefined): string =>
  took === undefined ? words : `${words} · ${clock(took)}`

/**
 * The words at the header's right end. `short` is the phone's, where the header has room
 * for a verdict and a number and no more.
 */
export const callWords = (call: CheckCall, now: number, short: boolean): string => {
  switch (call.phase) {
    case "queued": {
      const waited = since(call.startedAt, now)
      return waited === undefined ? "Queued" : `Queued · ${waited}`
    }
    case "running": {
      const ran = since(call.startedAt, now)
      return ran === undefined ? "Running" : `Running · ${ran}`
    }
    case "passed":
      return after("passed", call.took)
    case "failed":
      return call.exitCode === undefined ? "failed" : `failed · exit ${String(call.exitCode)}`
    case "unrecorded":
      return short ? "passed · not recorded" : "passed · not recorded, files changed during the run"
    case "reused":
      return short ? "passed before" : "passed before on these files"
    case "stopped":
      return short ? "ended with the turn" : after("ended with the turn", call.took)
  }
}
