import { Context, Data, type Effect, Schema, type Scope } from "effect"
import { Estimate, Usage } from "../../agent/types/usage.js"
import { SessionId } from "../../agent/types/session.js"
import type { TrakId } from "../domain/trak.js"
import type { StoreFailed } from "./store-errors.js"

// ============================================================================
// Runs — what this process is driving, and what a dead one left running.
//
// **It is no longer a lock.** One daemon owns the engine, and two drives of one
// trak are kept apart in memory by a permit rather than by a file — see
// `Locks` in `locks.ts`. What survives is the half a permit cannot do: leave a
// record on disk that outlives the process, so a `claude` orphaned by a kill -9
// is findable by whatever starts next. Ephemeral, unlike Store: a clean exit
// clears it, and it is meaningless without a live Process to check liveness
// against, which is why it is a second port rather than more methods on Store.
// ============================================================================

/**
 * What `run.json` holds. `holder` is the CLI session driving the trak; `turn`
 * is the agent turn in flight, if any. `turn.step` absent means the composer —
 * there is no step index for it. Neither field carries the trigger: the
 * session already holds the back-and-forth, so continuing it is a directive
 * ("carry on"), not a replay of what started it.
 *
 * `turn.usage` is what the turn has spent so far, as of the provider's last report —
 * see `RunsShape.spent`. Absent until the first report. `turn.estimate` is what the
 * readings since that report add up to, written beside it and absent with it.
 *
 * `turn.minted` is the id the turn was requested under, kept once the provider's
 * announcement has replaced `turn.sessionId` — see `InFlightTurn`.
 *
 * `holder.start` is the holder's start time as `Process.startTime` reads it, which is what
 * tells the engine that wrote the record from a later process given the same pid — the
 * usual case after a redeploy, which leaves the holder standing for a detached turn.
 * Absent on a record written before it was kept, which is judged by its pid alone.
 *
 * `turn.execId` is the runner's id for a turn running in a sandbox, where `agentPid` is
 * the local `runner.sh`. It is how `reap` stops the remote command once that script is
 * dead, since nothing is then left to forward a signal. Absent on a turn on this machine.
 * `turn.detached` says the command was started to outlive that script, so `reap` rejoins
 * it rather than stopping it.
 */
export const RunRecord = Schema.Struct({
  holder: Schema.optional(
    Schema.Struct({
      pid: Schema.Number,
      startedAt: Schema.Number,
      start: Schema.optional(Schema.String),
    }),
  ),
  turn: Schema.optional(
    Schema.Struct({
      step: Schema.optional(Schema.Number),
      sessionId: SessionId,
      minted: Schema.optional(SessionId),
      agentPid: Schema.optional(Schema.Number),
      agentStart: Schema.optional(Schema.String),
      execId: Schema.optional(Schema.String),
      detached: Schema.optional(Schema.Literal(true)),
      usage: Schema.optional(Usage),
      estimate: Schema.optional(Estimate),
    }),
  ),
})
export type RunRecord = Schema.Schema.Type<typeof RunRecord>

/**
 * A turn that was in flight when its holder died, or when a person pressed stop.
 *
 * `agentStart` is when the agent's process started, as `Process.startTime` read it
 * the moment the pid was recorded. It is what `reap` verifies a live pid against
 * before killing it: a process number the operating system has reissued belongs
 * to something that started later. Absent where the read failed, and a stray
 * with no recorded start is declined rather than killed.
 *
 * `usage` is what the turn had spent at the provider's last report, and it is here
 * for the stop: the turn's own metering dies with the fiber the stop interrupts, so
 * the event that ends the turn can carry its spend only if the record already held
 * it. Absent before the first report, which is a turn that spent nothing yet.
 *
 * `estimate` is what the readings since that report add up to — `Estimate` says what
 * it is and why it stays off the log. It is here for a screen rather than for a stop:
 * a stop reads `usage` and nothing else off the record. Absent exactly where `usage` is.
 *
 * `sessionId` is the conversation — the id the provider announced once it has, which
 * is what a restart, a stop and a filing resume by. `minted` is the id the turn was
 * requested under, and it is what the running process's pipe is held by: a CLI that
 * mints its own session never knew it, so the two differ there, and a message steered
 * by `sessionId` finds no pipe. Absent until the provider announces, while the two
 * are still one.
 *
 * `rejoin` is the exec id of a command still running detached in the trak's sandbox,
 * which the next turn at the same position reads from its start rather than starting
 * again — see `RunRecord`. Absent on every other turn. Handed to `turn` by the turn that
 * rejoins it, which keeps it on the record; a turn that does not stops the command first.
 */
