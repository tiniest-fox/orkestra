// The Node adapter against real processes. Slower than the rest of the suite
// and worth it: signals are the one thing a fake cannot be honest about.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  NodeProcessLayer,
  nodeProcessLayerWithGrace,
} from "../../src/agent/adapters/process-node.js"
import { Process } from "../../src/agent/ports/process.js"
import { processContract } from "./process.js"

processContract({
  label: "node",
  layer: NodeProcessLayer,
  // The holder ignores SIGTERM, so its case waits the whole grace before the SIGKILL.
  shortGrace: nodeProcessLayerWithGrace(200),
})

/**
 * A process that prints and exits before anything pulls its output — an agent CLI faster
 * than the consumer, which handles `Spawned` (transcript, `run.json`, the event log)
 * before it asks for the first line. The exit is awaited first, so the pull starts once
 * stdout has ended rather than after a sleep that might not be long enough. A hang is
 * reported as `"hung"` rather than left to the test's timeout.
 */
const readAfterExit = Effect.scoped(
  Effect.gen(function* () {
    const p = yield* Process
    const spawned = yield* p.spawn({
      command: "sh",
      args: ["-c", "printf 'one\\ntwo\\nthree\\n'"],
      cwd: mkdtempSync(join(tmpdir(), "process-node-")),
      env: {},
      stdin: undefined,
      holdStdin: false,
    })
    yield* spawned.exited.pipe(Effect.timeout("5 seconds"))
    return yield* Stream.runCollect(spawned.lines).pipe(
      Effect.timeoutTo({
        duration: "2 seconds",
        onSuccess: (chunk): readonly string[] | "hung" => [...chunk],
        onTimeout: () => "hung" as const,
      }),
    )
  }),
)

describe("Process: node", () => {
  it("delivers every line of a process that exited before its output was read", async () => {
    // A turn whose agent printed its whole reply and exited before the provider pulled
    // the first line sat in AgentWorking with nothing after `Spawned` in its transcript.
    const lines = await Effect.runPromise(
      readAfterExit.pipe(Effect.provide(NodeProcessLayer), Effect.orDie),
    )
    expect(lines).toEqual(["one", "two", "three"])
  }, 20_000)
})
