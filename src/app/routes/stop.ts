// Stopping what runs: a turn or a check, one background task of a turn, and asking a step
// to file what it has.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import type { CreatedDto } from "@orkestra/shared/dto/actions"
import { NothingToStopDto } from "@orkestra/shared/dto/common"
import { Provider } from "../../agent/ports/provider.js"
import { slotAt, type Trak, type TrakId } from "../../workflow/domain/trak.js"
import { Events } from "../../workflow/domain/event.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { skippable } from "../../workflow/domain/decide.js"
import { Checks } from "../../workflow/ports/checks.js"
import { Runs } from "../../workflow/ports/runs.js"
import { Store } from "../../workflow/ports/store.js"
import { Drives, startDrive, stopDrive, takeOverDrive } from "../drive.js"
import { ownerOnly, pathId, refuse } from "./common.js"

/**
 * Is there an agent turn here for an interruption to reach?
 *
 * **Two positions and no others**, which is the whole of what a stop applies to. A step's
 * turn parks at its own conversation gate, and a composer's parks at the plan gate — so a
 * composer writing a trak's *first* plan is excluded by the plan rather than by the state:
 * the plan gate's meaning is *a plan is on the table*, and there is nothing for a stop to
 * leave one at. Abandoning is the way out of that one.
 *
 * Everything else is refused because interrupting it would leave the trak somewhere no
 * gate exists: the setup script is a shell script, every `Merging`, `Closing`,
 * `Committing` and `Integrating` is git, `Spawning` mints ids, and a parent in
 * `AwaitingChildren` has nothing of its own running — you stop a child on the child.
 * `Effecting` is a shell script too, and the one whose cost is not this checkout's: what a
 * kill would cut in half is already acting somewhere else. A running check is the one
 * script that *does* have a gate to land at, and `stopRoute` takes it ahead of this.
 */
const stoppable = (trak: Trak): boolean =>
  trak.state._tag === "AgentWorking" || (trak.state._tag === "Composing" && trak.plan !== undefined)

/**
 * End the check that is running, and park the trak at the `checks` gate a failing one
 * already opens — Approve, Chat or Replan.
 *
 * **A branch of the stop rather than a route of its own**: one press means *stop what is
 * running*, whatever it is. It takes the same door — the drive's key, so the interruption
 * closes the scope that kills the script — and refuses for the same reason where nothing
 * of this daemon's is driving: with no fiber to interrupt, the event would park the trak
 * while the script ran on and its own ending arrived at a gate.
 *
 * The name of the check is read off the daemon's memory of the run **before** the
 * interruption, which is what settles that memory and is the one thing that could name
 * it. Absent where the press raced the run starting, and nothing is refused for it: a
 * cancel carries no session, so unlike a stop there is nothing here a later press could
 * not recover.
 */
const cancelChecks = (id: TrakId, step: number) =>
  Effect.gen(function* () {
    const drives = yield* Drives
    if (!(yield* drives.driving(id))) return yield* refuse(409, NothingToStopDto.make({}))
    const checks = yield* Checks
    const live = yield* checks.live(id)
    const name = live?.step === step ? live.name : undefined
    return yield* takeOverDrive(id, () => Events.checksCancelled(step, name))
  })

