// The file adapter over the real Node `Process`, for the one case a scripted `Process`
// cannot express: a holder whose pid is now a *thread* of another process. After a
// container restart the pid namespace is fresh and dense, and most numbers in use are
// threads — each Node process holds several. On Linux `kill(tid, 0)` succeeds on a thread
// id, and `ps -p <tid>` prints nothing, so a dead holder read through both looks alive and
// unreadable. That is what left ten detached turns undriven on 2026-11-07 with only
// `reap: no strays` in the log.
//
// Linux only: there is no `/proc` to find a thread id by on macOS, and no thread id
// `kill` accepts there.

import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { makeNodeProcess, NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { FileRunsLayer } from "../../src/workflow/adapters/runs-file.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Reaped, Runs } from "../../src/workflow/ports/runs.js"

/** A thread of this process other than its main one: alive to `kill`, and not a process. */
const threadId = (): number => {
  const tid = readdirSync("/proc/self/task")
    .map(Number)
    .find((t) => t !== process.pid)
  if (tid === undefined) throw new Error("this process has no thread besides its main one")
  return tid
}

const alive = (pid: number): Promise<boolean> => Effect.runPromise(makeNodeProcess.isAlive(pid))

describe.runIf(process.platform === "linux")(
  "Runs contract: file — a holder whose pid is now a thread of another process",
  () => {
    it("reads a thread id as no live process, and this process as one", async () => {
      expect({ thread: await alive(threadId()), own: await alive(process.pid) }).toEqual({
        thread: false,
        own: true,
      })
    })

    it("reads the holder as dead: nobody holds the trak, and reap rejoins its detached exec", async () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "orkestra-runs-"))
      const id = TrakId.make("holder-is-a-thread")
      const dir = join(scratchDir, ".orkestra", ".database", "traks", id)
      mkdirSync(dir, { recursive: true })
      // As the shutdown before the restart left it: the old engine's pid and start.
      writeFileSync(
        join(dir, "run.json"),
        JSON.stringify({
          holder: { pid: threadId(), startedAt: 0, start: "Sat Nov  7 15:20:11 2026" },
          turn: {
            step: 1,
            sessionId: "00000000-0000-4000-8000-00000000aaaa",
            execId: "6d461e76-545d-4b39-aa63-afe56afc530d",
            detached: true,
          },
        }),
      )

      const outcome = await Effect.runPromise(
        Effect.flatMap(Runs, (runs) =>
          Effect.all({ held: runs.holder(id), results: runs.reap() }),
        ).pipe(Effect.provide(FileRunsLayer(scratchDir).pipe(Layer.provide(NodeProcessLayer)))),
      )

      expect(outcome).toEqual({
        held: undefined,
        results: [Reaped.Rejoining({ id, execId: "6d461e76-545d-4b39-aa63-afe56afc530d" })],
      })
    })
  },
)
