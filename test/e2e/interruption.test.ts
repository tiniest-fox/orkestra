// A trak that stopped, and being able to pick it back up.
//
// Two ways a trak stops mid-flight and one way back from both. The process dying
// writes no event, so the log replays to an in-flight state; the provider failing
// writes `TurnFailed`, so it replays to `Failed`. `Restarted` answers both, which
// is why there is one event rather than two.
//
// The flow that made this necessary: two real hours, four approved artifacts, and
// `API Error: Connection closed mid-response` at the end of it — recorded as the
// agent giving up, and unreachable by anything afterwards.

import * as fs from "node:fs"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { advance } from "../../src/workflow/runtime.js"
import { Events } from "../../src/workflow/domain/event.js"
import { slotAt, type Trak, type TrakId, TrakState } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import {
  composer,
  composerRuns,
  runFlow,
  runFlowWithAgentLog,
  step,
  stepRuns,
} from "../support/flow.js"
import {
  act,
  approveAll,
  sectionOf,
  create,
  createAndStart,
  ENGINE_VERSION,
  expectAwaiting,
  expectAwaitingProposal,
  expectState,
  human,
  logTags,
} from "../support/scenario.js"
import {
  crashesOn,
  crashesOnResume,
  failsToStartOn,
  onResume,
  reply,
} from "../support/scripted-agent.js"

/**
 * The kind a trak stopped with — or its state tag, when it did not stop.
 *
 * One assertion rather than a tag check plus a narrowing `if`, because the
 * narrowing form is what let these tests pass with the split reverted: an
 * `agent` verdict on a transport failure still reaches `Failed`, and only the
 * kind says which claim the log is making.
 */
const failureKind = (trak: Trak): string =>
  trak.state._tag === "Failed" ? trak.state.kind : trak.state._tag

/** The engine version each turn on the log ended under, in order. */
const enginesOf = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (store) => store.events(id)),
    (events) =>
      events.flatMap((e) =>
        e._tag === "ComposerReturned" || e._tag === "AgentReturned" || e._tag === "TurnFailed"
          ? [e.engineVersion]
          : [],
      ),
  )

describe("a provider that fails mid-turn", () => {
  it("says the provider failed, not that the agent gave up", async () => {
    await runFlow(
      [composer("work"), crashesOn(/Do the work/, "exit 1: connection closed mid-response")],
      (id) =>
        Effect.gen(function* () {
          const trak = yield* createAndStart(id, "x")

          expect(trak.state._tag).toBe("Failed")
          if (trak.state._tag !== "Failed") return
          // The distinction this file exists for. As `kind: "agent"` the log
          // asserts a verdict the agent never gave, about work it never got to
          // look at.
          expect(trak.state.kind).toBe("provider")
          expect(trak.state.error).toContain("connection closed mid-response")

          // A recorded fact of its own, rather than an `AgentReturned` carrying a
          // fabricated `failed` output.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "TurnFailed",
          ])
        }),
    )
  })

  it("keeps the position, so a retry re-enters the step rather than the pipeline", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        crashesOn(/Produce the work/, "usage limit reached"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x") // step 0 runs
          const failed = yield* act(id, 1, human.approve()) // step 1 crashes

          expect(failureKind(failed)).toBe("provider")
          // Step 2, not the first entry — coming back at the top would silently redo
          // work a human already approved, and pay for it again.
          expect(failed.failedFrom).toEqual(TrakState.AgentWorking({ step: 2 }))
          expect(sectionOf(failed, "1-plan")).toBe("the plan")

          // Step 0's artifact arrived as an `AgentReturned`; step 1's crash did
          // not. Recorded as the agent giving up, this log would end in a second
          // `AgentReturned` and every assertion above would still hold.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "ConditionsMet",
            "TurnFailed",
          ])
          // A turn that died names the engine it died under, the same as one that
          // filed — see `versioned`.
          expect(yield* enginesOf(id)).toEqual([ENGINE_VERSION, ENGINE_VERSION, ENGINE_VERSION])

          // The crashed turn's own session, filed against the step it crashed on
          // — which is the whole of what makes the retry cheap.
          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(2)
          expect(slotAt(failed, 2).session).toBe(runs[1]?.sessionId)
          expect(slotAt(failed, 2).session).not.toBe(slotAt(failed, 1).session)
        }),
    )
  })
})

