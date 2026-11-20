// One call on the file Passes over a project a test wrote, in a Node started with a capped
// heap by `test/contract/passes-heap.test.ts`, so a store that reads every print at once
// dies here the way the engine does rather than passing in the test's own roomy heap.
//
// `node --import tsx prints-heap.ts print <project> <key> <recording> <unit>…` keeps the
// prints of each `unit`; `… printed <project> <key>` asks which units skip. Prints the answer as
// JSON, and the process's peak `heapUsed` as sampled on the way, then exits 0.

import { Effect } from "effect"
import { FilePassesLayer } from "../../src/workflow/adapters/passes-file.js"
import { Passes } from "../../src/workflow/ports/passes.js"

const [mode = "", dir = "", key = "", recording = "", ...units] = process.argv.slice(2)

let peak = 0
const sample = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().heapUsed)
}, 5)

const body = Effect.flatMap(Passes, (p) =>
  mode === "print"
    ? p.print(key, dir, recording, units).pipe(Effect.as<readonly string[]>([]))
    : p.printed(key, dir),
)

const answer = await Effect.runPromise(Effect.provide(body, FilePassesLayer(dir)))
clearInterval(sample)
peak = Math.max(peak, process.memoryUsage().heapUsed)
process.stdout.write(`${JSON.stringify({ answer, peak })}\n`)
