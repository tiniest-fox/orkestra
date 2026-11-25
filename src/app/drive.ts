// The only file in `app/` that may drive the engine.
//
// `advance` is a free function: nothing about its signature says a caller must hold
// custody first, and `ork.ts` claiming before every drive is a convention rather
// than a constraint. The HTTP routes did not, and the cost was two bugs at once —
// a UI action could drive a trak a live `pnpm ork` was already driving, and a crash
// mid-turn left a `claude` that `reap` could never see, because `reap` skips any
// trak whose `run.json` names no holder.
//
// Making that a type error does not work: 28 call sites drive `advance` legitimately
// without custody — `main.ts`, `walkthrough.ts`, and the flow tests, none of which
// have a second driver to race. A proof token every one of them could fabricate
// would prove nothing.
//
// So the constraint is structural instead, and scoped to the surface that had the
// bug: **`src/app/**` may not import `advance` except here** (`no-restricted-imports`
// in `.oxlintrc.json`). A new route cannot reach the engine without coming through
// this file, and this file always claims. The next endpoint inherits the fix
// rather than having to remember it.
//
// **A drive's lifetime is a fiber's, not a request's.** A route asks for one and is
// answered `202` immediately; the turn runs on a fiber forked into the daemon's own
// scope. What that buys is the whole reason the daemon exists: a closed tab, a reload
// or a navigation no longer interrupts an agent mid-turn, and a turn started in the
// browser can be watched from a terminal, because neither surface is the thing running
// it. What a caller gets back instead of the new state is a stream to watch.
//
// **Ending a trak waits before its `202`.** Taking a drive over means interrupting the
// fiber holding its key and letting it unwind, which is what kills the `claude` before
// anything commits the worktree it was writing into — see `takeOverDrive` for the whole
// of what that costs and what it leaves behind. Stopping a turn takes the drive over too,
// but answers once its intent is on the log and kills in the background — `stopDrive`.
//
// **A spawn's children are drives too, and this is the only thing that starts them.**
// A trak parked in `AwaitingChildren` waits on traks rather than on a person, so a
// drive that leaves one there is followed by a drive for every child that has not been
// born and every child a dead process cut off — each on its own fiber, under its own
// key, four at a time. Nothing joins them: a child runs to its own first gate and
// stops, and a human answers it by its own id through the routes every other trak
// uses. **So are the traks a composer handed off**, opened once by the drive that took
// the plan gate they rode on, and then somebody's from their first gate on.

import { randomUUID } from "node:crypto"
import {
  Cause,
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Either,
  Exit,
  Fiber,
  FiberMap,
  HashSet,
  Layer,
  Option,
  Ref,
  type Scope,
} from "effect"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
// Type-only, so that nothing which reaches this file imports the `actions` slice, and
// through it `trak` and `log`: `verify-light` selects tests by what they import.
import type { CreatedDto } from "@orkestra/shared/dto/actions"
import {
  BranchNotMovedDto,
  DrivingDto,
  NotAtRestDto,
  type RefusalDto,
} from "@orkestra/shared/dto/common"
import { Provider } from "../agent/ports/provider.js"
import { heldChat } from "../workflow/domain/decide.js"
import { type BranchMoved, type Event, Events } from "../workflow/domain/event.js"
import type { Attachment } from "../workflow/domain/attachment.js"
import { Prompts } from "../prompts/ports/prompts.js"
import {
  asGate,
  atRest,
  effectFailedAt,
  slotAt,
  type Trak,
  type GoalId,
  type UserId,
  type RunMode,
  type TrakId,
  type TrakState,
  type Wait,
  waitingAt,
} from "../workflow/domain/trak.js"
import { replayHistory } from "../workflow/domain/replay.js"
import {
  advance,
  advanceAfter,
  advanceTelling,
  askConditions,
  askMerged,
  driveChild,
  driveHandOff,
  intend,
  landOnParent,
  owedStop,
  record,
  type RuntimeDeps,
  type RuntimeError,
} from "../workflow/runtime.js"

// The composer's decode, for the act route to hold a person's edited plan to before it
// appends. Passed through here because this file is the app's one door into the runtime;
// it reads the library and the log, and drives nothing.
export { proposalRefusal } from "../workflow/runtime.js"
// A goal composer's turn, for `goal-drives.ts` — through here for the same reason. It runs
// outside every trak and takes no trak's custody: what keeps it single is the goal's own
// map of turns.
export { ComposeGoal } from "../workflow/runtime.js"
// A lost sandbox made again, for `layers.ts` to hand the sandboxes at boot — through here
// for the same reason. It runs inside the work that found the loss, and appends nothing.
export { remakeSandbox, renewSandbox } from "../workflow/runtime.js"
// The check tool's call, for `trak-tools.ts` — through here for the same reason. It runs
// inside the turn in flight, forked into that turn's scope, and appends no event: the
// drive that holds the turn is the one custody it needs. `workdir` is where that turn
// runs, which is where its process tools start what they start. `TRAK_TOOLS` is the name
// the tools are served under, which `trak-mcp.ts` answers `initialize` with.
export {
  CheckCall,
  offeredChecks,
  offersEngineTools,
  RUN_CHECK,
  runCheckForTurn,
  TRAK_TOOLS,
  turnAgent,
  workdir,
} from "../workflow/runtime.js"
// A person's message framed for a running turn, its files listed and its images read —
// for `holdMessage` here and the goal's `holdGoalMessage`, which steer as the runtime does.
import { steeredMessage } from "../workflow/runtime.js"
export { steeredMessage }
import { Feed, Frame } from "../workflow/ports/feed.js"
import { Ids } from "../workflow/ports/ids.js"
import type { LeaseRow } from "../workflow/ports/leases.js"
import { Leaving } from "../workflow/ports/leaving.js"
import { LeaseHeld, Locks } from "../workflow/ports/locks.js"
import { withProjectFiles } from "../workflow/ports/project-files.js"
import { type InFlightTurn, Runs } from "../workflow/ports/runs.js"
import { Setups, type SetupsShape } from "../workflow/ports/setups.js"
import { Store, type StoreShape } from "../workflow/ports/store.js"
import { type StoreFailed, StoreFenced } from "../workflow/ports/store-errors.js"
import { BranchName } from "../vcs/index.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { keepRecord } from "./records.js"
import { moveIfMerged } from "./reentry-move.js"
import { Deploys, deployStatusOf } from "./deploys.js"

/**
 * How many children of one spawn run at once.
 *
 * Each is a `claude`, and four of them is already four models' worth of tokens per
 * minute. A drive a person asked for takes no slot: there is one person, and a queue
 * in front of a request is a daemon that reads as having stopped.
 *
 * **A slot is taken outside every permit**, which is what keeps the bound
 * deadlock-free: nothing holding a trak's permit is ever waiting for a slot, so a
 * queued child can never be behind a drive that is behind the queue.
 */
const CHILD_CONCURRENCY = 4

/** Every trak a compose entry of this one handed off, with the entry and its place in the list. */
const namedHandOffs = (
  t: Trak,
): readonly { readonly step: number; readonly index: number; readonly child: TrakId }[] =>
  [...t.slots].flatMap(([step, slot]) =>
    (slot.handedOff?.ids ?? []).map((child, index) => ({ step, index, child })),
  )

/**
 * What a drive runs under the trak's own permit.
 *
 * An effect rather than an event, because there are two shapes and no third:
 * `advance` for a trak that exists, and `driveChild` for one being born, which reads
 * its parent to decide between birth and pick-up. `resuming` is what the last process
 * left in flight, and only `adopt` can report it.
 */
type Turn = (resuming: InFlightTurn | undefined) => Effect.Effect<Trak, RuntimeError, RuntimeDeps>

/**
 * A drive, and the traks it may have left parked on children.
 *
 * `Feed` beside `RuntimeDeps` because a drive says when it takes a trak and when it lets
 * go, and nothing under `advance` publishes that: custody is not on the log.
 */
