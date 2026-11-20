// Stands in for the mermaid parser: every source parses except the ones named,
// each refused with the reason given. The real parser is held to its own contract
// in `test/contract/diagrams-mermaid.test.ts`.

import { Effect, Layer } from "effect"
import { Diagrams } from "../../src/agent/ports/diagrams.js"

export const diagramsRefusing = (refused: Readonly<Record<string, string>> = {}) =>
  Layer.succeed(Diagrams, { refusal: (source) => Effect.succeed(refused[source]) })
