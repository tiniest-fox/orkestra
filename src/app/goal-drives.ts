// A goal's composer turns, as the daemon runs them: a driver per goal, and the turn each
// one runs. The goal's tool calls, its watcher and its routes are in `goals.ts`.
//
// **Its own file so a flow test can build it without the routes.** `goals.ts` answers HTTP
// through `dto.ts`, which imports every `shared/src/dto/` slice, so a test helper that
// built this layer from there was selected by `verify-light` for an edit to any slice.

import { Context, Effect, Exit, Fiber, Layer, Ref, Scope } from "effect"
import type { SessionId, SteeredMessage } from "../agent/types/session.js"
import type { GoalServers } from "../workflow/ports/turn-tools.js"
import { Provider } from "../agent/ports/provider.js"
import {
  type Goal,
  goalAtRest,
  type GoalEvent,
  GoalEvents,
  goalName,
  heldGoalChat,
  owesTurn,
  replayGoal,
  subgoalOutcome,
} from "../workflow/domain/goal.js"
import type { GoalId } from "../workflow/domain/trak.js"
import { GoalStore, type GoalStoreShape } from "../workflow/ports/goal-store.js"
import { Ids } from "../workflow/ports/ids.js"
import { Locks } from "../workflow/ports/locks.js"
import { withProjectFiles } from "../workflow/ports/project-files.js"
import { readAgainOnConflict } from "../workflow/ports/store-errors.js"
import { ComposeGoal, driveEnded } from "./drive.js"
import { goalNotificationFor, sendToSeers } from "./push.js"

/** The goal off its own log, or `undefined` where it has none. */
export const goalOf = (store: GoalStoreShape, id: GoalId) =>
  Effect.map(store.events(id), (log) => replayGoal(id, log))

export interface GoalDrivesShape {
  /** Run the goal's owed turns, if it owes any and none is running. Never waits for one. */
  readonly kick: (id: GoalId) => Effect.Effect<void>
  /** Whether a composer turn of this goal is running now. */
  readonly running: (id: GoalId) => Effect.Effect<boolean>
  /**
   * Interrupt this goal's running turn and wait for it to unwind. The session the turn
   * announced, where it announced one; `undefined` where no turn was running, or where the
   * turn had already ended and only its ending is still to be appended.
   */
  readonly halt: (id: GoalId) => Effect.Effect<GoalHalted | undefined>
  /**
   * Hand a message to the running turn's pipe — `Provider.steer`'s answer, and `false`
   * where no turn is running.
   */
  readonly steer: (id: GoalId, message: SteeredMessage) => Effect.Effect<boolean>
  /**
   * File on a sub-goal's parent what the sub-goal's own log says — done, dropped or stuck —
   * and kick the parent where that wakes it. Nothing for a goal with no parent, or one
   * standing at none of the three. Never holds the sub-goal's permit: a parent's permit is
   * taken before its sub-goals', never after.
   */
  readonly settleSubgoal: (id: GoalId) => Effect.Effect<void>
}

export class GoalDrives extends Context.Tag("app/GoalDrives")<GoalDrives, GoalDrivesShape>() {}

/** What a halted turn leaves behind: the session it announced, for its stop to file. */
export interface GoalHalted {
  readonly session: SessionId | undefined
}

/**
 * A composer turn running: its fiber, the session it was requested under — what its pipe is
 * held by — and the one it announced.
 */
interface GoalTurn {
  readonly fiber: Fiber.RuntimeFiber<GoalEvent, unknown>
  readonly session: SessionId
  readonly announced: Ref.Ref<SessionId | undefined>
}

/** A goal being driven: its turn while one runs, and whether a kick came since it read the goal. */
interface Driving {
  readonly turn: GoalTurn | undefined
  readonly again: boolean
}

type DrivingMap = ReadonlyMap<GoalId, Driving>

const without = (all: DrivingMap, id: GoalId): DrivingMap => {
  const rest = new Map(all)
  rest.delete(id)
  return rest
}

/**
 * Append a turn's ending, and the goal it leaves. Appended whatever the goal did meanwhile,
 * so the count is read here rather than carried from the turn's start. Then the chat the
 * goal owes itself for what the turn never read, under the same permit, so no message lands
 * between the two to be left behind.
 */