type Drive = Effect.Effect<readonly TrakId[], RuntimeError | LeaseHeld, RuntimeDeps | Feed>

/**
 * Take custody of a trak for the rest of the scope, and tell every watcher both ends.
 *
 * **The release frame is registered before `adopt`, and the order is the whole
 * function.** Finalizers run in reverse, so a frame registered first goes out after
 * `adopt`'s own release has cleared the record — a watcher that re-reads on it finds
 * nobody driving, which is what it was told. Registered after, the frame would say
 * *let go* while `run.json` still names this process, and a re-read would put the
 * holder — and every disabled button — straight back.
 *
 * The taking is read back off `Runs` rather than stamped here, so `since` is the time
 * the record holds and not a second clock's opinion of it.
 */
const takeCustody = (
  id: TrakId,
): Effect.Effect<InFlightTurn | undefined, StoreFailed, Runs | Feed | Scope.Scope> =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const feed = yield* Feed
    yield* Effect.addFinalizer(() => feed.publish(Frame.Drive({ id, holder: undefined })))
    const resuming = yield* runs.adopt(id)
    yield* feed.publish(Frame.Drive({ id, holder: yield* runs.holder(id) }))
    return resuming
  })

/**
 * Run `effect` with the trak counted as running, though no fiber is keyed by it — the
 * landing's way of telling `Drives.running` that the parent is being carried on the
 * child's.
 */
type Carry = (id: TrakId) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

/**
 * The traks a landing is carrying, and the `Carry` that counts one in and out.
 *
 * At module level rather than in `DrivesLayer`'s closure, for `needsDriving`'s reason.
 */
const carrying = Effect.map(Ref.make(HashSet.empty<TrakId>()), (held) => ({
  carry: ((id) => (effect) =>
    Effect.acquireUseRelease(
      Ref.update(held, HashSet.add(id)),
      () => effect,
      () => Ref.update(held, HashSet.remove(id)),
    )) satisfies Carry,
  carried: (id: TrakId) => Effect.map(Ref.get(held), HashSet.has(id)),
}))

/**
 * Put one trak through a turn, land it on its parent if it finished, and name the
 * traks whose children may now need starting.
 *
 * **The permit is what makes it safe; the record is what makes a crash survivable.**
 * `advance` reads the log, applies the event and appends, with nothing guarding the
 * gap — so the permit is the whole of the exclusion, and it is exact, because one
 * process does all the writing. `adopt` is not a second lock and cannot refuse: it
 * writes `run.json` — beside the lease row, under an external store — which is the only thing
 * that makes a `claude` orphaned by a kill -9 findable, because `reap` skips any trak
 * naming no holder. Under an external store the lease, not the permit, keeps another copy out.
 *
 * The record is held for the whole drive rather than taken and released, for the same
 * reason: a scope that closes clears it, so one still standing means a process died
 * without unwinding.
 *
 * `landOnParent` runs under the *parent's* permit and outside the child's, which is
 * what keeps the rule that no fiber ever holds two: the child's drive has finished by
 * then, and landing only needs the `Trak` it returned. It is the shared rule rather
 * than this file's own — a child driven from the UI by its own id lands exactly as one
 * the daemon started does, and is a no-op for every trak that is not a finished child.
 *
 * **Parentage is read off the drive's result, and the parent's record is taken at the
 * landing.** A child being born has no log to name a parent until this drive writes
 * one, so a lookup before the turn would find none. The record is for the landing
 * either way: that is the stretch which can carry the parent through its next steps
 * and spawn a `claude` for it. It is also the stretch with no fiber keyed by the
 * parent, so `carry` is what tells `Drives.running` the parent is moving.
 */
const driveOne = (id: TrakId, turn: Turn, carry: Carry): Drive =>
  Effect.scoped(
    Effect.gen(function* () {
      const locks = yield* Locks
      // **The drive first, custody inside it**, so custody is released before the lease.
      // Under an external store only the copy holding a trak's lease may write its `run.json`:
      // a press refused the lease never touches the record of the copy that is driving.
      const advanced = yield* locks.withDrive(id)(
        Effect.scoped(Effect.flatMap(takeCustody(id), turn)),
      )
      // **Outside the permit, and after the drive rather than inside `advance`.** The
      // record is a view of the whole log including the ending that closes it, so
      // there is no point during the drive at which it would be complete — and it
      // writes outside every worktree, so nothing about it needs the trak held.
      yield* keepRecord(id)
      const parent = advanced.parent
      if (parent === undefined) return [id]
      // Told the same way as the child's: a landing carries the parent through its
      // next steps, and a parent whose drawer never heard it was let go is the same
      // disabled screen on the trak nobody happened to be watching. Carried only
      // inside custody, so the count is gone before the frame letting go is sent — a
      // watcher that re-reads on it finds the parent idle, as `takeCustody` orders.
      yield* locks.withDrive(parent.id)(
        Effect.scoped(
          Effect.andThen(takeCustody(parent.id), carry(parent.id)(landOnParent(advanced))),
        ),
      )
      return [id, parent.id]
    }),
    // Taken at the start, for what a drive reads before its first `advance` — which
    // takes the pair again, so a long drive meets a reload at its next step.
  ).pipe(withProjectFiles)

/**
 * Say how a forked drive ended. **Another engine copy holding the trak is not a fault**:
 * a drive refused its lease at the start, or fenced out at an append after that copy took
 * it, ends at info. Neither is retried — a retry would write beside the copy that holds it.
 */
