// A failed sandbox verb is a warning in the engine's output, reason and all — the reason is
// where the runner's stderr is, and the engine's output is what a host keeps in a file.

import { Effect, Layer, Logger } from "effect"
import { describe, expect, it } from "vitest"
import { loggedSandboxes } from "../../src/workflow/adapters/sandboxes-logged.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { GitFailed } from "../../src/vcs/types/errors.js"

const unused = Effect.die("not called in this test")

/** A runner whose `release` exits 1 with a line on stderr, and whose `status` answers. */
const refusing: SandboxesShape = {
  inUse: Effect.succeed(true),
  holds: () => Effect.succeed(true),
  create: () => unused,
  status: () => Effect.succeed("running"),
  idOf: () => Effect.succeed(undefined),
  list: unused,
  expose: () => unused,
  reach: () => unused,
  healthThrough: () => unused,
  release: () =>
    Effect.fail(
      new GitFailed({
        op: "release sandbox",
        reason: "runner.sh release t1 exited 1: boat.dev refused DELETE /sandboxes/x (500)",
      }),
    ),
  kill: () => unused,
  transfer: () => unused,
  retried: () => unused,
  placeOf: () => Effect.succeed(undefined),
  project: Effect.succeed(undefined),
  place: () => unused,
  write: () => unused,
  collect: () => unused,
  moveOut: () => unused,
  readInside: () => unused,
  stats: () => unused,
  copyHomeBack: () => unused,
  copyHomeIn: () => unused,
  awake: () => unused,
  lost: () => Effect.void,
  resuming: () => Effect.succeed(false),
  remakeWith: () => Effect.void,
  stopIdleUnder: () => Effect.void,
  waitingBy: () => Effect.void,
  rebuild: () => Effect.die("not reached"),
  rebuildOf: () => Effect.succeed(undefined),
  leftBehindTo: () => Effect.void,
  asWork: (work) => work,
  shell: () => unused,
}

describe("a sandbox verb that fails", () => {
  it("is logged with the runner's words and still fails its caller; one that answers is not logged", async () => {
    const logged: string[] = []
    const logger = Logger.make(({ logLevel, message }) => {
      logged.push(`${logLevel.label}: ${String(message)}`)
    })
    const released = await Effect.runPromise(
      Effect.gen(function* () {
        const sandboxes = yield* Sandboxes
        yield* sandboxes.status("t1")
        return yield* Effect.either(sandboxes.release("t1"))
      }).pipe(
        Effect.provide(loggedSandboxes(Layer.succeed(Sandboxes, refusing))),
        Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
      ),
    )
    expect(released._tag).toBe("Left")
    expect(logged).toEqual([
      "WARN: t1: sandbox release sandbox failed: runner.sh release t1 exited 1: boat.dev refused DELETE /sandboxes/x (500)",
    ])
  })
})
