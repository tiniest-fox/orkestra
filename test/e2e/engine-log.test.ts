// The engine's warning and error lines on disk, which `engine_log` reads: kept across an
// engine restart, bounded by one rotation, and holding nothing below a warning.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { FileEngineLogLayer } from "../../src/workflow/adapters/engine-log-file.js"
import { EngineLog } from "../../src/workflow/ports/engine-log.js"

const dirs: string[] = []

const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "engine-log-"))
  mkdirSync(join(dir, ".orkestra"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One boot of the engine's log over `dir`: run `effect` under it, as a drive runs. */
const boot = <A>(dir: string, effect: Effect.Effect<A, never, EngineLog>, maxBytes?: number) =>
  Effect.runPromise(effect.pipe(Effect.provide(FileEngineLogLayer(dir, maxBytes))))

const line = (n: number) => Effect.logWarning(`line ${String(n)} ${"x".repeat(60)}`)

const messages = Effect.map(
  Effect.flatMap(EngineLog, (log) => log.lines),
  (lines) => lines.map((l) => `${l.level} ${l.message}`),
)

describe("the engine log file", () => {
  it("keeps a warning and an error from one boot for the next, and nothing below a warning", async () => {
    const dir = project()
    await boot(
      dir,
      Effect.all([
        Effect.logInfo("said at info"),
        Effect.logWarning("sandbox for trak-a did not answer"),
        Effect.logError("goal-b's turn failed"),
      ]),
    )
    expect(await boot(dir, messages)).toEqual([
      "WARN sandbox for trak-a did not answer",
      "ERROR goal-b's turn failed",
    ])
  })

  it("rotates once at its size, so the line before the rotation is still read", async () => {
    const dir = project()
    await boot(dir, Effect.all([line(1), line(2), line(3)]), 200)
    const kept = await boot(dir, messages, 200)
    expect(kept.map((m) => m.slice(0, 11))).toEqual(["WARN line 2", "WARN line 3"])
  })
})