/**
 * Stop the turn in flight and park the trak where a person can say what they want
 * instead.
 *
 * **Intent first, then the kill.** The press appends `StopRequested`, which moves the trak
 * to `Stopping`, and is answered `202` as soon as that is on the log; the drive is then
 * taken over in the background and `StopTurn` kills what runs — locally the drive's scope
 * release, SIGTERM, a grace period, then SIGKILL; remotely `runner.sh kill` through the
 * seam operation — and its `Stopped` opens the gate. A restart in `Stopping` finishes the
 * kill rather than rejoining the turn. `stopDrive` in `src/app/drive.ts` has the order and
 * why it is the whole fix.
 *
 * **The grace period is not politeness and must not be shortened.** A group kill reaches
 * `claude` and nothing else: the Bash tool's shell is in its own process group, and it is
 * `claude`'s own SIGTERM handler that takes it down. Anything that reached the agent with
 * a SIGKILL first would leave a `pnpm install` running in a worktree Orkestra is about to
 * commit — see the `provider-hazards` skill, under *Killing*.
 *
 * **The session is read here, before the kill, and that is the one thing this route
 * cannot get wrong quietly.** `Runs.turn` is an `acquireRelease` whose release clears the
 * record, so the unwinding that kills the agent destroys the only note of which
 * conversation it was holding — and a first turn's session exists nowhere else. Read
 * afterwards, the resumed turn would answer having forgotten everything.
 *
 * **A press before the run record exists is accepted, and cancels the pending spawn.**
 * The state and the record disagree for the whole of a turn's way to its spawn: under a
 * runner that is waking the sandbox, copying the session in and opening `reach` —
 * `withSessionCopies`, then `reach`, then `inFlight` in `src/workflow/runtime.ts` — and it
 * can take minutes. The take-over interrupts that drive before `inFlight` runs, so nothing
 * is spawned, and the kill finds nothing running. **The session is then the slot's** — the
 * one `SpawnStep` was going to resume, or the composer's own — so the person's message
 * at the gate carries on that conversation. A first turn has none: the message then starts
 * the step's first turn, with the full step prompt and the message as guidance, because
 * `promptTrigger` renders a turn with nothing to continue as `Initial`. Refusing with 409
 * instead was right for a window of milliseconds, where a second press a moment later
 * would land; across a window of minutes the person never gets that second press.
 *
 * **What this does not refuse is a crashed `AgentWorking`**, and the record is why:
 * `reap` clears the dead holder and never the turn, so the turn a dead daemon was
 * holding is still there to be read, and the stop parks the trak carrying that session.
 *
 * **A second press in `Stopping` is the same press**: a screen that has not yet drawn the
 * state still offers Stop, and it is answered `202` with nothing appended — the kill is
 * already under way.
 *
 * **A running check is stopped by the same press**, and its branch is taken first: at
 * `CheckRunning` there is no turn record at all. `cancelChecks` carries what it costs and
 * what it refuses.
 *
 * 404 unknown id · 409 nothing here is an agent turn or a check.
 */
const stopRoute = Router.post(
  "/api/traks/:id/stop",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    if (trak.state._tag === "CheckRunning") return yield* cancelChecks(id, trak.state.step)
    if (trak.state._tag === "Stopping") {
      return yield* ServerResponse.json({ id } satisfies CreatedDto, { status: 202 })
    }
    if (!stoppable(trak)) return yield* refuse(409, NothingToStopDto.make({}))

    // The turn's own record, where there is one: which session to carry on, which
    // position this stop is the ending of, its spend, and the detached command the kill
    // has to reach. `step` is absent for the composer, which has no position.
    const runs = yield* Runs
    const turn = yield* runs.inFlight(id)
    if (turn !== undefined) {
      return yield* stopDrive(
        id,
        Events.stopRequested(turn.sessionId, turn.step, turn.usage),
        // Every exec the record names, a detached one and one written before its spawn
        // reported: each is kept past its close, so `StopTurn`'s kill is the one that ends it.
        turn.rejoin ?? turn.execId,
      )
    }
    // Before the spawn: the session the turn was going to resume — the step's slot, or
    // the composer's own, which `Compose` resumes a revision on.
    const step = trak.state._tag === "AgentWorking" ? trak.state.step : undefined
    const session = step === undefined ? trak.composerSession : slotAt(trak, step).session
    return yield* stopDrive(id, Events.stopRequested(session, step), undefined)
  }),
)