export const driveEnded = (id: TrakId | GoalId, cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  Option.match(Cause.failureOption(cause), {
    onSome: (e) =>
      e instanceof LeaseHeld || e instanceof StoreFenced
        ? Effect.logInfo(`${id}: driven by another engine copy — ${e.message}`)
        : Effect.logError(`drive of ${id} ended`, cause),
    onNone: () => Effect.logError(`drive of ${id} ended`, cause),
  })

/** Whether a drive ended because another engine copy holds the trak — `driveEnded`'s info case. */
const heldElsewhere = (exit: Exit.Exit<unknown, unknown>): boolean =>
  Exit.isFailure(exit) &&
  Option.exists(
    Cause.failureOption(exit.cause),
    (e) => e instanceof LeaseHeld || e instanceof StoreFenced,
  )

/**
 * Which event to drive, given whatever the last process left in flight.
 *
 * A function rather than a value because one caller genuinely depends on it: resuming
 * an interrupted turn has to carry on in the session that turn was using, and the only
 * thing that reports it is `adopt` — which happens inside the drive, after the request
 * that asked for it has been answered. Every other caller ignores the argument.
 */
export type ChooseEvent = (resuming: InFlightTurn | undefined) => Event

export interface DrivesShape {
  /** Fork a drive, unless this trak already has one — here, or under an external store on another copy. */
  readonly start: (id: TrakId, event: ChooseEvent) => Effect.Effect<"started" | "busy">
  /**
   * `start`, for a trak being born: answered once `event` is on the log rather than at the
   * fork, so a caller that reads the trak after the answer finds it. The rest of the drive
   * runs on after the answer, as `start`'s does — the worktree, the composer and every
   * turn after are not waited for.
   *
   * `unwritten` where the drive ended before the birth was appended — the store refused
   * it, or custody could not be taken — and then no fiber is left under the id. `busy` as
   * `start` answers it, and where another engine copy refused the drive its lease.
   */
  readonly bear: (id: TrakId, event: ChooseEvent) => Effect.Effect<"born" | "busy" | "unwritten">
  /**
   * Interrupt whatever is driving this trak, wait for it to unwind, and drive
   * `event` in its place. Under an external store a drive on another copy is woken and
   * waited for in the same way, up to a lease length where that copy is gone. Nothing to report: taking the key is the point, so
   * there is no *busy* left to answer with — and a trak the interrupted drive
   * left at rest is left alone, which is what makes a double press land once.
   *
   * **The waiting is the mechanism, not politeness.** The interruption closes the
   * drive's scope, and that is what kills the `claude`, clears the run record and
   * releases the trak's permit — so a fork that did not wait would commit a
   * worktree an agent was still writing into. It costs the response whatever the
   * kill costs: `killGroup` is SIGTERM, a grace period and SIGKILL.
   *
   * What the interruption itself leaves on the log is a command in flight and no
   * ending, which is the shape a `kill -9` leaves and `restartFrom` re-issues —
   * unless the event forked in its place says otherwise, which is what a recompose's
   * `HumanActed` carrying the interrupted session is for. The one interruption
   * with no re-run behind it is an ending already running — `Merging` runs its
   * `git merge` in the *host's* checkout — so which states may ask for this is
   * the route's judgement and not this map's.
   */
  readonly takeOver: (id: TrakId, event: ChooseEvent) => Effect.Effect<void, RuntimeError>
  /**
   * Take the drive of a trak `StopRequested` has put in `Stopping` over, and run the kill
   * it owes — **in the background**: the press is answered once its intent is on the log,
   * and the kill's grace period, or a sandbox's outage window, is not the request's to
   * wait for. `takeOver`'s mechanism otherwise, interruption included: that is what kills
   * a local turn, or cancels one still on its way to the spawn. `kept` is the exec the
   * press kept past its close, released by `owedStop` where the turn's own ending won.
   */
  readonly stopping: (id: TrakId, kept: string | undefined) => Effect.Effect<void>
  /**
   * Re-enter a resting trak, moving its branch first where its pull request merged — see
   * `moveIfMerged`. **The move runs on the drive, under the trak's key**, so two
   * re-entries never move one checkout at once and a move is never left behind by a
   * drive that lost the race to start; it and the append of `event`'s `Reentered` run as
   * one through `advanceAfter`.
   *
   * Answers once the move is settled rather than at the fork, because its refusal is the
   * request's to carry: `busy` where the key is taken, a refusal where the trak no longer
   * rests or the branch could not be moved — nothing appended — and right otherwise.
   */
  readonly reenter: (
    id: TrakId,
    event: (moved: BranchMoved | undefined) => Event,
  ) => Effect.Effect<"busy" | Either.Either<void, RefusalDto>>
  /**
   * Ask a resting trak's condition again. The script runs on a fiber of its own,
   * holding neither the trak's drive key nor custody — a poll is not a turn, and a
   * person's press has to win over it: archive, merge and send-it-back all go through
   * `start`, which refuses for as long as the key is held, and the pane disables the
   * same presses off the custody a drive publishes. Only an answer that changed
   * something — met, or given up — becomes a drive, through `start`, where it re-reads
   * the trak under the permit and appends nothing if a press moved it meanwhile.
   *
   * `busy` where a turn is in flight or the previous ask is still running; `asked`
   * once the script is running. The sweep in `app/conditions.ts` is the one caller,
   * and it counts an interval from `asked`.
   */
  readonly ask: (id: TrakId, step: number) => Effect.Effect<"asked" | "busy">
  /**
   * Run the step held at `step` now: fork a drive that appends `event` only if the
   * trak still rests on that entry once the permit is taken, and hands it back
   * untouched otherwise — given up or still asking alike, which is the one way this
   * differs from the landing an `ask` forks.
   *
   * `start` is not enough for it. The press reads the trak, asks the forge and then
   * asks for a drive, and `start` refuses only a drive still running: an archive or
   * a merge that landed *during* the forge call has released the key by then, so
   * `WaitSkipped` would be appended at `Closed` or `Merged` and settle a healthy
   * trak for a press that arrived late.
   */
  readonly runNow: (id: TrakId, step: number, event: Event) => Effect.Effect<"started" | "busy">
  /**
   * Fork a drive that appends `event` only if `holds` still finds the trak where the
   * caller saw it, once the permit is taken — and hands it back untouched otherwise.
   *
   * For an actor nobody pressed that asked the world something first, holding no key
   * while it did: the forge sweep archives a goal's trak this way, and a person's
   * archive, merge or send-it-back during the forge call wins over it.
   */
  readonly startIfStill: (
    id: TrakId,
    event: Event,
    holds: (trak: Trak) => boolean,
  ) => Effect.Effect<"started" | "busy">
  /**
   * Whether a fiber here is driving this trak, or under an external store another copy holds
   * its lease — which is not the same question as *is a turn running for it*, and misses
   * in both directions. A child waiting for
   * one of the child slots has a fiber and nothing running yet; a parent being
   * carried through its next steps by the child that just landed on it has no fiber
   * of its own, because that work is on the child's.
   *
   * It is the question every *take over or refuse* asks, because a take-over can only
   * interrupt a fiber keyed by the trak. A surface asking *is this busy* asks `running`.
   */
  readonly driving: (id: TrakId) => Effect.Effect<boolean>
  /**
   * Whether this daemon is moving the trak: `driving`, or a child's landing carrying it
   * through its next steps on the child's fiber. Without the second half a parent read
   * as idle on every surface for the whole of the step a landing started for it. Another
   * copy's drive is answered from the last lease change this copy saw, read again once
   * that is a lease length old.
   */
  readonly running: (id: TrakId) => Effect.Effect<boolean>
  /**
   * Send what a parked trak's person already said, as the chat at its gate — a drive,
   * forked only where `heldChat` finds one to send and nothing is driving. Where
   * something is, that drive asks the same question at its own park.
   *
   * **One window is left open, and it is harmless**: a drive that has parked and not
   * yet let go of its key answers *busy* to a message appended in between, and the
   * message stays waiting at the gate. It is on screen as waiting, and the next thing
   * the person sends there takes it along — `chatWith`.
   */
  readonly sayWaiting: (id: TrakId) => Effect.Effect<void, RuntimeError>
  /**
   * Under an external store, another copy asked whoever drives this trak to let go: a fiber
   * here driving it is interrupted, as `takeOver` interrupts one, and so is this copy's
   * background setup for it — the copy taking over runs its own. Nothing else happens.
   */
  readonly letGo: (id: TrakId) => Effect.Effect<void>
  /**
   * Under an external store, the trak's lease was taken or released: read again for `running`,
   * and told to a `takeOver` waiting for another copy to let go. Taken by another copy, it
   * also ends this copy's background setup for the trak, which that copy's work starts
   * again where the log still owes it — a parked trak's run holds no lease to be woken by.
   */
  readonly leaseMoved: (id: TrakId) => Effect.Effect<void>
}

export class Drives extends Effect.Tag("app/Drives")<Drives, DrivesShape>() {}

/** Whether the trak still rests on the entry a press was made about, given up or not. */
const stillHeldAt = (trak: Trak, step: number): boolean => waitingAt(trak)?.step === step

/** Whether the trak is still resting on the entry an ask was made about, and still asking. */
const stillWaitingAt = (trak: Trak, step: number): boolean =>
  stillHeldAt(trak, step) && waitingAt(trak)?.stopped === false

/**
 * The turn an answer about a wait is: read the trak under custody, and append the
 * answer only if `holds` still finds it where the answer was made.
 *
 * **Read again under the permit, not trusted from the ask.** The script ran holding
 * nothing, and a person can have pressed anything while it did — sent the trak back,
 * merged it, archived it. A trak no longer resting on this entry is handed back
 * untouched, which is the same answer `takeOver` gives an ending that raced; the
 * answer is lost, and the next sweep asks again. `decide` absorbs the residue the
 * same way, so an answer that lands anywhere else re-parks rather than failing.
 *
 * The run-now press lands here too, with `askMerged`'s forge call in the place of
 * the script: the route's own read was made before it and outside the permit, and
 * `start`'s busy check only sees a press still running, not one that has landed.
 *
 * Met enters the step and given up records that the sweep should stop — both through
 * `advance`, so `decide` is what moves the trak and this is only the landing.
 */
const landingTurn =
  (id: TrakId, answer: Event, holds: (trak: Trak) => boolean): Turn =>
  () =>
    Effect.gen(function* () {
      const store = yield* Store
      const trak = replayHistory(id, yield* store.events(id))
      return holds(trak) ? yield* advance(id, answer) : trak
    })

/**
 * The ask itself: read the trak, run its conditions, and hand a changed answer to a
 * drive. A not-yet is nothing — the first not-yet rested the trak and is already on
 * the log, and every later one is the sweep's memory. Nothing here holds the trak's
 * key or custody; see `DrivesShape.ask`.
 */
const asking = (
  id: TrakId,
  step: number,
  land: (answer: Event) => Effect.Effect<"started" | "busy">,
): Effect.Effect<void, RuntimeError, RuntimeDeps | Deploys> =>
  Effect.gen(function* () {
    const store = yield* Store
    const trak = replayHistory(id, yield* store.events(id))
    const wait = waitingAt(trak)
    if (wait === undefined || wait.step !== step || wait.stopped) return
    const answer = yield* askConditions(trak, step)
    // What `deploy.sh` said is remembered for the list whether or not the answer
    // changes anything — the event itself reaches the log only where it did.
    const said = deployStatusOf(answer, yield* Clock.currentTimeMillis)
    if (said !== undefined) yield* (yield* Deploys).remember(id, said)
    // A not-yet is nothing — unless it moves the wait. Two ways it does: the first to
    // carry the commit the branch landed as, which a `deployed` wait learns before the
    // deploy is live — a fact about the trak, worth one line, and what refuses a
    // write agent from here — and one under a name the log does not yet hold, which
    // is the entry's own time having passed and the agent's condition behind it now
    // holding the step. That one lands so the slot names the condition, and the sweep
    // asks it on its own interval rather than on every tick past the instant.
    if (
      answer._tag === "ConditionsUnmet" &&
      !answer.stopped &&
      answer.name === wait.name &&
      (answer.merged === undefined || trak.landed !== undefined)
    ) {
      return
    }
    // `busy` here is a press that landed while the script ran, and the press wins:
    // the answer is dropped and the next sweep past the interval asks again.
    yield* land(answer)
    // Forked onto the layer's context, so it takes the held pair itself.
  }).pipe(withProjectFiles)

/**
 * The drives in flight, keyed by trak.
 *
 * **`FiberMap`, and not one of the three obvious alternatives.** `HttpRouter` hands a
 * handler the *request's* scope, so `Effect.forkScoped` attaches the drive to a scope
 * that closes as the response is sent — which is the bug this whole change exists to
 * remove. `Effect.forkDaemon` detaches it from everything, so shutdown can neither
 * interrupt it nor wait for it. `Effect.forkIn` works and leaves you hand-rolling the
 * keying, the already-running check and the teardown that `FiberMap` has.
 *
 * **A spawn's child is a drive under its own key**, which is what keeps the list true:
 * a row reads *running* when this map holds a fiber for that id, so a fan-out that
 * kept its children on the parent's fiber would leave every child idle on screen while
 * a `claude` ran for it. The key is also the whole of the idempotence — `onlyIfMissing`
 * is checked before the fork, so a second fan-out over a child already running never
 * begins a second one.
 *
 * Shutdown is the layer's scope closing: `FiberMap`'s release interrupts every drive,
 * each unwinds `Effect.scoped`, and the provider's own finalizers kill the `claude` it
 * left running. A child asked for during teardown is forked into a closed map and so
 * never starts, silently, which is the wanted answer and not a dropped error. That
 * only happens if the scope actually closes — see `serve.ts`.
 */
/**
 * Whether a child owes this daemon a drive, which is **not** the same question as
 * whether it has landed.
 *
 * Two cases, and the rest are somebody else's:
 *
 *   · a child with no log at all has never been born, and nothing but this will;
 *   · a child that is neither parked, settled nor `Failed` had a command in flight
 *     when whatever was carrying it went away — `dto.ts` calls the same shape
 *     *interrupted*, and this is that test without its custody half, because
 *     `onlyIfMissing` is the custody half.
 *
 * **A child at its own gate is left alone, and that is load-bearing rather than
 * tidy.** Every landing runs this again, so re-driving a parked sibling would
 * append a `Restarted` that changes nothing, end, and run this again — two
 * siblings answering each other for as long as the daemon is up. `Failed` is left
 * for the same reason it is left everywhere else: retrying it is a person's call,
 * and here it would be a person's call taken on a loop.
 *
 * Takes the store rather than reading it from the context, because this and the two
 * below sit at module level rather than in `DrivesLayer`'s closure, where the store
 * already is: with all three inside it, that generator runs past the 100-line cap
 * `max-lines-per-function` holds it to.
 */
const needsDriving = (store: StoreShape, id: TrakId): Effect.Effect<boolean, RuntimeError> =>
  Effect.gen(function* () {
    const log = yield* store.events(id)
    if (log.length === 0) return true
    const state = replayHistory(id, log).state
    return asGate(state) === undefined && !atRest(state) && state._tag !== "Failed"
  })

/**
 * Every trak this one's compose entries handed off and nothing has opened, a drive
 * each — `fanOut`'s twin for the traks that never come back. Read fresh for
 * `fanOut`'s reason, and over the whole plan rather than the position the trak is
 * at: the drive that took the gate has usually carried the trak on by the time it
 * ends. **Only a trak with no log at all is opened** — one with a log is somebody's
 * from its first gate on, and it has no siblings or parent for the daemon to answer
 * to. A slot each, as a child takes: a birth is a composer's turn.
 *
 * Takes the store and the forker rather than closing over them, for `needsDriving`'s
 * reason.
 */
const openHandOffs = (
  store: StoreShape,
  forkBorn: (child: TrakId, turn: Turn) => Effect.Effect<void>,
  id: TrakId,
): Effect.Effect<void, RuntimeError> =>
  Effect.gen(function* () {
    const from = replayHistory(id, yield* store.events(id))
    for (const { step, index, child } of namedHandOffs(from)) {
      if ((yield* store.events(child)).length > 0) continue
      yield* forkBorn(child, () => driveHandOff(from, step, index))
    }
  })

/**
 * Every child of a parked spawn that needs one, a drive each.
 *
 * Read fresh rather than taken from the drive that just ended: a sibling landing is
 * what runs this again, and the state that landing left is the point of running it.
 * Nothing here holds the parent's permit — a read that raced one can only over-ask,
 * and over-asking is absorbed twice over: `onlyIfMissing` refuses a child already
 * running, and `landOnParent` files nothing for one already back with nothing new.
 *
 * Takes the store and the forker rather than closing over them, for `needsDriving`'s
 * reason.
 */
const fanOut = (
  store: StoreShape,
  forkChild: (parent: Trak, step: number, index: number, child: TrakId) => Effect.Effect<void>,
  id: TrakId,
): Effect.Effect<void, RuntimeError> =>
  Effect.gen(function* () {
    const parent = replayHistory(id, yield* store.events(id))
    const waiting = parent.state
    if (waiting._tag !== "AwaitingChildren") return
    const pending = [...slotAt(parent, waiting.step).children.entries()].filter(
      ([, run]) => run.landing === undefined,
    )
    yield* Effect.forEach(
      pending,
      ([index, run]) =>
        Effect.flatMap(needsDriving(store, run.id), (needs) =>
          needs ? forkChild(parent, waiting.step, index, run.id) : Effect.void,
        ),
      { discard: true },
    )
  })

/**
 * Says the engine is leaving as the drives' scope closes. Added after the map, so it runs
 * before the map's own release interrupts every drive: a detached turn's scope closing
 * then knows the engine is leaving rather than stopping it — see `Leaving`.
 */
const leavingFirst = Effect.flatMap(Effect.serviceOption(Leaving), (leaving) =>
  Option.isSome(leaving) ? Effect.addFinalizer(() => leaving.value.leave) : Effect.void,
)

/** `DrivesShape.ask`, over the layer's two maps. At module level for `needsDriving`'s reason. */
const askingFor =
  (layer: {
    readonly map: FiberMap.FiberMap<TrakId, void, never>
    readonly asks: FiberMap.FiberMap<TrakId, void, never>
    readonly forkAsk: (
      id: TrakId,
      ask: Effect.Effect<void, never, RuntimeDeps | Feed | Deploys>,
      options: { readonly onlyIfMissing: boolean },
    ) => unknown
    readonly begin: (id: TrakId, drive: Drive) => Effect.Effect<"started" | "busy">
    readonly one: (id: TrakId, turn: Turn) => Drive
  }) =>
  (id: TrakId, step: number): Effect.Effect<"asked" | "busy"> =>
    Effect.gen(function* () {
      // A turn in flight is not asked under — the script is about the world, and
      // the trak is about to move anyway — and an ask still running is not doubled.
      if ((yield* FiberMap.has(layer.map, id)) || (yield* FiberMap.has(layer.asks, id))) {
        return "busy" as const
      }
      const land = (answer: Event): Effect.Effect<"started" | "busy"> =>
        layer.begin(
          id,
          layer.one(
            id,
            landingTurn(id, answer, (t) => stillWaitingAt(t, step)),
          ),
        )
      layer.forkAsk(
        id,
        asking(id, step, land).pipe(
          // `forkDrive`'s reason: nothing joins an ask, so an uncaught failure
          // would vanish. What reaches here is the store refusing.
          Effect.catchAllCause((cause) => Effect.logError(`ask of ${id} ended`, cause)),
        ),
        { onlyIfMissing: true },
      )
      return "asked" as const
    })

/**
 * What a copy knows of the traks other engine copies drive. Built over the leases by
 * `src/app/other-copies.ts` and offered beside `Leases`, under an external store, by
 * `src/app/layers.ts`; with no external store it is absent and every answer is *nobody else*,
 * from memory.
 *
 * A tag rather than the lease reads here so that `drive.ts`, which every flow test runs,
 * does not import the `Leases` port: an edit to it would rerun nearly every engine test,
 * and only the tests under an external store read a lease.
 */
export interface OtherCopiesShape {
  /** The trak's lease row while another copy holds it unexpired, for a press and a takeover to answer by. */
  readonly elsewhere: (id: TrakId) => Effect.Effect<LeaseRow | undefined>
  /** Whether another copy held the trak when last read, for the list. */
  readonly heldThere: (id: TrakId) => Effect.Effect<boolean>
  /** Whether another copy holds the trak's lease now. */
  readonly leaseMoved: (id: TrakId) => Effect.Effect<boolean>
  /** Wake the copy driving `id`, and wait until it lets go or its lease expires. */
  readonly awaitLetGo: (id: TrakId) => Effect.Effect<void, StoreFailed>
}

export class OtherCopies extends Context.Tag("app/OtherCopies")<OtherCopies, OtherCopiesShape>() {}

/** No external store: no other copy, so nobody else holds a trak and nothing is waited for. */
const nobodyElse: OtherCopiesShape = {
  elsewhere: () => Effect.succeed(undefined),
  heldThere: () => Effect.succeed(false),
  leaseMoved: () => Effect.succeed(false),
  awaitLetGo: () => Effect.void,
}

/**
 * `DrivesShape.takeOver`, over the layer's map, what it knows of other copies, how it makes
 * a drive and how it forks one. At module level for `needsDriving`'s reason.
 */
const takingOver =
  (layer: {
    readonly map: FiberMap.FiberMap<TrakId, void, never>
    readonly store: StoreShape
    readonly copies: OtherCopiesShape
    readonly setups: SetupsShape
    readonly one: (id: TrakId, turn: Turn) => Drive
    readonly forkDrive: (
      id: TrakId,
      drive: Drive,
      options: { readonly onlyIfMissing: boolean },
    ) => Effect.Effect<boolean>
  }) =>
  (id: TrakId, then: Turn): Effect.Effect<void, RuntimeError> =>
    Effect.gen(function* () {
      // `remove` interrupts and awaits: a fiber's exit is after its finalizers, so
      // by the time this returns the `claude` is dead, `run.json` is clear and the
      // trak's permit is free. Interrupting nothing is a no-op, which is what makes
      // this the same call for a trak with a drive and a trak without one.
      yield* FiberMap.remove(layer.map, id)
      // Under an external store the drive may be another copy's: woken, and waited for.
      yield* layer.copies.awaitLetGo(id)
      // The setup the interrupted drive's work started goes with it, before anything the
      // press leads to can act on the checkout — an abandon removes it. The work after
      // starts setup again where the log still owes it.
      yield* layer.setups.stop(id)
      // **Read again, because the interrupted drive may have been the ending.** The
      // route's own at-rest check was made before the wait, and the drive this just
      // waited for could have settled the trak on its way out — a double press,
      // or an ending asked for as the last step landed. `decide` answers an ending
      // at a trak already over with `Failed{engine}`, so a request that arrived one
      // moment too late would end a healthy trak rather than doing nothing.
      if (atRest(replayHistory(id, yield* layer.store.events(id)).state)) return
      // A copy that died, or let go when it lost the lease, can have left a command
      // running that this drive ends rather than rejoins.
      const takenOver = layer.one(id, (resuming) =>
        Effect.andThen(
          Effect.flatMap(Runs, (runs) => runs.stopLeft(id)),
          then(resuming),
        ),
      )
      yield* layer.forkDrive(id, takenOver, { onlyIfMissing: false })
    })

/**
 * `DrivesShape.stopping`, over the layer's take-over and its own scope — so a stop's
 * take-over outlives the request that asked for it and ends with the engine, as a drive
 * does. At module level for `needsDriving`'s reason.
 */
const stoppingIn =
  (
    takingOverWith: (id: TrakId, then: Turn) => Effect.Effect<void, RuntimeError>,
    scope: Scope.Scope,
  ) =>
  (id: TrakId, kept: string | undefined): Effect.Effect<void> =>
    Effect.asVoid(
      Effect.forkIn(
        takingOverWith(id, () => owedStop(id, kept)).pipe(
          Effect.catchAllCause((cause) => driveEnded(id, cause)),
        ),
        scope,
      ),
    )

/** `DrivesShape.bear`, over the layer's map, `begin` and `one`. At module level for `needsDriving`'s reason. */
const bearing =
  (
    map: FiberMap.FiberMap<TrakId, void, never>,
    begin: (id: TrakId, drive: Drive) => Effect.Effect<"started" | "busy">,
    one: (id: TrakId, turn: Turn) => Drive,
  ): DrivesShape["bear"] =>
  (id, event) =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<"born" | "busy" | "unwritten">()
      const drive = one(id, (resuming) =>
        advanceTelling(id, event(resuming), Deferred.succeed(answer, "born")),
      )
      // The first answer stands, so a drive that wrote the birth is `born` however it ends.
      const told = Effect.onExit(drive, (exit) =>
        Deferred.succeed(answer, heldElsewhere(exit) ? "busy" : "unwritten"),
      )
      if ((yield* begin(id, told)) === "busy") return "busy" as const
      const said = yield* Deferred.await(answer)
      // The fiber answers before it leaves the map, so a birth that was refused waits for
      // it to go: a caller reading `driving` after the answer finds nothing.
      if (said !== "born") {
        yield* Effect.flatMap(FiberMap.get(map, id), Fiber.await).pipe(Effect.option)
      }
      return said
    })

