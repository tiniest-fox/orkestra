// A turn a restarted engine rejoins: its command's stream read again from the start, the
// lines the dead engine wrote not written twice, and a re-ask after it a fresh spawn. And
// one whose command its sandbox no longer holds, which leaves the trak stopped.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { SessionId } from "../../src/agent/types/session.js"
import { SessionEntry, SpawnedEntry } from "../../src/agent/types/transcript-entry.js"
import { Events } from "../../src/workflow/domain/event.js"
import { advance } from "../../src/workflow/runtime.js"
import { Runs } from "../../src/workflow/ports/runs.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composer, runFlowWithAgentLog } from "../support/flow.js"
import { createAndStart } from "../support/scenario.js"
import { type AgentLog, crashesOn, reply, type Turn } from "../support/scripted-agent.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"

/** The session the dead engine's command announced, which its replay announces again. */
const LIVE = SessionId.make("00000000-0000-4000-8000-0000000000aa")
const EXEC = "exec-left-running"

/** The replayed command: it names the live session and answers with nothing decodable. */
const rejoined: Turn = {
  label: "rejoined",
  when: (r) => r.reattach === EXEC,
  reply: "not an envelope",
  announces: LIVE,
}

/** The re-ask, which must start a command of its own. */
const reasked: Turn = {
  label: "re-asked",
  when: (r) => r.reattach === undefined && r.prompt.includes("could not be used"),
  reply: reply.artifact("the work, filed on the re-ask"),
}

/** The rejoin of a command its sandbox no longer holds, as the runner answers `gone`. */
const goneFromSandbox: Turn = {
  label: "gone",
  when: (r) => r.reattach === EXEC,
  reply: "",
  crash: { reason: "no longer holds the turn's command", sessionStarted: false, gone: true },
}

/** A step crashed, its command left running, and the restart that rejoins it — the trak it reaches. */
const restartedOver = (id: TrakId) =>
  Effect.gen(function* () {
    const failed = yield* createAndStart(id, "x")
    expect(failed.failedFrom?._tag).toBe("AgentWorking")
    const store = yield* Store
    // What the dead engine had written of the detached command before it went.
    yield* store.appendTranscript(id, SpawnedEntry.make({ pid: 7, execId: EXEC, position: 1 }))
    yield* store.appendTranscript(id, SessionEntry.make({ id: LIVE, position: 1 }))
    // And its record, still naming the command — as a shutdown leaves it.
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* (yield* Runs).turn(id, {
          step: 1,
          sessionId: LIVE,
          agentPid: undefined,
          agentStart: undefined,
          usage: undefined,
          estimate: undefined,
          rejoin: EXEC,
        })
        return yield* advance(id, Events.restarted(LIVE))
      }),
    )
  })

const rejoinsThenReasks = (id: TrakId, agentLog: Effect.Effect<AgentLog>) =>
  Effect.gen(function* () {
    const store = yield* Store
    const after = yield* restartedOver(id)
    expect(after.state._tag).toBe("AwaitingHuman")
    const log = yield* agentLog
    expect(log.matched.slice(-2)).toEqual(["rejoined", "re-asked"])
    expect(log.requests.at(-2)?.reattach).toBe(EXEC)
    expect(log.requests.at(-1)?.reattach).toBeUndefined()
    const lines = yield* store.transcript(id)
    // The session the replay announced again is on the transcript once.
    expect(lines.filter((l) => l._tag === "Session" && l.id === LIVE)).toHaveLength(1)
    expect(lines.filter((l) => l._tag === "Reask")).toHaveLength(1)
  })

/** The restart finds the command gone: nothing is appended after it. */
const goneLeavesStopped = (id: TrakId, agentLog: Effect.Effect<AgentLog>) =>
  Effect.gen(function* () {
    const after = yield* restartedOver(id)
    expect((yield* agentLog).matched.at(-1)).toBe("gone")
    // Where the turn was — the in-flight state with nothing driving it that draws as
    // stopped, with Resume — rather than `Failed` on a `TurnFailed`.
    expect(after.state._tag).toBe("AgentWorking")
    expect((yield* (yield* Store).events(id)).at(-1)?._tag).toBe("Restarted")
  })

/**
 * A fresh detached turn that reported its spend, then lost its sandbox: the reattach after
 * the drop answers `gone`, which the runner raises without `gone` because the turn ran
 * here — a failure like any other.
 */
const removedMidTurn: Turn = {
  ...crashesOn(/Do the work/, "the sandbox for t no longer holds the turn's command", "removed"),
  spends: {
    inputTokens: 2,
    outputTokens: 4_000,
    cacheReadTokens: 30_000,
    cacheWriteTokens: 1_000,
    runCostUsd: 0.75,
  },
}

/** The removed sandbox's turn lands `Failed`, its reason and its spend on the `TurnFailed`. */
const removedLandsFailed = (id: TrakId) =>
  Effect.gen(function* () {
    const failed = yield* createAndStart(id, "x")
    expect(failed.state._tag).toBe("Failed")
    const last = (yield* (yield* Store).events(id)).at(-1)
    expect(last).toMatchObject({
      _tag: "TurnFailed",
      reason: "the sandbox for t no longer holds the turn's command",
      usage: { outputTokens: 4_000, costUsd: 0.75 },
    })
  })

describe("a rejoined turn", () => {
  it("re-asks a malformed answer with a fresh spawn, and writes no line twice", async () => {
    expect.hasAssertions()
    await runFlowWithAgentLog(
      [composer("work"), crashesOn(/Do the work/, "the engine went away"), rejoined, reasked],
      rejoinsThenReasks,
    )
  })

  it("leaves the trak stopped where it was when its command is gone from the sandbox", async () => {
    expect.hasAssertions()
    await runFlowWithAgentLog(
      [composer("work"), crashesOn(/Do the work/, "the engine went away"), goneFromSandbox],
      goneLeavesStopped,
    )
  })

  it("fails a fresh turn whose sandbox went mid-turn, keeping its reason and its spend", async () => {
    expect.hasAssertions()
    await runFlowWithAgentLog([composer("work"), removedMidTurn], removedLandsFailed)
  })
})
