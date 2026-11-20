// In-memory Runs. Gives flow tests and the offline demos a `Runs` to provide,
// and the contract suite a second implementation to keep `FileRunsLayer`
// honest on the behaviour a single process can exercise.
//
// `reap` always returns nothing: a `Ref` cannot outlive the process that made
// it, so there is no earlier process's stray for THIS layer to find. A held
// record here can only mean a concurrent claim happening right now, in the
// same address space — never a crash to recover from — which is also why
// `adopt` needs no `Process` port to check liveness against.

import { Effect, Layer, Ref } from "effect"
import type { TrakId } from "../domain/trak.js"
import { type InFlightTurn, Runs, type RunsShape } from "../ports/runs.js"

interface Record_ {
  readonly held: boolean
  readonly turn: InFlightTurn | undefined
}

const empty: Record_ = { held: false, turn: undefined }

/**
 * What `holder` reports for `startedAt`.
 *
 * A constant rather than a clock read, and that is the point of a memory adapter:
 * a test that asserts on what this says would otherwise have to assert on the time
 * it ran. Nothing here is trying to measure anything — the file adapter is where a
 * real elapsed time comes from.
 */
const ADOPTED_AT = 0

// Nothing to reap: an in-memory record cannot outlive the process that made
// it, so there is no earlier process's stray for this layer to find.
const reap: RunsShape["reap"] = () => Effect.succeed([])

// Nothing to stop, for `reap`'s reason: no other copy shares this record.
const stopLeft: RunsShape["stopLeft"] = () => Effect.void

const makeMemoryRuns: Effect.Effect<RunsShape> = Effect.gen(function* () {
  const ref = yield* Ref.make<ReadonlyMap<TrakId, Record_>>(new Map())

  const update = (id: TrakId, f: (rec: Record_) => Record_): Effect.Effect<void> =>
    Ref.update(ref, (m) => new Map(m).set(id, f(m.get(id) ?? empty)))

  const adopt: RunsShape["adopt"] = (id) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const m = yield* Ref.get(ref)
        const rec = m.get(id) ?? empty
        yield* update(id, (r) => ({ ...r, held: true }))
        return rec.turn
      }),
      () => update(id, (r) => ({ ...r, held: false })),
    )

  const inFlight: RunsShape["inFlight"] = (id) =>
    Effect.map(Ref.get(ref), (m) => (m.get(id) ?? empty).turn)

  // `process.pid` is the only honest answer this layer can give: a `Ref` cannot be
  // shared across processes, so a record held here is held by *this* one. No
  // liveness check to make either — the holder is the process asking. `startedAt`
  // is a fixed value rather than a clock read, because a memory adapter exists so
  // that a test can assert on what it says.
  const holder: RunsShape["holder"] = (id) =>
    Effect.map(Ref.get(ref), (m) =>
      (m.get(id) ?? empty).held ? { pid: process.pid, startedAt: ADOPTED_AT } : undefined,
    )

  const turn: RunsShape["turn"] = (id, t) =>
    Effect.acquireRelease(
      update(id, (r) => ({ ...r, turn: t })),
      () => update(id, (r) => ({ ...r, turn: undefined })),
    )

  const spawned: RunsShape["spawned"] = (id, pid) =>
    update(id, (r) => (r.turn === undefined ? r : { ...r, turn: { ...r.turn, agentPid: pid } }))

  const announced: RunsShape["announced"] = (id, sessionId) =>
    update(id, (r) =>
      r.turn === undefined
        ? r
        : { ...r, turn: { ...r.turn, sessionId, minted: r.turn.minted ?? r.turn.sessionId } },
    )

  const spent: RunsShape["spent"] = (id, usage, estimate) =>
    update(id, (r) => (r.turn === undefined ? r : { ...r, turn: { ...r.turn, usage, estimate } }))

  const ended: RunsShape["ended"] = (id, execId) =>
    update(id, (r) =>
      r.turn !== undefined && (r.turn.execId ?? r.turn.rejoin) === execId
        ? { ...r, turn: undefined }
        : r,
    )

  return { adopt, inFlight, holder, turn, spawned, announced, spent, reap, stopLeft, ended }
})

export const MemoryRunsLayer = Layer.effect(Runs, makeMemoryRuns)