/** `DrivesShape.sayWaiting`, over the layer's `begin`. At module level for `needsDriving`'s reason. */
/**
 * `DrivesShape.reenter`, given the layer's `begin` and `one`. The trak is read again
 * under the key: the route's read was made before it. A drive that ends without
 * answering — refused the lease by another engine copy — answers `Driving`.
 */
const reenteringWith =
  (
    store: StoreShape,
    begin: (id: TrakId, drive: Drive) => Effect.Effect<"started" | "busy">,
    one: (id: TrakId, turn: Turn) => Drive,
  ): DrivesShape["reenter"] =>
  (id, event) =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<Either.Either<void, RefusalDto>>()
      const say = (said: Either.Either<void, RefusalDto>) => Deferred.succeed(answer, said)
      const turn: Turn = () =>
        Effect.gen(function* () {
          const trak = replayHistory(id, yield* store.events(id))
          const chosen = Effect.gen(function* () {
            if (!atRest(trak.state))
              return yield* Effect.as(say(Either.left(NotAtRestDto.make({}))), undefined)
            const moved = yield* moveIfMerged(trak)
            if (Either.isLeft(moved)) {
              return yield* Effect.as(
                say(Either.left(BranchNotMovedDto.make({ why: moved.left }))),
                undefined,
              )
            }
            return yield* Effect.as(say(Either.right(undefined)), event(moved.right))
          })
          return (yield* advanceAfter(id, chosen)) ?? trak
        })
      const drive = Effect.ensuring(one(id, turn), say(Either.left(DrivingDto.make({}))))
      if ((yield* begin(id, drive)) === "busy") return "busy" as const
      return yield* Deferred.await(answer)
    })

