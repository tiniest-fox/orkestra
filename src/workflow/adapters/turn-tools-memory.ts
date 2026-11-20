// The turns in flight in this process, held in memory — the only place they can be: a
// turn's scope is a value of the fiber running it, and a restart ends every turn anyway.
// Two lists: the step turns the tools can act for, and every turn the engine holds live —
// a trak's step or composer, or a goal's composer — which `turn_status` reads.
//
// `server` and `reached` are handed in rather than built here, because what a session
// dials is the app's to say — which command, which engine and which credential. Left out,
// `reached` answers that every session runs on this machine.

import { Clock, Effect, HashMap, Layer, Ref, type Scope } from "effect"
import type { McpServer } from "../../agent/types/session.js"
import type { ProviderEvent } from "../../agent/types/provider-event.js"
import type { TrakId } from "../domain/trak.js"
import {
  type LiveHeard,
  type LiveOwner,
  type LiveTurn,
  type OpenTurn,
  type ReachedTools,
  TurnTools,
  type TurnToolsShape,
} from "../ports/turn-tools.js"

/** One live turn's slot: replaced whole on each event, so a read never sees half an update. */
type Slot = Ref.Ref<LiveTurn>

/** A live turn, opened on the list and taken off it when the caller's scope closes. */
const liveOn =
  (lives: Ref.Ref<readonly Slot[]>) =>
  (owner: LiveOwner): Effect.Effect<LiveHeard, never, Scope.Scope> =>
    Effect.gen(function* () {
      const slot: Slot = yield* Ref.make<LiveTurn>({
        owner,
        startedAt: yield* Clock.currentTimeMillis,
        lastEventAt: undefined,
        pid: undefined,
        execId: undefined,
      })
      yield* Ref.update(lives, (all) => [...all, slot])
      yield* Effect.addFinalizer(() => Ref.update(lives, (all) => all.filter((s) => s !== slot)))
      return (event: ProviderEvent) =>
        event._tag === "Spawned"
          ? Ref.update(slot, (t) => ({ ...t, pid: event.pid, execId: event.execId }))
          : event._tag === "Reask"
            ? Effect.void
            : Effect.flatMap(Clock.currentTimeMillis, (at) =>
                Ref.update(slot, (t) => ({ ...t, lastEventAt: at })),
              )
    })

export const MemoryTurnToolsLayer = (
  server: ((id: TrakId) => McpServer) | undefined,
  reached: (id: TrakId) => Effect.Effect<ReachedTools | undefined> = () =>
    Effect.succeed(undefined),
): Layer.Layer<TurnTools> =>
  Layer.effect(
    TurnTools,
    Effect.gen(function* () {
      const turns = yield* Ref.make(HashMap.empty<TrakId, OpenTurn>())
      const lives = yield* Ref.make<readonly Slot[]>([])
      const shape: TurnToolsShape = {
        server,
        reached,
        open: (id, step) =>
          Effect.gen(function* () {
            const turn: OpenTurn = { step, scope: yield* Effect.scope }
            yield* Ref.update(turns, HashMap.set(id, turn))
            // Only this turn's own entry: a turn that starts before the last one's scope
            // has finished closing must not be taken off by that close.
            yield* Effect.addFinalizer(() =>
              Ref.update(turns, (held) => {
                const now = HashMap.get(held, id)
                return now._tag === "Some" && now.value === turn ? HashMap.remove(held, id) : held
              }),
            )
          }),
        current: (id) =>
          Effect.map(Ref.get(turns), (held) => {
            const turn = HashMap.get(held, id)
            return turn._tag === "Some" ? turn.value : undefined
          }),
        live: liveOn(lives),
        lives: Effect.flatMap(Ref.get(lives), (all) => Effect.forEach(all, Ref.get)),
      }
      return shape
    }),
  )