/**
 * Stop one named background task of the turn in flight, and nothing else — the turn
 * keeps running, and so does every other task.
 *
 * **A control line down the turn's own open pipe, not a model turn, so it spends
 * nothing** — which is why it is not `stopRoute`'s twin: that press kills the whole turn
 * and parks the trak, where this one asks the provider to end one job the agent left
 * running. The two are different presses with different consequences and must not share
 * an endpoint.
 *
 * **The turn's record is a condition of accepting** — the session id on it is the only
 * key into the provider's held-open pipes. The provider can
 * still answer no: the pipe belongs to this process, so a turn a dead daemon left in
 * flight has a record and no pipe, and a task that has already landed is stopped by
 * nothing. Both are the same refusal, because the person's situation is the same —
 * nothing here is a running task a stop can reach. The success is intentionally not the
 * outcome: what a caller watches is the stream, where the level shrinks and the task's
 * own `stopped` notification lands.
 *
 * 404 unknown id · 409 no turn in flight, or no open pipe to write the stop down.
 */
const stopTaskRoute = Router.post(
  "/api/traks/:id/background/:taskId/stop",
  Effect.gen(function* () {
    const id = yield* pathId
    const params = yield* Router.params
    const taskId = params["taskId"]
    if (taskId === undefined || taskId === "") return ServerResponse.empty({ status: 400 })
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const runs = yield* Runs
    const turn = yield* runs.inFlight(id)
    if (turn === undefined) return yield* refuse(409, NothingToStopDto.make({}))
    const provider = yield* Provider
    const wrote = yield* provider.stopBackgroundTask(turn.sessionId, taskId)
    if (!wrote) return yield* refuse(409, NothingToStopDto.make({}))
    return ServerResponse.empty({ status: 204 })
  }),
)

/**
 * Ask the step to file what it has, and let nobody type.
 *
 * **`stopRoute`'s twin with the opposite ending, and one route for both places it is
 * pressed.** A turn still running is killed as a stop used to kill one — the take-over,
 * the grace period and the record read *before* the interruption, waited for before the
 * `202` — and the step is then re-entered on the session that record named, under
 * `Trigger.Filing`. **Unlike a stop it refuses before the record exists**: it moves onto
 * the seam operation in a later build, and until then a press there is answered 409. A
 * step parked at a gate with nothing filed has nothing to kill: the slot already holds
 * the session, so this is an ordinary drive from a gate, refused where one is already
 * running as every action from a gate is.
 *
 * **Every step gate where nothing has been filed, and never the composer.** `skippable`
 * is the set: a conversation the step parked in, a question it asked, or an account of
 * why it is stuck — each a gate with no document to take, so *file what you have* has
 * something to ask for. The **approval and checks** gates are refused for the reason
 * `Skip` is refused there — a document is already on the table. A stop reaches a composer
 * because a plan is filed by proposing it and the person has one to fall back on; there
 * is nothing for *file what you have* to add to that, so the composer is refused too.
 *
 * 404 unknown id · 403 not the owner · 409 nothing here is a step's turn or a gate with nothing filed, or
 * none is running yet · 409 already driving, at the parked gate.
 */
const fileRoute = Router.post(
  "/api/traks/:id/file",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const notOwner = yield* ownerOnly(trak.owner)
    if (notOwner !== undefined) return notOwner
    const at = trak.state
    if (at._tag === "AwaitingHuman" && skippable(at.kind)) {
      return yield* startDrive(id, () => Events.filingAsked(undefined, at.step))
    }
    if (at._tag !== "AgentWorking") return yield* refuse(409, NothingToStopDto.make({}))

    // The record is a condition of accepting: a filing asked of a fresh conversation is
    // one sentence to an agent that has never been told what the step is.
    const runs = yield* Runs
    const turn = yield* runs.inFlight(id)
    if (turn === undefined) return yield* refuse(409, NothingToStopDto.make({}))
    return yield* takeOverDrive(id, () => Events.filingAsked(turn.sessionId, turn.step, turn.usage))
  }),
)

export const stopRoutes = Router.empty.pipe(stopRoute, stopTaskRoute, fileRoute)