const sayingWaiting =
  (
    store: StoreShape,
    begin: (id: TrakId, drive: Drive) => Effect.Effect<"started" | "busy">,
    one: (id: TrakId, turn: Turn) => Drive,
  ) =>
  (id: TrakId): Effect.Effect<void, RuntimeError> =>
    Effect.gen(function* () {
      if (heldChat(replayHistory(id, yield* store.events(id))) === undefined) return
      // Read again under the permit, for `landingTurn`'s reason: a stop may have
      // handed the messages back between that read and this drive.
      yield* begin(
        id,
        one(id, () =>
          Effect.gen(function* () {
            const trak = replayHistory(id, yield* store.events(id))
            const chat = heldChat(trak)
            return chat === undefined ? trak : yield* advance(id, chat)
          }),
        ),
      )
    })

export const DrivesLayer = Layer.scoped(
  Drives,
  Effect.gen(function* () {
    const store = yield* Store
    const copies = Option.getOrElse(yield* Effect.serviceOption(OtherCopies), () => nobodyElse)
    const map = yield* FiberMap.make<TrakId, void, never>().pipe(Effect.tap(() => leavingFirst))
    // Set as the layer's scope starts to close, before the map's own release closes it:
    // finalizers run in reverse, and the map does not say it is closed.
    const shut = { closed: false }
    yield* Effect.addFinalizer(() => Effect.sync(() => (shut.closed = true)))
    // Captured here, at layer build, so a forked drive carries the daemon's context.
    // Taken from the request instead it would carry that request's `HttpServerRequest`,
    // which is dead by the time the turn runs.
    const fork = yield* FiberMap.runtime(map)<RuntimeDeps | Feed>()
    const slots = yield* Effect.makeSemaphore(CHILD_CONCURRENCY)
    /**
     * The asks in flight, keyed by trak — a second map rather than the first, because
     * an ask must not hold a trak's drive key. Its own key is what keeps one script
     * from running twice for one trak, and the layer's scope closing is what stops
     * every ask at shutdown, as it stops every drive.
     */
    const asks = yield* FiberMap.make<TrakId, void, never>()
    const forkAsk = yield* FiberMap.runtime(asks)<RuntimeDeps | Feed | Deploys>()
    const { carry, carried } = yield* carrying
    const one = (id: TrakId, turn: Turn): Drive => driveOne(id, turn, carry)

    /**
     * Fork a drive under its trak's key, and start whatever it leaves parked on
     * children.
     *
     * The fan-out is here rather than inside the drive because it is a statement about
     * fibers, and `fork` exists only in this scope: `FiberMap.runtime` captures the
     * context at layer build, which cannot contain the layer being built.
     *
     * `onlyIfMissing` is what a key already taken means, and it is checked before
     * the fork, so the caller that stands down never begins running. Every caller
     * but the take-over stands down; the take-over replaces, because it has already
     * waited for the key to clear and a drive that arrived during that wait would
     * otherwise swallow an ending the route has answered `202` for.
     */
    const forkDrive = (
      id: TrakId,
      drive: Drive,
      options: { readonly onlyIfMissing: boolean },
    ): Effect.Effect<boolean> =>
      Effect.sync(() => {
        // The map's own refusals, read in the same synchronous step as the fork so nothing
        // can take the key between them: it runs nothing on a closed map, or under
        // `onlyIfMissing` on a key already taken, and says so only by handing back an
        // interrupted fiber. A caller waiting on the drive needs to know it never began.
        if (shut.closed) return false
        if (options.onlyIfMissing && FiberMap.unsafeHas(map, id)) return false
        fork(
          id,
          drive.pipe(
            Effect.flatMap((parked) =>
              Effect.forEach(
                parked,
                (t) =>
                  Effect.andThen(fanOut(store, forkChild, t), openHandOffs(store, forkBorn, t)),
                {
                  discard: true,
                },
              ),
            ),
            // **Not optional.** `FiberMap` routes a failure into a `Deferred` only
            // `FiberMap.join` observes, and nothing joins a drive — so an uncaught
            // one would vanish with no log line and no failed trak. Every failure
            // `advance` can absorb is already on the log; what reaches here is the
            // store refusing, which is worth a line and nothing else.
            Effect.catchAllCause((cause) => driveEnded(id, cause)),
          ),
          options,
        )
        return true
      })

    /**
     * A trak this daemon opens rather than is asked for — a spawn's child or a
     * hand-off — under its own key and holding one of the bounded slots.
     */
    const forkBorn = (child: TrakId, turn: Turn): Effect.Effect<void> =>
      Effect.asVoid(
        forkDrive(child, slots.withPermits(1)(one(child, turn)), { onlyIfMissing: true }),
      )

    /**
     * One child, bounded, born or picked up by `driveChild`, under its own key.
     *
     * The turn it is picking up is deliberately not passed on: which turn the
     * pick-up's `Restarted` ends is stamped at the append from the same record
     * `adopt` read, so there is nothing here to forget. The session that turn was
     * using is the half nobody carries yet —
     * the deferred entry *a child cut off before its first reply loses the session it was using*.
     */
    const forkChild = (parent: Trak, step: number, index: number, child: TrakId) =>
      forkBorn(child, () => driveChild(parent, step, index))

    /** The drive a surface asks for: one event, applied to the trak it names. */
    const asked = (id: TrakId, event: ChooseEvent): Drive =>
      one(id, (resuming) => advance(id, event(resuming)))

    /** Fork `drive` under the trak's key, unless it already has one here or another copy drives it. */
    const begin = (id: TrakId, drive: Drive): Effect.Effect<"started" | "busy"> =>
      Effect.gen(function* () {
        if (yield* FiberMap.has(map, id)) return "busy" as const
        // A read that yields under an external store, so the key can be taken during it — which
        // `forkDrive`'s answer catches.
        if ((yield* copies.elsewhere(id)) !== undefined) return "busy" as const
        return (yield* forkDrive(id, drive, { onlyIfMissing: true })) ? "started" : "busy"
      })

    const start = (id: TrakId, event: ChooseEvent): Effect.Effect<"started" | "busy"> =>
      begin(id, asked(id, event))

    const bear = bearing(map, begin, one)

    const ask = askingFor({ map, asks, forkAsk, begin, one })

    const setups = yield* Setups
    const takingOverWith = takingOver({ map, store, copies, setups, one, forkDrive })
    const takeOver = (id: TrakId, event: ChooseEvent) =>
      takingOverWith(id, (resuming) => advance(id, event(resuming)))
    const stopping = stoppingIn(takingOverWith, yield* Effect.scope)

    const startIfStill = (
      id: TrakId,
      event: Event,
      holds: (trak: Trak) => boolean,
    ): Effect.Effect<"started" | "busy"> => begin(id, one(id, landingTurn(id, event, holds)))

    const runNow = (id: TrakId, step: number, event: Event): Effect.Effect<"started" | "busy"> =>
      startIfStill(id, event, (t) => stillHeldAt(t, step))

    const sayWaiting = sayingWaiting(store, begin, one)
    const reenter = reenteringWith(store, begin, one)

    const here = (id: TrakId) => FiberMap.has(map, id)
    const driving = (id: TrakId) =>
      Effect.flatMap(here(id), (held) =>
        held ? Effect.succeed(true) : Effect.map(copies.elsewhere(id), (row) => row !== undefined),
      )
    const running = (id: TrakId) =>
      Effect.flatMap(
        Effect.zipWith(here(id), carried(id), (a, b) => a || b),
        (moving) => (moving ? Effect.succeed(true) : copies.heldThere(id)),
      )
    return {
      start,
      bear,
      takeOver,
      stopping,
      ask,
      runNow,
      startIfStill,
      driving,
      running,
      sayWaiting,
      reenter,
      letGo: (id: TrakId) => Effect.andThen(FiberMap.remove(map, id), setups.stop(id)),
      leaseMoved: (id: TrakId) =>
        Effect.flatMap(copies.leaseMoved(id), (taken) => (taken ? setups.stop(id) : Effect.void)),
    }
  }),
)