const turnEnded = (
  goals: GoalStoreShape,
  locks: Context.Tag.Service<typeof Locks>,
  id: GoalId,
  ending: GoalEvent,
) => {
  const appended = (event: GoalEvent) =>
    readAgainOnConflict(
      Effect.flatMap(goals.events(id), (log) =>
        Effect.flatMap(locks.goalFenced(id, log.length), (at) => goals.append(id, [event], at)),
      ),
    )
  return locks.withGoal(id)(
    Effect.gen(function* () {
      yield* appended(ending)
      const settled = yield* goalOf(goals, id)
      const held = settled === undefined ? undefined : heldGoalChat(settled)
      if (held === undefined) return settled
      yield* appended(held)
      return yield* goalOf(goals, id)
    }),
  )
}

/**
 * Start a driver for the goal unless one is there, which is marked `again` instead — so a
 * kick is never lost. `start` forks the driver.
 */
const kickWith =
  <A>(driving: Ref.Ref<DrivingMap>, start: (id: GoalId) => Effect.Effect<A>) =>
  (id: GoalId) =>
    Effect.gen(function* () {
      const starts = yield* Ref.modify(driving, (all): readonly [boolean, DrivingMap] => {
        const d = all.get(id)
        return d === undefined
          ? [true, new Map(all).set(id, { turn: undefined, again: false })]
          : [false, new Map(all).set(id, { ...d, again: true })]
      })
      if (starts) yield* start(id)
    })

/**
 * `GoalDrivesShape.settleSubgoal`, with the kick it ends in. `settleTrak`'s rule: the
 * sub-goal's log is the authority, and a wake is filed only where the line it reached its
 * outcome at differs from the one the parent last filed, compared under the parent's permit.
 */
const settleSubgoalWith =
  (
    goals: GoalStoreShape,
    locks: Context.Tag.Service<typeof Locks>,
    kick: (id: GoalId) => Effect.Effect<void>,
  ) =>
  (id: GoalId) =>
    Effect.gen(function* () {
      const history = yield* goals.events(id)
      const parentId = replayGoal(id, history)?.parent?.goal
      if (parentId === undefined) return
      const { kind, said, since } = subgoalOutcome(id, history)
      if (kind === undefined) return
      const woke = yield* locks.withGoal(parentId)(
        readAgainOnConflict(
          Effect.gen(function* () {
            const parent = yield* goalOf(goals, parentId)
            if (parent === undefined || goalAtRest(parent.state)) return false
            const known = parent.subgoals.find((s) => s.id === id)
            // One the parent's composer dropped itself is already settled on its log.
            if (known === undefined || known.status !== "live" || known.filed === since) {
              return false
            }
            const woken = GoalEvents.subgoalWoke(id, kind, since, said)
            yield* goals.append(parentId, [woken], { after: parent.logged })
            return true
          }),
        ),
      )
      if (woke) yield* kick(parentId)
    }).pipe(
      Effect.catchAllCause((cause) => Effect.logError(`goal ${id}: its parent not woken`, cause)),
    )

/** A goal's buzz where its state is worth one, to the users who see the goal. */
const told = (goal: Goal) => {
  const payload = goalNotificationFor(goal.id, goal.state, goalName(goal))
  return payload === undefined ? Effect.void : sendToSeers(payload, { goal: goal.id })
}

/**
 * The daemon's goal turns: a driver per goal, running its owed turns until it owes none.
 *
 * **One driver per goal, and any number of goals.** Two goals' turns run side by side; one
 * goal's run one after another, because a kick for a goal already being driven starts
 * nothing and marks it `again` instead. A driver leaves only in the step that finds no
 * `again`, so a kick is never lost: it lands either while the driver is there to read the
 * goal once more, or after it has gone, and starts the next. The turn itself is a child
 * fiber, so a drop or a stop can interrupt it and wait for the CLI to die.
 *
 * `tools` is the servers each turn's session may be handed — `goalToolsServer` — and absent in
 * a flow test, which answers the composer's calls itself.
 */
