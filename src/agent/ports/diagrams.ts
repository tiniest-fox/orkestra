// port: whether a diagram an agent wrote will draw. A port rather than a direct
// import because the parser behind it is the whole of `mermaid`, and loading it
// mutates `globalThis` — every test takes a fake instead of paying for either.

import { Context, type Effect } from "effect"

export interface DiagramsShape {
  /** Why `source` does not parse as mermaid, in the parser's words; `undefined` when it does. */
  readonly refusal: (source: string) => Effect.Effect<string | undefined>
}

export class Diagrams extends Context.Tag("agent/Diagrams")<Diagrams, DiagramsShape>() {}