/** What a request that asked for a drive is told: `202` and the id, or `409` busy. */
const forked = (id: TrakId) => (outcome: "started" | "busy") =>
  outcome === "busy"
    ? ServerResponse.json(DrivingDto.make({}), { status: 409, statusText: "Driving" })
    : ServerResponse.json({ id } satisfies CreatedDto, { status: 202 })

/**
 * Ask for a drive, and answer with what happened to the asking rather than with the
 * trak's new state.
 *
 * **`202`, and the body is the id.** The turn has not run and there is nothing true to
 * say about it yet; a watcher reads `GET /api/stream` for the rest. Returning the
 * trak's state here would mean either blocking on the turn — which is what this
 * replaces — or sending a state that is already stale.
 *
 * **One refusal, where there used to be two.** A trak this daemon is already driving
 * is answered from memory, and with no external store there is nobody else to be driving it:
 * one process does all the writing, so *held by another pid* is not a state that exists.
 * Under an external store a trak another copy holds the lease of is the same `409`.
 *
 * `start` does the check rather than the caller, because two requests for one trak can
 * both pass a read — `onlyIfMissing` is what makes the loser lose, and it is checked
 * before the fork, so the loser never begins.
 */
export const startDrive = (id: TrakId, event: ChooseEvent) =>
  Effect.flatMap(Drives, (drives) => Effect.flatMap(drives.start(id, event), forked(id)))