describe("what a failed trak keeps", () => {
  it("records no session when the CLI never made one, so the retry cannot resume nothing", async () => {
    // The other half of `ProviderFailed`: a missing binary, expired auth, a usage
    // limit rejected before the first line. The id was minted, but it names
    // nothing — and filing it anyway made the retry pass `--resume <id>` for a
    // conversation that does not exist, which fails, which files the same id
    // again. A trak permanently unretryable, produced by the field that exists to
    // make retrying cheap.
    await runFlowWithAgentLog(
      [
        composer("work"),
        failsToStartOn(/Do the work/, "exit 1: claude: command not found"),
        onResume(reply.artifact("never reached"), "must not be reachable"),
        step(1, "work", reply.artifact("done on a fresh session"), "retry from scratch"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const failed = yield* createAndStart(id, "x")
          expect(failureKind(failed)).toBe("provider")
          expect(slotAt(failed, 1).session).toBeUndefined()

          const retried = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(retried, "approval")
          expect(sectionOf(retried, "1-work")).toBe("done on a fresh session")

          // A fresh session, and no `--resume`. Asserting the reply alone would
          // pass either way; asserting `resumeFrom` is what pins it.
          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(2)
          expect(runs[1]?.resumeFrom).toBeUndefined()
          expect(runs[1]?.sessionId).not.toBe(runs[0]?.sessionId)
        }),
    )
  })

  it("keeps its worktree, so the work is still there when someone comes back", async () => {
    // Documented on `TrakState.Failed` and asserted nowhere until now: a failed
    // trak is exactly when someone wants to look at what the agent left behind,
    // so the checkout outlives the failure rather than being cleaned up with it.
    await runFlow([composer("work"), crashesOn(/Do the work/, "exit 1: connection closed")], (id) =>
      Effect.gen(function* () {
        const failed = yield* createAndStart(id, "x")
        expect(failureKind(failed)).toBe("provider")

        const worktree = failed.worktree
        expect(worktree?.branch).toBe(`trak/${id}`)
        // `?? ""` rather than a narrowing branch: `existsSync("")` is false, so
        // "there was no worktree" fails here instead of skipping the assertion.
        expect(fs.existsSync(worktree?.path ?? "")).toBe(true)
      }),
    )
  })

  it("a composer that never returned resumes its own session rather than re-planning", async () => {
    // The composer half of the same fact, and the one with no step index: a
    // failure there files `composerSession`, so the retry carries on the
    // conversation that already holds the request instead of paying to rebuild
    // the plan from the description.
    await runFlowWithAgentLog(
      [
        crashesOn(/Compose a pipeline/, "exit 1: connection closed mid-response"),
        onResume(
          reply.proposal("Add a --json flag", [
            { agent: "work", instruction: "Produce the summary." },
          ]),
          "compose again",
        ),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const failed = yield* create(id, "x")
          expect(failureKind(failed)).toBe("provider")
          expect(failed.failedFrom).toEqual(TrakState.Composing())
          expect(yield* logTags(id)).toEqual(["TrakCreated", "WorktreeReady", "TurnFailed"])

          const retried = yield* advance(id, Events.restarted(undefined))
          expectAwaitingProposal(retried)

          const runs = composerRuns(yield* agentLog)
          expect(runs).toHaveLength(2)
          expect(failed.composerSession).toBe(runs[0]?.sessionId)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
    )
  })
})

describe("retrying a failed trak", () => {
  it("re-runs the failed turn and carries the trak through to Finished", async () => {
    await runFlow(
      [
        composer("work"),
        crashesOn(/Do the work/, "exit 1: connection closed"),
        onResume(reply.artifact("done on the second go"), "retry after the crash"),
      ],
      (id) =>
        Effect.gen(function* () {
          const failed = yield* createAndStart(id, "x")
          expectState(failed, "Failed")

          // What `ork resume` sends once a human says yes.
          const retried = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(retried, "approval")
          expect(sectionOf(retried, "1-work")).toBe("done on the second go")

          expectState(yield* approveAll(id, retried), "Finished")

          // The log tells the whole story, failure included — a retry does not
          // rewrite what happened, it continues from it.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "TurnFailed",
            "Restarted",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all, which is what ends the trak
          ])
        }),
    )
  })

  it("resumes the conversation the failed turn was having, not a fresh one", async () => {
    // The assertion that matters most here, and the one final state cannot make:
    // a retry that starts a new session pays to rebuild the context the failed
    // turn already had, and looks identical from the outside.
    await runFlowWithAgentLog(
      [
        composer("work"),
        crashesOn(/Do the work/, "exit 1: connection closed"),
        onResume(reply.artifact("second go"), "retry after the crash"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          yield* advance(id, Events.restarted(undefined))

          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(2)
          const crashed = runs[0]
          const again = runs.at(-1)
          expect(again?.resumeFrom).toBe(crashed?.sessionId)
          expect(again?.sessionId).toBe(crashed?.sessionId)
        }),
    )
  })
})

