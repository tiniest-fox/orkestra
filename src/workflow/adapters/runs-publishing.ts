// The Runs port, wrapped so that what a turn in flight has spent is something a
// watcher can see.
//
// **A decorator rather than a second call site**, for `store-publishing.ts`'s reason:
// `withTranscript` already writes each report to the record through this port, so
// wrapping it catches every one and `runtime.ts` never learns that anything is
// watching. The record is the source — a frame here says what `Runs.inFlight` would
// answer, never something the fold said and the record did not keep.
//
// **One frame per window, not one per report.** Claude writes a reading per content
// block, so one call's figure arrives two or three times in a burst, and a busy turn
// makes a call every few hundred milliseconds. The feed's ring holds a couple of minutes
// of frames at the check family's rate, and a frame per report would halve that for
// every other trak. So a report parks as the trak's pending payload, a flush every
// `WINDOW` publishes the latest one, and a payload equal to the last published is not a
// frame at all.
//
// **An outage rides the same flush.** While the turn's sandbox is out of reach the
// runner's layers record it in `Outages`, which knows nothing of turns; each flush reads
// it beside the parked report, so a frame says the turn is reattaching, and the next one
// after the sandbox answers says it no longer is.
//
// **The release rides the closing of `turn`'s scope**, registered before the inner
// write so that it runs after the inner release: a watcher that re-reads on the frame
// must find the record already clear, which is the order `src/app/drive.ts` keeps for
// custody.

import { Duration, Effect, HashMap, Layer, Option, Ref, Schedule } from "effect"
import type { TrakId } from "../domain/trak.js"
import { Feed, Frame, type Reattaching, reattachingOf, type TurnSpent } from "../ports/feed.js"
import { Outages } from "../ports/outages.js"
import { Runs, type RunsShape } from "../ports/runs.js"

/** What a frame says of one turn: what it spent, and whether it is reattaching. */
interface Published {
  readonly turn: TurnSpent | undefined
  readonly reattaching: Reattaching | undefined
}

/** How long reports collect before the latest goes out — the check console's window. */
const WINDOW = Duration.millis(200)

/**
 * Whether two payloads say the same thing. Both come off one fold in one process, so
 * the field order is fixed and the text is the value; a repeat of a call's reading is
 * the case this exists for, and it is byte-identical.
 */
const same = (a: Published, b: Published): boolean => JSON.stringify(a) === JSON.stringify(b)

const decorator = Layer.effect(
  Runs,
  Effect.gen(function* () {
    const inner = yield* Runs
    const feed = yield* Feed
    // Optional: a layer set that keeps no outages has no turn reattaching to tell of.
    const outages = Option.getOrUndefined(yield* Effect.serviceOption(Outages))
    /** The step of each turn in flight, kept so a report can name its position. */
    const steps = yield* Ref.make(HashMap.empty<TrakId, number | undefined>())
    /** The latest report per trak that no flush has published yet. */
    const pending = yield* Ref.make(HashMap.empty<TrakId, TurnSpent>())
    /** What was last published per trak, so an unchanged payload is not a frame. */
    const published = yield* Ref.make(HashMap.empty<TrakId, Published>())

    const flush = (id: TrakId): Effect.Effect<void> =>
      Effect.gen(function* () {
        const parked = yield* Ref.modify(pending, (held) => [
          HashMap.get(held, id),
          HashMap.remove(held, id),
        ])
        const last = Option.getOrUndefined(HashMap.get(yield* Ref.get(published), id))
        const step = Option.getOrUndefined(HashMap.get(yield* Ref.get(steps), id))
        const next: Published = {
          turn: Option.getOrUndefined(parked) ?? last?.turn,
          reattaching: reattachingOf(step, yield* outages?.of(id) ?? Effect.succeed(undefined)),
        }
        if (
          last === undefined
            ? next.turn === undefined && next.reattaching === undefined
            : same(last, next)
        )
          return
        yield* Ref.update(published, (held) => HashMap.set(held, id, next))
        yield* feed.publish(
          Frame.InFlight({
            id,
            turn: next.turn,
            ...(next.reattaching === undefined ? {} : { reattaching: next.reattaching }),
          }),
        )
      })

    /**
     * The turn is over. A report still parked is not sent: the ending on the log
     * carries the turn's spend, and the release is what a watcher needs.
     */
    const released = (id: TrakId): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(pending, (held) => HashMap.remove(held, id))
        yield* Ref.update(published, (held) => HashMap.remove(held, id))
        yield* Ref.update(steps, (held) => HashMap.remove(held, id))
        yield* feed.publish(Frame.InFlight({ id, turn: undefined }))
      })

    const turn: RunsShape["turn"] = (id, t) =>
      Effect.gen(function* () {
        yield* Ref.update(steps, (held) => HashMap.set(held, id, t.step))
        yield* Effect.addFinalizer(() => released(id))
        yield* inner.turn(id, t)
        yield* Effect.forkScoped(Effect.repeat(flush(id), Schedule.spaced(WINDOW)))
      })

    const spent: RunsShape["spent"] = (id, usage, estimate) =>
      Effect.gen(function* () {
        yield* inner.spent(id, usage, estimate)
        const step = HashMap.get(yield* Ref.get(steps), id)
        // No turn in flight: the inner write landed nowhere, and so does this.
        if (Option.isNone(step)) return
        yield* Ref.update(pending, (held) =>
          HashMap.set(held, id, { step: step.value, usage, estimate }),
        )
      })

    const decorated: RunsShape = { ...inner, turn, spent }
    return decorated
  }),
)

/**
 * Wrap a Runs so what each turn in flight has spent reaches the `Feed`.
 *
 * Takes the inner layer rather than naming `FileRunsLayer`, for `publishingStore`'s
 * reason: a test watches the memory adapter, and tying this to one adapter would make
 * the only way to test it the slow one.
 */
export const publishingRuns = <E, R>(
  inner: Layer.Layer<Runs, E, R>,
): Layer.Layer<Runs, E, R | Feed> => decorator.pipe(Layer.provide(inner))