export const goalDrivesLayer = (tools: ((goal: GoalId) => GoalServers) | undefined) =>
  Layer.scoped(
    GoalDrives,
    Effect.gen(function* () {
      const goals = yield* GoalStore
      const locks = yield* Locks
      const provider = yield* Provider
      const scope = yield* Scope.Scope
      const driving = yield* Ref.make<DrivingMap>(new Map())

      const set = (id: GoalId, change: (d: Driving) => Driving) =>
        Ref.update(driving, (all) => {
          const d = all.get(id)
          return d === undefined ? all : new Map(all).set(id, change(d))
        })

      /**
       * Read the goal and start its turn under the goal's permit, and record the turn
       * before letting go. A drop holds the same permit while it halts, so it either comes
       * first — and the goal it leaves owes nothing — or finds the turn. `again` is cleared
       * before the read, so only a kick after it asks for another.
       */
      const begin = (id: GoalId) =>
        locks.withGoal(id)(
          Effect.gen(function* () {
            yield* set(id, (d) => ({ ...d, again: false }))
            const goal = yield* goalOf(goals, id)
            if (goal === undefined || !owesTurn(goal)) return undefined
            const session = goal.session ?? (yield* (yield* Ids).newSessionId)
            const announced = yield* Ref.make<SessionId | undefined>(undefined)
            // The driver runs in the layer's scope, so each turn takes the held pair itself.
            const fiber = yield* Effect.fork(
              withProjectFiles(ComposeGoal(goal, tools?.(id), session, announced)),
            )
            yield* set(id, (d) => ({ ...d, turn: { fiber, session, announced } }))
            return fiber
          }),
        )

      /** Leave in one step with the check, unless a kick came since the read. */
      const leaves = (id: GoalId) =>
        Ref.modify(driving, (all): readonly [boolean, DrivingMap] =>
          all.get(id)?.again === true ? [false, all] : [true, without(all, id)],
        )

      // Under the goal's lease, where there are leases: whichever engine copy holds it runs
      // the goal's turns, and the ending each appends carries its fence.
      const drive = (id: GoalId) =>
        Effect.gen(function* () {
          for (;;) {
            const fiber = yield* begin(id)
            if (fiber === undefined) {
              if (yield* leaves(id)) return
              continue
            }
            const exit = yield* Fiber.await(fiber)
            // A turn halted by a stop or a drop goes round again rather than out: its route
            // appends what the halt means under the permit `begin` waits on, and a kick
            // landing meanwhile is `again` on an entry still here to read it. `halt` has
            // already taken the turn off the entry.
            if (Exit.isInterrupted(exit)) continue
            if (exit._tag === "Failure") return yield* exit
            // The turn stays on the entry until its ending is on the log, so the goal reads
            // as running until it has settled, and a stop that lands in between finds a
            // fiber that is already done — which `halt` answers as nothing to stop.
            const ended = yield* turnEnded(goals, locks, id, exit.value)
            yield* set(id, (d) => (d.turn?.fiber === fiber ? { ...d, turn: undefined } : d))
            if (ended !== undefined) yield* told(ended)
            // A sub-goal whose turn failed is stuck, which its parent is woken about.
            if (ended?.state._tag === "Failed") yield* settleSubgoal(id)
          }
        }).pipe(
          locks.withGoalDrive(id),
          // Nothing joins a driver, so a failure would vanish. A driver that failed has not
          // left, so its entry is still its own to take out. Another copy holding the
          // goal's lease ends it too, quietly: that copy runs its turns.
          Effect.catchAllCause((cause) =>
            Effect.andThen(
              Ref.update(driving, (all) => without(all, id)),
              driveEnded(id, cause),
            ),
          ),
        )

      // A driver starts from whoever kicks, so it runs on what the layer was built with.
      const context = yield* Effect.context<Effect.Effect.Context<ReturnType<typeof drive>>>()

      // Interruptible by name: a kick at boot runs inside the layer build's uninterruptible
      // region, and a driver that cannot be interrupted holds the engine's shutdown open for
      // ever. In the layer's scope, so the request that kicked can end and leave it running.
      const kick = kickWith(driving, (id) =>
        Effect.forkIn(Effect.interruptible(Effect.provide(drive(id), context)), scope),
      )
      const settleSubgoal = settleSubgoalWith(goals, locks, kick)

      return {
        kick,
        running: (id) => Effect.map(Ref.get(driving), (all) => all.get(id)?.turn !== undefined),
        halt: (id) =>
          Effect.gen(function* () {
            const turn = (yield* Ref.get(driving)).get(id)?.turn
            if (turn === undefined) return undefined
            const exit = yield* Fiber.interrupt(turn.fiber)
            // A fiber that had already ended returns its own exit rather than an
            // interruption: its ending is the driver's to append, and a stop filed beside
            // it would settle the goal twice. So nothing was halted.
            if (!Exit.isInterrupted(exit)) return undefined
            // Cleared here as well as by the driver, which may not have woken yet: a turn
            // halted is not running once `halt` returns.
            yield* set(id, (d) => (d.turn === turn ? { ...d, turn: undefined } : d))
            return { session: yield* Ref.get(turn.announced) }
          }),
        steer: (id, message) =>
          Effect.flatMap(Ref.get(driving), (all) => {
            const turn = all.get(id)?.turn
            return turn === undefined
              ? Effect.succeed(false)
              : provider.steer(turn.session, message)
          }),
        settleSubgoal,
      }
    }),
  )
