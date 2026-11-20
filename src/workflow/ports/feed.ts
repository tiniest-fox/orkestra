import { Context, Data, type Effect, type Scope, type Stream } from "effect"
import type { CliUsage } from "../../agent/types/plan-usage.js"
import type { Estimate, Usage } from "../../agent/types/usage.js"
import type { TranscriptEntry } from "../../agent/types/transcript-entry.js"
import type { PreparingPhase } from "../../vcs/types/preparing.js"
import type { Event } from "../domain/event.js"
import type { GoalId, Trak, TrakId } from "../domain/trak.js"
import type { CheckRun } from "./checks.js"
import type { HostedRun } from "./hosted-processes.js"
import type { Holder } from "./runs.js"
import type { Outage } from "./outages.js"
import type { SeamStatus } from "./seam-status.js"

/**
 * One thing that happened, as a watcher sees it.
 *
 * **Every frame carries a count only its publisher knows, and re-reading is what a
 * watcher does when the counts disagree.** `seq` is a gap detector rather than a cursor:
 * a subscriber holding trak X at 12 that receives 15 knows it has missed two and asks
 * the publisher again. What it asks is the whole of the difference between the two
 * families here:
 *
 *   · **`Appended` and `Activity` are appends**, so `seq` is 1-based and per FILE —
 *     `log.jsonl` and `transcript.jsonl` respectively — and catching up means re-reading
 *     the file. A projection built from them cannot disagree with what it was built
 *     from, which is why they hang off `Store` rather than off `Observer`.
 *   · **`CheckStarted`/`CheckOutput`/`CheckEnded` are not in any file**, and a check's
 *     output is deliberately not written to one: a passing run of a script that loops
 *     printing megabytes would otherwise land somewhere permanent, which is the hazard
 *     `checks-shell.ts`'s capture backstop already names. `Checks.live` is what a
 *     watcher re-reads instead — the daemon's own memory of the run — so the pair still
 *     works, and what it costs is that a run does not outlive the process that made it.
 *   · **`Drive` is in no file either, and has no `seq`**: it carries the whole of what
 *     it reports, so there is nothing to catch up on. `Runs.holder` is the re-read.
 *   · **`Process`/`ProcessOutput` are the check family's shape for a hosted process**:
 *     daemon memory, never a file, and `HostedProcesses.list` is the re-read.
 *   · **`InFlight` is the run record's `turn`, as `Runs.spent` leaves it** — the
 *     daemon's memory of a turn's spend before the turn ends, on no log and on no
 *     transcript line — and carries it whole, so it has no `seq` either. `Runs.inFlight`
 *     is the re-read.
 *   · **`Goal` is about a goal rather than a trak, and has no `seq` because nothing
 *     patches from it**: every one is answered by re-reading the goal.
 *   · **`Usage` is about a CLI's plan rather than a trak**: daemon memory, carried whole,
 *     and `UsageMemory.current` in `src/app/plan-usage.ts` is the re-read.
 *
 * Domain values rather than DTOs, so nothing in `workflow/` learns the wire contract.
 * `src/app/dto.ts` maps them at the boundary like everything else.
 */