export interface InFlightTurn {
  readonly step: number | undefined
  readonly sessionId: SessionId
  readonly minted?: SessionId
  readonly agentPid: number | undefined
  readonly agentStart: string | undefined
  readonly rejoin?: string
  /**
   * The id the turn's command runs under in its sandbox, written before it is spawned, so
   * a stop after an engine died always has an id to kill — and filled in again by
   * `spawned` once the provider reports it. Absent with no runner.
   */
  readonly execId?: string
  readonly usage: Usage | undefined
  readonly estimate: Estimate | undefined
}

/**
 * The process driving a trak right now, and since when.
 *
 * `startedAt` is on the record already and is the only thing here a surface can
 * put in front of a person — *running for 2m* rather than a pid nobody can act
 * on. It is reported rather than synthesised at the boundary, which is the rule
 * `TrakDetailDto` states from the other side: a field the server would have to
 * invent is left off instead.
 */
export interface Holder {
  /** On this machine; absent for another engine copy, known only by its lease. */
  readonly pid?: number
  readonly startedAt: number
}

/** What `reap` did about one stray. `ork` prints all three. */
export type Reaped = Data.TaggedEnum<{
  Killed: { readonly id: TrakId; readonly pid: number }
  AlreadyGone: { readonly id: TrakId; readonly pid: number }
  /**
   * Alive, but it did not start when the recorded agent did — the pid-reuse case —
   * or its start could not be read on one side or the other. A wrong kill is worse
   * than a leaked process, so this is reported rather than acted on.
   */
  Declined: { readonly id: TrakId; readonly pid: number }
  /**
   * A turn's command still running detached in its sandbox, left there for the trak's
   * next drive to rejoin. Reported beside what happened to the local half.
   */
  Rejoining: { readonly id: TrakId; readonly execId: string }
}>
export const Reaped = Data.taggedEnum<Reaped>()

/**
 * What this process is driving, plus what a dead one left behind.
 *
 * Ephemeral where `Store` is durable: `adopt` and `turn` both live for the
 * length of the caller's `Scope` rather than being written and read back
 * explicitly — the record clears itself exactly when the thing it describes
 * stops being true, however the scope closes.
 */
