// A `Preparation` that keeps every preparation entered, and every move, in order — what a
// test reads to see which phases a piece of work named. It answers no `of`: a theme about
// what a surface is sent uses the memory adapter.

import { Effect, Layer } from "effect"
import { Preparation } from "../../src/vcs/ports/preparation.js"
import type { PreparingPhase } from "../../src/vcs/types/preparing.js"

/** One phase as a test reads it: `<trak>:<tag>`, with a copy's counts after it. */
const named = (trak: string, phase: PreparingPhase): string =>
  phase._tag === "Copying"
    ? `${trak}:Copying ${String(phase.sent)}/${String(phase.total)}`
    : `${trak}:${phase._tag}`

/**
 * The layer, and the list it writes to — cleared by the test that reads it. `left` hears
 * each preparation end, under the phase it was entered at.
 */
export const recordingPreparation = (
  left: (trak: string, phase: PreparingPhase) => Effect.Effect<void> = () => Effect.void,
) => {
  const seen: string[] = []
  const layer = Layer.succeed(Preparation, {
    enter: (trak, phase) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          seen.push(named(trak, phase))
          return (moved: PreparingPhase) => Effect.sync(() => void seen.push(named(trak, moved)))
        }),
        () => left(trak, phase),
      ),
    of: () => Effect.succeed(undefined),
  })
  return { seen, layer }
}