/** `DrivesShape.reenter`, for the two doors that re-enter a trak on someone's word. */
export const reenterDrive = (id: TrakId, event: (moved: BranchMoved | undefined) => Event) =>
  Effect.flatMap(Drives, (drives) => drives.reenter(id, event))

/**
 * Run the step a resting trak is held at, now — its wait not met — and answer as
 * `startDrive` does.
 *
 * **`merged` is asked once more first, and outside the key**, as the sweep's asks
 * are: one forge listing, so a write agent is refused from a branch that went in
 * while the trak rested, and a person's other press wins over the asking. What it
 * learns rides the event rather than being a second append, so the drive is one
 * event under the permit and then the step. A trak something took meanwhile is
 * turned away as any other press is, with nothing appended — by `runNow`'s busy
 * check where the other press is still running, and by its re-read under the
 * permit where it has already landed, since the route's read is from before the
 * forge call.
 *
 * Here rather than in the route because it reaches the runtime, and this is the
 * one file in `app/` that may.
 */
export const skipWait = (trak: Trak, wait: Wait) =>
  Effect.gen(function* () {
    const merged = yield* askMerged(trak)
    const drives = yield* Drives
    const event = Events.waitSkipped(wait.step, wait.name, merged)
    return yield* Effect.flatMap(drives.runNow(trak.id, wait.step, event), forked(trak.id))
  })

/**
 * Skip the failed effect at `step` and the effects after it, and answer as `startDrive`
 * does.
 *
 * **Appended only if a failed effect at `step` still stops the trak once the permit is
 * taken.** The route's read is from before the drive: a restart pressed in another tab
 * can land in between, and a skip appended to the trak it left would be an `EffectsRan`
 * `decide` cannot route, settling a healthy trak `Failed{engine}`. So a late skip is
 * dropped, as `skipWait`'s late answer is.
 */
export const skipFailedEffect = (
  id: TrakId,
  step: number,
  skipped: readonly [string, ...string[]],
) =>
  Effect.flatMap(Drives, (drives) =>
    Effect.flatMap(
      drives.startIfStill(
        id,
        Events.effectsRan(step, [], skipped),
        (t) => effectFailedAt(t) === step,
      ),
      forked(id),
    ),
  )

/**
 * Append one event that moves nothing, without taking the drive — and answer `204`.
 *
 * **The third door, and the only one that reaches a trak while something is driving
 * it without killing anything.** A change to how a trak is run is picked up at its
 * next gate, so it has no turn to run and needs no fiber: `advance` decides it under
 * the trak's *log* permit — the same permit every step of the drive in flight takes
 * for its own read-decide-append — and settles or re-parks. That serialisation is the
 * whole of what makes this safe beside a running turn: the drive's next decision reads
 * a log this is already on, and replay agrees with it.
 *
 * `decide` never `unexpected`s these events, which is what lets this skip the parked
 * check every other action makes. At rest there is no next gate, so a mode, a hold or a
 * skip means nothing there and their routes refuse it; auto-merge's is taken at
 * `Finished`, where the forge sweep reads it, and `decide` settles the trak where it is.
 *
 * `record` rather than `advance`: this fiber is a request's and holds no drive key, so
 * it must not be the one that runs a parked trak's waiting chat.
 *
 * `204` rather than `202`: nothing was forked, and the trak's new mode is already on
 * the stream by the time this answers.
 */
export const appendSetting = (id: TrakId, event: Event) =>
  Effect.map(record(id, event), () => ServerResponse.empty({ status: 204 }))

/**
 * Write on a finished trak's log which goal its finish's proposal started as —
 * `appendSetting`'s door, for the goal's watcher: the event moves nothing, and the trak
 * is at rest with no drive to take.
 */
export const noteGoalOpened = (id: TrakId, step: number, goal: GoalId) =>
  Effect.asVoid(record(id, Events.goalOpened(step, goal)))

/**
 * Keep a message a person sent while the trak was not at a gate, and try to deliver it.
 *
 * **Written to the log as waiting first, whatever happens next** — `appendSetting`'s
 * door, so nothing is killed and nothing is forked for it. Then one attempt down the
 * pipe of the turn in flight, if there is one: the provider answers `false` for a
 * turn with no open pipe — a check running, a CLI with no streaming input, a turn
 * past its answer — and the message simply stays waiting. Delivery is never this
 * answer; it is the turn's own `MessageDelivered`, which takes the message off the
 * list. What nobody reads goes to the next turn that starts, or is the chat at the
 * gate the trak parks at, and `sayWaiting` covers a park that happened under this.
 *
 * `202` and the id, as a chat at a gate answers: the caller is told the same thing by
 * either door and does not learn which one it was.
 */
export const holdMessage = (
  id: TrakId,
  message: string,
  attachments: readonly Attachment[] | undefined,
  cwd: string,
) =>
  Effect.gen(function* () {
    const key = randomUUID()
    yield* record(id, Events.messageWaiting(key, message, attachments))
    const turn = yield* (yield* Runs).inFlight(id)
    if (turn !== undefined) {
      // By the id the turn was requested under, which is what its pipe is held by —
      // the record's `sessionId` is the one the provider announced.
      const steered = yield* steeredMessage(yield* Prompts, key, message, attachments ?? [], cwd)
      yield* (yield* Provider).steer(turn.minted ?? turn.sessionId, steered)
    }
    yield* (yield* Drives).sayWaiting(id)
    return yield* ServerResponse.json({ id } satisfies CreatedDto, { status: 202 })
  })