describe("a retry is held to the work, and never capped", () => {
  it("still owes an artifact — a retry is not a conversation", async () => {
    // `Interrupted` turns the same two dials `CheckFailure` does: resumed, but not
    // a conversation. Nobody was waiting to read the crashed turn's reply, so
    // prose is not an answer and `elicit` holds the step to its schema.
    await runFlowWithAgentLog(
      [
        composer("work"),
        crashesOn(/Do the work/, "exit 1: connection closed"),
        onResume(reply.prose("I had a bit of trouble there"), "prose on the retry"),
        onResume(reply.artifact("properly this time"), "the re-prompt"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const failed = yield* createAndStart(id, "x")
          expect(failureKind(failed)).toBe("provider")

          const retried = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(retried, "approval")
          expect(sectionOf(retried, "1-work")).toBe("properly this time")

          // One `TurnFailed`, then one `AgentReturned` — the re-prompt happens
          // inside `elicit` and is not an event. Recorded as the agent giving up
          // instead, this log would open with `AgentReturned`, which is the whole
          // claim the split is about.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "TurnFailed",
            "Restarted",
            "AgentReturned",
            "ChecksPassed",
          ])

          // Three step turns on one session: the crash, the prose, and the
          // re-prompt `elicit` sent because prose is not an answer here.
          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(3)
          expect(runs[1]?.sessionId).toBe(runs[0]?.sessionId)
          expect(runs[2]?.sessionId).toBe(runs[0]?.sessionId)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
    )
  })

  it("a second failure is just another failure — retrying is not capped", async () => {
    // A human deciding to retry is the bound. Nothing here counts attempts,
    // because the thing being waited out is usually a usage window.
    await runFlowWithAgentLog(
      [
        composer("work"),
        crashesOn(/Do the work/, "usage limit reached"),
        crashesOnResume("usage limit still reached"),
        onResume(reply.artifact("finally"), "third time"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const first = yield* createAndStart(id, "x")
          expect(failureKind(first)).toBe("provider")

          const again = yield* advance(id, Events.restarted(undefined))
          // Still the provider, and still pointing at the same step: a second
          // failure must not overwrite the position with the first failure, which
          // is what made a trak unretryable forever.
          expect(failureKind(again)).toBe("provider")
          expect(again.failedFrom).toEqual(TrakState.AgentWorking({ step: 1 }))

          const worked = yield* advance(id, Events.restarted(undefined))
          expectAwaiting(worked, "approval")
          expect(sectionOf(worked, "1-work")).toBe("finally")

          // Two failures, two restarts, one artifact — and no `AgentReturned`
          // standing in for either failure.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "TurnFailed",
            "Restarted",
            "TurnFailed",
            "Restarted",
            "AgentReturned",
            "ChecksPassed",
          ])

          // One conversation across all three, which is what the second
          // `TurnFailed` re-recording the session is for.
          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(3)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
          expect(runs[2]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
    )
  })
})

describe("an agent that gives up is still the agent's verdict", () => {
  it("stays kind: agent, and stays retryable", async () => {
    // The other half of the split. `orGiveUp` still catches an exhausted `elicit`
    // — an agent that cannot produce valid output IS the agent failing — and only
    // the transport half moved. Both are retryable; they differ in what a human
    // should expect from retrying.
    await runFlow(
      [composer("work"), step(1, "work", reply.failed("cannot reach the database"))],
      (id) =>
        Effect.gen(function* () {
          const trak = yield* createAndStart(id, "x")
          expect(trak.state._tag).toBe("Failed")
          if (trak.state._tag !== "Failed") return
          expect(trak.state.kind).toBe("agent")
          expect(trak.failedFrom).toEqual({ _tag: "AgentWorking", step: 1 })
        }),
    )
  })
})