export type Frame = Data.TaggedEnum<{
  Appended: {
    readonly id: TrakId
    readonly seq: number
    readonly event: Event
    /**
     * What the trak became — the whole of it, not the fields a watcher happens to
     * draw today. Known to the publisher, which replays every append, and nowhere in
     * the event itself: a hold or a skip is spent by an event that says nothing about
     * it, a mark is stamped from the decision, a plan is re-cut by a proposal that is
     * not the plan. The boundary picks what crosses; a frame that carried a list of
     * fields would be a second list to keep in step with the read.
     */
    readonly trak: Trak
  }
  Activity: { readonly id: TrakId; readonly seq: number; readonly entry: TranscriptEntry }
  /** The trak is gone. A watcher holding a seq for it must forget it, not re-read. */
  Removed: { readonly id: TrakId }
  /**
   * A check began at a position. The run whole, so a watcher that has been holding an
   * earlier one replaces it rather than merging into it.
   */
  CheckStarted: { readonly id: TrakId; readonly run: CheckRun }
  /**
   * What the check has printed since the last of these. `seq` counts chunks within the
   * run and is what `CheckRun.chunks` is compared against.
   */
  CheckOutput: {
    readonly id: TrakId
    readonly step: number
    readonly seq: number
    readonly chunk: string
  }
  /**
   * The check exited, timed out, or could not be spawned. Carries the run whole because
   * `output` is *replaced* at this point rather than appended to: what a person watched
   * is stdout as it arrived, and what is settled is the report the agent is handed —
   * stderr first, because that is what explains a failure.
   */
  CheckEnded: { readonly id: TrakId; readonly run: CheckRun }
  /**
   * Custody of the trak was taken or let go: `holder` is who is driving it now, and
   * `undefined` is the release.
   *
   * Published by the driver rather than by `Runs`, and the release is why: custody is
   * let go by a scope closing after the drive's last append, so no `Appended` frame
   * can carry it, and `Runs.adopt` cannot say it either without every adapter learning
   * the feed. `src/app/drive.ts` registers the release frame *before* it adopts, so
   * that it runs after the record is cleared — a frame that went out first would have a
   * re-read putting the holder straight back.
   */
  Drive: { readonly id: TrakId; readonly holder: Holder | undefined }
  /**
   * What the turn in flight has spent so far, or `undefined` when the turn has ended
   * and there is nothing in flight any more.
   *
   * Published by the `Runs` decorator on each `spent`, and the release by the closing
   * of `Runs.turn`'s scope — the same shape as `Drive`, for the same reason: the turn's
   * ending is appended before its record clears, so no `Appended` frame can say the
   * record is empty. `step` absent is the composer's turn. `usage` is the provider's
   * own figure and `estimate` what the readings since add up to — `Estimate` says why
   * the two are kept apart. `reattaching` is there while the turn's sandbox is out of
   * reach and the engine is reaching for it again, and goes once it answers.
   */
  InFlight: {
    readonly id: TrakId
    readonly turn: TurnSpent | undefined
    readonly reattaching?: Reattaching
  }
  /**
   * A hosted process changed state — started, came up, failed to, exited, was stopped.
   * The process whole, its log included, so a watcher replaces what it holds: the
   * shape `CheckStarted` has, and for its reason. Published by the supervisor, which
   * holds the only account of it — see `HostedProcesses`. `id` is absent for one on the
   * project checkout.
   */
  Process: { readonly id: TrakId | undefined; readonly process: HostedRun }
  /**
   * What a hosted process has printed since the last of these. `seq` counts chunks
   * within the one run `run` names and is compared against `HostedRun.chunks`, for
   * `CheckOutput`'s reason; a restart is a new run and counts from one again.
   */
  ProcessOutput: {
    readonly id: TrakId | undefined
    readonly name: string
    readonly run: number
    readonly seq: number
    readonly chunk: string
  }
  /**
   * A goal's log or transcript grew. It carries no count and no content: a goal screen
   * re-reads the goal whole, which is small beside a trak's, and the goal's projection
   * stays the engine's alone. Published by the goal store's decorator, after the write.
   */
  Goal: { readonly goal: GoalId }
  /**
   * One CLI's plan usage changed — a reading, a report with no reading, or the CLI's
   * turns starting or stopping. Whole, so a watcher replaces what it holds for that CLI.
   */
  Usage: { readonly usage: CliUsage }
  /**
   * The preparation a trak is in moved — `Preparation`'s answer whole, `undefined` once
   * none is running. Engine memory, on no log, for `Drive`'s reason.
   */
  Preparing: { readonly id: TrakId; readonly phase: PreparingPhase | undefined }
  /**
   * The trak's action at the seam moved — `SeamStatuses`' answer whole, `undefined` once
   * none is running. Engine memory, on no log, for `Drive`'s reason.
   */
  SeamStatus: { readonly id: TrakId; readonly status: SeamStatus | undefined }
}>
export const Frame = Data.taggedEnum<Frame>()

/**
 * A turn in flight whose sandbox the engine is reaching for again: which position, and the
 * outage's kind, the runner's last words and when it began — see `Outage`.
 */
export interface Reattaching {
  readonly step: number | undefined
  readonly kind: Outage["kind"]
  readonly said: string
  readonly since: number
}

/** The outage a watcher is told of for the turn at `step`: none once a caller gave up on it. */
export const reattachingOf = (
  step: number | undefined,
  outage: Outage | undefined,
): Reattaching | undefined =>
  outage === undefined || outage.spent
    ? undefined
    : { step, kind: outage.kind, said: outage.said, since: outage.since }

/** The three fields of an `InFlightTurn` a watcher draws: which position, and what it spent. */
export interface TurnSpent {
  readonly step: number | undefined
  readonly usage: Usage
  readonly estimate: Estimate
}

/**
 * A frame with the id a subscriber resumes from — daemon-global and monotonic,
 * because the feed is multiplexed across traks and a single scalar is the only thing
 * a resume token can be.
 */
export interface Framed {
  readonly id: number
  readonly frame: Frame
}

/**
 * What a subscriber gets back: whatever is still buffered, then everything from now on.
 *
 * `complete` is false when the caller asked from before the buffer's floor. It is the
 * one thing a bounded ring owes its readers — silently starting from the middle would
 * leave a projection permanently wrong with nothing to notice it by.
 */
export interface Replay {
  readonly complete: boolean
  readonly frames: Stream.Stream<Framed>
}

/**
 * Where appends go so something can watch them happen.
 *
 * **`publish` cannot fail and must not block.** It runs inside `Store.append`, which
 * runs inside `advance` — a feed that made a write wait on a reader would let one
 * stalled subscriber stop the engine mid-turn. An implementation drops rather than
 * waits, and `Replay.complete` is how the dropping is reported.
 */
export interface FeedShape {
  readonly publish: (frame: Frame) => Effect.Effect<void>
  /** Subscribe, then read the buffer — released when the caller's scope closes. */
  readonly since: (after: number) => Effect.Effect<Replay, never, Scope.Scope>
}

export class Feed extends Context.Tag("workflow/Feed")<Feed, FeedShape>() {}