/**
 * Ask for a drive that overrides the one in flight, and answer the same `202`.
 *
 * **The routes that have no `409 Driving` to give.** Every other action refuses a trak
 * something is already driving, which is what keeps a double press off one log; ending a
 * trak, recomposing or filing mid-turn, and stopping it — through `stopDrive` — are the
 * actions for which overriding the drive *is* the request, and a person told *something
 * is already driving this* is being refused for the reason they pressed.
 *
 * **The answer waits for the interruption, and the wait is what it is worth.** A
 * `202` sent before the key was taken would promise a drive that a fiber still
 * unwinding could still lose — so this one costs the caller a kill, where every
 * other action costs them nothing.
 */
export const takeOverDrive = (id: TrakId, event: ChooseEvent) =>
  Effect.gen(function* () {
    const drives = yield* Drives
    yield* drives.takeOver(id, event)
    return yield* ServerResponse.json({ id } satisfies CreatedDto, { status: 202 })
  })

/**
 * Stop the turn in flight: write the person's intent, then kill — and answer `202` once
 * the intent is on the log, not once the kill is done.
 *
 * **The order is the point.** A stop that killed first and appended after left a window
 * where an engine dying between the two rejoined a detached sandbox turn on its next boot
 * as if nobody had pressed anything. `StopRequested` goes on the log through `intend`, under
 * the log permit and without the drive, and moves the trak to `Stopping`; a restart there
 * finishes the kill rather than rejoining the turn. Only then is the drive taken over, in
 * the background, and `StopTurn` run on it — see `DrivesShape.stopping`.
 *
 * **The turn's sandbox command is kept past its close**, so the interruption leaves its
 * record standing — and a detached one running — and the kill that ends it is
 * `StopTurn`'s through the seam operation, classified and retried, where the close's own
 * kill is one try that logs a failure and forgets it. `exec` is that command, read off the
 * run record with the session: a detached one, or one written before its spawn reported.
 * A press that raced the turn's own ending appends and kills nothing: `decide` re-parked
 * it.
 */
export const stopDrive = (id: TrakId, event: Event, exec: string | undefined) =>
  Effect.gen(function* () {
    // Only the press that moved the trak into `Stopping` takes the drive over. A second
    // press that raced it to the same `AgentWorking` re-parks there, and taking over
    // again would interrupt the first press's kill and run it twice.
    const { trak, moved } = yield* intend(id, event)
    if (moved && trak.state._tag === "Stopping") {
      const leaving = Option.getOrUndefined(yield* Effect.serviceOption(Leaving))
      if (exec !== undefined && leaving !== undefined) yield* leaving.keep(exec)
      yield* (yield* Drives).stopping(id, exec)
    }
    return yield* ServerResponse.json({ id } satisfies CreatedDto, { status: 202 })
  })

/**
 * Archive every child of `parent` that is still out, the way the parent is being
 * archived: each one's drive taken over and `Abandoned` forked in its place, so a
 * child mid-turn is killed and its checkout and branch go as its parent's do. One
 * level, because a child may not spawn.
 *
 * **After the parent's own take-over, never before.** Each child lands on its parent
 * as it ends, and `landOnParent` files nothing for a parent that is not waiting on its
 * children — so the parent has to have left `AwaitingChildren` first, or the last child
 * back would join the spawn and carry a parent somebody is ending into its next step.
 * The parent's fork is on the map before this runs and its append is one permit away;
 * a child's is behind a kill and two git operations.
 *
 * **Which children: every unlanded one with a log that is not at rest**, read off every
 * slot rather than the parent's state — a parent can be `Failed` at a spawn with its
 * children still running. A child that was never born has nothing to archive, and one
 * already ending is left to finish, for the reason `abandonRoute` refuses the parent
 * in that case. Concurrent, because each take-over waits out a kill.
 */
export const abandonChildren = (parent: Trak, reason: string) =>
  Effect.gen(function* () {
    const store = yield* Store
    const drives = yield* Drives
    const runs = yield* Runs
    const out = [...parent.slots.values()].flatMap((slot) =>
      slot.children.filter((run) => run.landing === undefined).map((run) => run.id),
    )
    yield* Effect.forEach(
      out,
      (id) =>
        Effect.gen(function* () {
          const events = yield* store.events(id)
          if (events.length === 0) return
          const child = replayHistory(id, events)
          if (atRest(child.state)) return
          if (ENDING.has(child.state._tag) && (yield* drives.driving(id))) return
          // The child's turn, read before the kill as `abandonRoute` reads the parent's:
          // `takeOver` adopts only after the interruption, by which time the record is
          // clear, so its `resuming` never names the turn this ending is the ending of.
          const turn = yield* runs.inFlight(id)
          yield* drives.takeOver(id, () =>
            Events.abandoned(reason, turn?.sessionId, turn?.step, turn?.usage),
          )
        }),
      { concurrency: "unbounded", discard: true },
    )
  })

/**
 * The states that are an ending already running — `abandonRoute`'s set, shared with the
 * cascade so a child is left alone at exactly the states its parent would be refused at.
 * Typed on the tag, so a renamed state is a compile error rather than a set that quietly
 * stops matching.
 */
export const ENDING: ReadonlySet<TrakState["_tag"]> = new Set<TrakState["_tag"]>([
  "Merging",
  "Closing",
  "Abandoning",
])

/** What opening a trak for a goal came to. */
export type Opening = Data.TaggedEnum<{
  Opened: { readonly id: TrakId }
  Busy: {}
}>
const Opening = Data.taggedEnum<Opening>()

/**
 * Where a goal's trak is cut from: `origin/<default>`, fetched just now — so a trak
 * opened after its sibling's pull request merged starts with that work in it. A goal
 * with a goal branch cuts from `origin/<goal branch>` instead, the tip that holds the
 * traks already landed. The project checkout is never pulled or moved; the fetch
 * touches only remote-tracking refs.
 *
 * A fetch that fails is logged and the last-fetched tip is used: a network blip is no
 * reason to stop a goal, and that ref is still the forge's rather than the person's.
 * `undefined` — the project checkout's `HEAD`, as a person's trak — where there is no
 * `origin` or nothing says which branch is its default.
 */
const goalBase = (goalBranch: BranchName | undefined) =>
  Effect.gen(function* () {
    const vcs = yield* Vcs
    const refused = yield* vcs
      .fetch()
      .pipe(
        Effect.catchTag("GitFailed", (e) =>
          Effect.as(
            Effect.logWarning(`goal trak: fetch failed, cutting from the last one: ${e.reason}`),
            undefined,
          ),
        ),
      )
    if (refused !== undefined) return undefined
    const named = goalBranch ?? (yield* vcs.defaultBranch())
    return named === undefined ? undefined : BranchName.make(`origin/${named}`)
  })

/**
 * Open a trak for a goal: what the create route does for a person, under the goal's name.
 *
 * Uncommitted work in the project checkout is left alone, as it is for a person's start:
 * the trak branches from a commit, and the checkout is never touched.
 * `autoMerge` is whether the engine merges the trak's pull request on its own — the goal
 * file's limit on it is the caller's to read. `goalBranch` is the goal's, where it has one,
 * and `owner` the goal's owner, which a goal's trak takes as its own.
 */
export const openTrak = (
  description: string,
  mode: RunMode,
  goal: GoalId,
  autoMerge = false,
  goalBranch?: BranchName,
  owner?: UserId,
) =>
  Effect.gen(function* () {
    yield* (yield* Vcs).ensureIgnored()
    const base = yield* goalBase(goalBranch)
    const id = yield* (yield* Ids).newTrakId
    // A minted id is never already driving — the create route says why it asks anyway.
    const started = yield* (yield* Drives).start(id, () =>
      Events.trakForGoal(description, mode, goal, base, autoMerge, goalBranch, owner),
    )
    return started === "busy" ? Opening.Busy() : Opening.Opened({ id })
  })
