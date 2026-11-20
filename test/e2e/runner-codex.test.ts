// A turn on a CLI that signs in through a file is refused where its checkout is in a
// sandbox: the credential would have to be written there, and a sandbox is never handed
// one in a file. The same turn with no sandbox runs as it always has.
//
// The sandbox is a fake that places every checkout in one, which is all the refusal
// reads; the contract tier holds the real one to its guarantees.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Provider } from "../../src/agent/ports/provider.js"
import type { Library } from "../../src/library/types/library.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { composer, runFlow, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { createAndStart, logTags } from "../support/scenario.js"
import { library } from "../support/library.js"
import { reply } from "../support/scripted-agent.js"

// Bare, so the one scripted CLI answers it, and the fake below says it is Codex's.
const CODEX = "gpt-5.4"

/** The fixture fleet, with `work` on a model whose CLI signs in through a file. */
const workOnCodex = (): Library => {
  const lib = library()
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, model: CODEX }) }
}

const unused = Effect.die("not reached by a refused turn")

/** Every checkout in a sandbox, and nothing else of one reached. */
const everyCheckoutSandboxed: SandboxesShape = {
  inUse: Effect.succeed(true),
  holds: () => Effect.succeed(true),
  placeOf: (path) => Effect.succeed({ trak: "scenario-trak", path }),
  project: Effect.succeed(undefined),
  create: () => unused,
  status: () => unused,
  idOf: () => Effect.succeed(undefined),
  list: unused,
  release: () => unused,
  kill: () => unused,
  expose: () => unused,
  reach: () => unused,
  healthThrough: () => unused,
  transfer: () => unused,
  retried: () => unused,
  place: () => unused,
  write: () => unused,
  collect: () => unused,
  moveOut: () => unused,
  readInside: () => unused,
  stats: () => unused,
  copyHomeBack: () => unused,
  copyHomeIn: () => unused,
  awake: () => unused,
  lost: () => unused,
  resuming: () => Effect.succeed(false),
  remakeWith: () => unused,
  stopIdleUnder: () => unused,
  waitingBy: () => unused,
  rebuild: () => unused,
  rebuildOf: () => unused,
  leftBehindTo: () => Effect.void,
  asWork: (work) => work,
  shell: () => unused,
}

/** The scripted CLI answering for Codex: its models sign in through `~/.codex/auth.json`. */
const codexSignsInByFile = Effect.updateService(Provider, (registry) => ({
  ...registry,
  cliFor: (model: string) => (model === CODEX ? "codex" : registry.cliFor(model)),
  signInFileFor: (model: string) => (model === CODEX ? ".codex/auth.json" : undefined),
}))

describe("a CLI that signs in through a file, under a runner", () => {
  it("fails the turn with the reason, and never spawns it", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("ran in the sandbox"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const done = yield* createAndStart(id, "Add a --json flag")
          expect(done.state).toMatchObject({ _tag: "Failed", kind: "provider" })
          const error = done.state._tag === "Failed" ? done.state.error : ""
          expect(error).toContain("codex signs in through ~/.codex/auth.json, a file")
          expect(error).toContain(CODEX)
          expect(yield* logTags(id)).toContain("TurnFailed")
          expect(stepRuns(yield* agentLog)).toEqual([])
        }).pipe(Effect.provideService(Sandboxes, everyCheckoutSandboxed), codexSignsInByFile),
      workOnCodex(),
    )
  })

  it("runs the same turn where the checkout is on this machine", async () => {
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("ran here"))],
      (id) =>
        Effect.gen(function* () {
          const done = yield* createAndStart(id, "Add a --json flag")
          expect(done.state._tag).toBe("AwaitingHuman")
        }).pipe(codexSignsInByFile),
      workOnCodex(),
    )
  })
})
