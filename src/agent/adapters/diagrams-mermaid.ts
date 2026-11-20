// adapter: `Diagrams` answered by the same `mermaid` the client draws with, so a
// diagram accepted here is one the client can render.
//
// **Loaded on the first diagram, never at boot.** The import is the largest thing
// the bundle carries, and most turns write no diagram at all.
//
// **A `window` exists only while the import runs.** Most diagram types reach
// DOMPurify at module load and throw `DOMPurify.addHook is not a function` with no
// window; `parse` itself needs none. The global is visible to everything else in
// the process for the length of that await, which is why it is removed in a
// `finally` and the happy-dom window closed — an open one keeps timers alive.
//
// **Only `parse` is ever called.** `initialize` and `render` write mermaid's
// module-level config, which `parse` reads.

import { Effect, Layer } from "effect"
import type { Mermaid } from "mermaid"
import { Diagrams } from "../ports/diagrams.js"

const load = async (): Promise<Mermaid> => {
  const { Window } = await import("happy-dom")
  const shim = new Window()
  Reflect.set(globalThis, "window", shim)
  try {
    const { default: mermaid } = await import("mermaid")
    return mermaid
  } finally {
    Reflect.deleteProperty(globalThis, "window")
    await shim.happyDOM.close()
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const MermaidDiagramsLayer = Layer.sync(Diagrams, () => {
  // One import for the life of the layer: two diagrams racing the first load would
  // otherwise both set and delete the global.
  let loading: Promise<Mermaid> | undefined
  return {
    refusal: (source) =>
      // A failed import dies rather than answering: it is not a verdict on the diagram.
      Effect.promise(async () => (loading ??= load())).pipe(
        Effect.flatMap((mermaid) =>
          // Every rejection from `parse` is its account of the source, so each is a refusal.
          Effect.tryPromise({ try: async () => mermaid.parse(source), catch: messageOf }),
        ),
        Effect.match({ onFailure: (reason) => reason, onSuccess: () => undefined }),
      ),
  }
})