export interface RunsShape {
  /**
   * Record this process as driving a trak, and report any turn the last one left
   * in flight. Released when the scope closes.
   *
   * **It cannot be refused, and that is the change one writer bought.** It used
   * to fail `TrakHeld` when another live process held the trak, which was the
   * only thing keeping two engines off one log — and the check was a read
   * followed by a write with no compare-and-swap across the gap, so two
   * processes finding the same dead holder could both win. Exclusion is now a
   * permit inside the one process that writes, which cannot race at all. What is
   * left here is the record: `reap` skips any trak whose `run.json` names no
   * holder, so this write is the only thing that makes an orphaned `claude`
   * findable.
   */
  readonly adopt: (id: TrakId) => Effect.Effect<InFlightTurn | undefined, StoreFailed, Scope.Scope>
  /**
   * The turn a dead process left in flight, taking nothing.
   *
   * The same fact `adopt` reports, read rather than written, and it exists because
   * *which turn a `Restarted` is ending* is not the caller's to state — `advance`
   * stamps it here for every caller at once. Threading `adopt`'s answer through
   * instead is the arrangement that shipped the bug: one of the three sites that
   * write a `Restarted` dropped it, and the turn it interrupted got no ending at all.
   *
   * `undefined` means nothing was in flight, which is a restart at a gate or one past
   * a failure the engine already recorded an ending for.
   */
  readonly inFlight: (id: TrakId) => Effect.Effect<InFlightTurn | undefined, StoreFailed>
  /**
   * Who holds a trak, without taking it. `undefined` means nobody — a trak
   * nobody ever claimed and a trak whose record is gone are the same answer,
   * because absent is absent.
   *
   * Separate from `adopt` because `adopt` *writes*. This one writes nothing at
   * all, which is the entire reason it exists rather than being `adopt` with a
   * flag: it answers the detail route, and a read that took custody as a side
   * effect would make looking at a trak a way of driving it.
   *
   * What it is *not* is how a surface asks *is this busy right now* — that is
   * `Drives.running`, which costs no file read and cannot be stale. This is the
   * durable record, and it differs from that answer after a crash until `reap`
   * clears it, and for as long as a dead holder's reissued pid reads as alive. The
   * detail route asks it only for *since when*, and only while `Drives.running` says
   * something drives the trak.
   */
  readonly holder: (id: TrakId) => Effect.Effect<Holder | undefined, StoreFailed>
  /**
   * Record a turn as in flight for the length of the scope; cleared on release, unless the
   * engine is leaving a detached command running. A detached command the record already
   * names is stopped first, unless this turn rejoins it — see `InFlightTurn.rejoin`.
   */
  readonly turn: (id: TrakId, turn: InFlightTurn) => Effect.Effect<void, StoreFailed, Scope.Scope>
  /**
   * Fill in the agent's pid, and the runner's exec id where it runs in a sandbox, once the
   * provider reports them — with `detached` where the command outlives the engine there.
   */
  readonly spawned: (
    id: TrakId,
    pid: number,
    execId?: string,
    detached?: boolean,
  ) => Effect.Effect<void, StoreFailed>
  /**
   * Replace the turn's session with the one the provider announced, keeping the one
   * it replaces as `minted`.
   *
   * A CLI that mints its own id never knew the one `turn` recorded, and a restart, a
   * stop or a filing reads its session from this record. Nothing to write to is not
   * an error, for `spawned`'s reason.
   */
  readonly announced: (id: TrakId, sessionId: SessionId) => Effect.Effect<void, StoreFailed>
  /**
   * Replace what the turn in flight has spent, each time the provider reports.
   *
   * The whole running total rather than an increment, so a write that is lost costs
   * the gap to the next report and never a term of the sum. Written on a `Usage`
   * report and on each `Occupancy` — once per model call, so the record carries a
   * context reading a stop can keep; the tool histogram on it is still only as of the
   * last `Usage`, and nothing is written per tool call. The estimate rides with it,
   * whole for the same reason. Nothing to write to — no turn in flight — is not an
   * error, for `spawned`'s reason.
   */
  readonly spent: (id: TrakId, usage: Usage, estimate: Estimate) => Effect.Effect<void, StoreFailed>
  /**
   * The command `execId` was stopped by a stop: take the turn that names it off the record,
   * which a kept detached command's close left standing. A record naming another, or none,
   * is left alone.
   */
  readonly ended: (id: TrakId, execId: string) => Effect.Effect<void, StoreFailed>
  /**
   * Kill every stray a dead predecessor of this process left running, and name each
   * detached command it leaves for its trak to rejoin.
   */
  readonly reap: () => Effect.Effect<readonly Reaped[], StoreFailed>
  /**
   * Stop the command another engine copy's record still names for this trak, which that
   * copy left running when it died or let go. Called by a drive that took the trak over
   * to end its turn, under the lease. Nothing where no other copy can have left one.
   */
  readonly stopLeft: (id: TrakId) => Effect.Effect<void, StoreFailed>
}

export class Runs extends Context.Tag("workflow/Runs")<Runs, RunsShape>() {}
