// A step whose artifact is not owed on the first turn.
//
// The theme is the deferred deadline: prose is an ordinary output here rather
// than a decode failure, the human stands *in* the conversation instead of at a
// gate they came from, and the artifact — when it finally arrives — is filed,
// checked and gated exactly like any other.
//
// What is deliberately NOT here: whether prose is still a failure on an ordinary
// step (`agent-failures`), and talking to a step that has already filed
// (`conversation`).

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import {
  act,
  createAndStart,
  expectAwaiting,
  expectState,
  human,
  logTags,
  sectionOf,
} from "../support/scenario.js"
import { onPrompt, reply } from "../support/scripted-agent.js"
import type { SessionId, SessionRequest } from "../../src/agent/types/session.js"
import { slotAt } from "../../src/workflow/domain/trak.js"

// Hoisted: a `.map` inside a flow body is one callback past the limit.
const sessionIds = (runs: readonly SessionRequest[]): readonly (SessionId | undefined)[] =>
  runs.map((r) => r.sessionId)

const resumedFrom = (runs: readonly SessionRequest[]): readonly (SessionId | undefined)[] =>
  runs.map((r) => r.resumeFrom)

/** The plan every test here runs: one conversational step, then an ordinary one. */
const riffThenWork = composer({ agent: "plan", conversational: true }, "work")

describe("a conversational step", () => {
  it("answers in prose without failing decode, and parks in the conversation", async () => {
    await runFlowWithAgentLog(
      [riffThenWork, step(1, "plan", reply.prose("What are we optimising for — speed or scope?"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = yield* createAndStart(id, "Add a --json flag")

          // Its own gate, and the only one with nothing to approve: the step has
          // filed nothing, so advancing would step past work nobody has done.
          expectAwaiting(trak, "conversation")
          expectState(trak, "AwaitingHuman", 1)
          expect(trak.artifacts.size).toBe(0)
          // A conversational reply is not an attempt at the step's work.
          expect(slotAt(trak, 1).iterations).toBe(0)

          // One turn. `converse` never re-prompts prose, so prose costs exactly what it
          // says — the three attempts an enforced step would have spent are the
          // behaviour this flag removes.
          expect(stepRuns(yield* agentLog).length).toBe(1)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed", // the plan
            "ConditionsMet",
            "AgentReturned", // prose, and no ChecksPassed behind it
          ])
        }),
    )
  })

  it("keeps one conversation across every turn rather than starting over", async () => {
    await runFlowWithAgentLog(
      [
        riffThenWork,
        step(1, "plan", reply.prose("What are we optimising for?")),
        onPrompt(/scope/, reply.prose("Scope it is. Anything to leave out?"), "second"),
        onPrompt(/nothing else/, reply.prose("Then here is what I would do."), "third"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.chat("scope"))
          const trak = yield* act(id, 1, human.chat("nothing else"))

          expectAwaiting(trak, "conversation")

          // The assertion this file exists for. `resumeFrom` keyed off the
          // iteration count alone would mint a fresh session on every reply — a
          // conversational step never bumps one — throwing away the conversation
          // being replied to. Silently: the prose still comes back.
          const runs = stepRuns(yield* agentLog)
          const first = runs[0]?.sessionId
          expect(sessionIds(runs)).toEqual([first, first, first])
          expect(resumedFrom(runs)).toEqual([undefined, first, first])
        }),
    )
  })

  it("still owes its artifact, which is filed, checked and gated like any other", async () => {
    await runFlowWithAgentLog(
      [
        riffThenWork,
        step(1, "plan", reply.prose("Talking it through first.")),
        onPrompt(/write it up/, reply.artifact("Ship the flag on `list` only"), "settled"),
        step(2, "work", reply.artifact("Done")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const settled = yield* act(id, 1, human.chat("write it up"))

          // The deadline moved; the output did not. Once the document arrives it is
          // the step's artifact under the step's key, and what a human is standing
          // at is the ordinary approval gate.
          expectAwaiting(settled, "approval")
          expect(sectionOf(settled, "1-plan")).toBe("Ship the flag on `list` only")
          expect(slotAt(settled, 1).iterations).toBe(1)

          const next = yield* act(id, 1, human.approve())
          expectState(next, "AwaitingHuman", 2)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed", // the plan
            "ConditionsMet",
            "AgentReturned", // prose
            "HumanActed", // write it up
            "AgentReturned", // the artifact
            "ChecksPassed", // which is verified like any other
            "HumanActed", // approved
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "ConditionsMet",
            "AgentReturned", // 1-work
            "ChecksPassed",
          ])
        }),
    )
  })
})

describe("a conversation that ends without an artifact", () => {
  it("can be abandoned, and the next step is told so", async () => {
    await runFlowWithAgentLog(
      [
        riffThenWork,
        step(1, "plan", reply.prose("What are we optimising for?")),
        step(2, "work", reply.artifact("Done")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const skipped = yield* act(id, 1, human.skip("forget the planning, just build it"))

          // The other half of the same tolerance: a conversation that is not going
          // anywhere ends by moving on, not by producing an artifact nobody wants.
          expectAwaiting(skipped, "approval")
          expectState(skipped, "AwaitingHuman", 2)
          expect(skipped.artifacts.has("1-plan")).toBe(false)

          const prompt = stepRuns(yield* agentLog).at(-1)?.prompt ?? ""
          expect(prompt).toContain("`1-plan` was skipped")
          expect(prompt).toContain("forget the planning, just build it")
        }),
    )
  })

  it("goes back to its approval gate once it has filed, not into the conversation", async () => {
    await runFlowWithAgentLog(
      [
        riffThenWork,
        step(1, "plan", reply.artifact("Ship the flag on `list` only")),
        onPrompt(/what about/, reply.prose("Because the others take no options."), "aside"),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const asked = yield* act(id, 1, human.chat("what about the other commands?"))

          // Conversational says the artifact is not owed *yet*, never that this
          // step has no ordinary gate. Once the document exists, a human talking to
          // the step is standing at its approval gate and must get it back — with
          // the artifact still on the table.
          expectAwaiting(asked, "approval")
          expect(sectionOf(asked, "1-plan")).toBe("Ship the flag on `list` only")
        }),
    )
  })
})
