// Flows where the agent misbehaves: malformed output, and a shape it may not send.
//
// Escalation is not misbehaviour and lives in its own theme — see escalation.test.ts.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlow, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import {
  approveAll,
  countTag,
  create,
  createAndStart,
  expectState,
  logTags,
  sectionOf,
  transcriptTags,
} from "../support/scenario.js"
import { always, onPrompt, onResume, reply } from "../support/scripted-agent.js"
import { stepName } from "../../src/workflow/domain/outputs/proposal.js"
import { slotAt } from "../../src/workflow/domain/trak.js"

describe("malformed output", () => {
  it("retries inside elicit and never reaches the state machine", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.prose("Sure, done!")),
        onResume(reply.artifact("Added --json"), "valid retry"),
      ],
      (id) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "Add a --json flag"))
          expectState(done, "Finished")
          // ONE AgentReturned — the retry happened below the engine, so the log
          // shows no failure and no extra iteration.
          expect(yield* countTag(id, "AgentReturned")).toBe(1)
          expect(slotAt(done, 1).iterations).toBe(1)
          // And the transcript says so, because nothing else can. The retry spawns a
          // second CLI, and a surface counting spawns against the one ending above
          // would hang this step's document on the wrong turn without this line.
          expect(yield* transcriptTags(id)).toContain("Reask")
        }),
    )
  })

  it("retries again when the retry is also unusable", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.prose("first attempt, no json")),
        onResume(reply.prose("still no json"), "bad retry"),
        onResume(reply.artifact("finally"), "good retry"),
      ],
      (id) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "x"))
          expectState(done, "Finished")
          expect(sectionOf(done, "1-work")).toBe("finally")
        }),
    )
  })
})

describe("a step that tries to give up", () => {
  it("cannot: `failed` is not a shape a step may write, so elicit re-prompts it", async () => {
    // Nothing an agent judges ends a trak. A step that cannot proceed escalates
    // with reason `stuck`, which is a help request the composer can act on —
    // where `failed` was a dead end nobody could schedule anything after.
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.failed("cannot reach the database")),
        onResume(reply.artifact("reached it after all"), "valid retry"),
      ],
      (id) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "x"))
          expectState(done, "Finished")
          expect(sectionOf(done, "1-work")).toBe("reached it after all")
        }),
    )
  })

  it("settles Failed{agent} when nothing usable ever arrives, which is the engine's verdict", async () => {
    // Still a real dead end, and still recorded — but as `orGiveUp`'s claim about
    // three unusable attempts rather than as the agent's claim about the work.
    await runFlow([composer("work"), always(reply.failed("cannot reach the database"))], (id) =>
      Effect.gen(function* () {
        const done = yield* createAndStart(id, "x")
        expect(done.state._tag).toBe("Failed")
        if (done.state._tag === "Failed") {
          expect(done.state.kind).toBe("agent")
          expect(done.state.error).toContain("no usable output after 3 attempts")
        }
      }),
    )
  })
})

describe("the composer proposes an agent that does not exist", () => {
  it("re-prompts and recovers instead of stranding the trak", async () => {
    // Before ProposalFor this failed at SPAWN time — after ProposalAccepted was
    // already committed — leaving the trak in AgentWorking with no event able to
    // move it. Now it is a decode failure, so elicit resumes the composer's
    // session with the reason and the bad proposal never reaches the log.
    await runFlow(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Add a --json flag", [{ agent: "nonexistent", instruction: "do it" }]),
          "compose: unknown agent",
        ),
        onResume(
          reply.proposal("Add a --json flag", [{ agent: "work", instruction: "do it" }]),
          "compose: corrected",
        ),
        step(1, "work", reply.artifact("done")),
      ],
      (id) =>
        Effect.gen(function* () {
          const trak = yield* approveAll(id, yield* create(id, "do a thing"))
          expectState(trak, "Finished")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            // one ComposerReturned: the unknown agent was rejected at decode
            // time and re-prompted below the engine, so it never reached the log
            "ComposerReturned",
            "HumanActed", // the plan, approved
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all, which is what ends the trak
          ])
          expect(trak.plan?.steps.map(stepName)).toEqual(["compose", "work"])
        }),
    )
  })
})

describe("an agent whose output never decodes", () => {
  it("gives up after 3 attempts and settles Failed, rather than looping", async () => {
    // This exact shape hung the suite before the cap: every reply is unusable, so
    // every retry produced another retry. Unbounded in tests is a spinning CPU;
    // against a real provider it is unbounded spend on a loop that cannot succeed.
    await runFlowWithAgentLog(
      [composer("work"), always(reply.prose("Sure, all done!"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = yield* createAndStart(id, "x")
          expect(trak.state._tag).toBe("Failed")

          // exactly 3 asks for the step, not 2 and not 4
          expect(stepRuns(yield* agentLog)).toHaveLength(3)
        }),
    )
  })

  it("records the give-up as the agent's own Failed output, never as a stall", async () => {
    // The cap alone would strand the trak: ElicitFailed escaping after the state
    // moved leaves AgentWorking with no agent and no event able to move it.
    await runFlow([composer("work"), always(reply.prose("no json here"))], (id) =>
      Effect.gen(function* () {
        const trak = yield* createAndStart(id, "x")
        expect(trak.state._tag).toBe("Failed")
        if (trak.state._tag === "Failed") {
          expect(trak.state.error).toContain("3 attempts")
        }
        // the log tells the story; nothing is left parked
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed",
          // No `ChecksPassed`: the agent gave up rather than filing an artifact,
          // and there is nothing for a check to run against.
          "ConditionsMet",
          "AgentReturned",
        ])
      }),
    )
  })

  it("still succeeds when a later attempt is usable", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.prose("nope")),
        onResume(reply.prose("still nope"), "bad retry"),
        onResume(reply.artifact("finally"), "good retry"),
      ],
      (id) =>
        Effect.gen(function* () {
          const trak = yield* approveAll(id, yield* create(id, "x"))
          expectState(trak, "Finished")
          expect(sectionOf(trak, "1-work")).toBe("finally")
        }),
    )
  })
})
