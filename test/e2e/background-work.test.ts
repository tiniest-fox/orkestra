// A turn that ends more than once.
//
// An agent that has nothing left to do but wait says so, and the CLI ends the turn
// there; when its background task reports, the CLI starts another in the same process.
// The theme is which of those results is the step's answer: the first that holds the
// envelope, alone, or all of them where none does.
//
// What is deliberately NOT here: the pipe closing on the envelope, which only the
// harness can show (`provider-claude-fixtures`), and a single prose result on a step
// that owes an artifact (`agent-failures`).

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import {
  act,
  createAndStart,
  expectAwaiting,
  human,
  lastOutput,
  logTags,
  sectionOf,
  stoppedByFilings,
  transcriptTags,
} from "../support/scenario.js"
import { afterWaiting, onPrompt, reply } from "../support/scripted-agent.js"

const promptOf = (request: { readonly prompt: string }): string => request.prompt

const WAITING =
  "The machine's load average is above 30 from other processes, so the verify waits for it to fall and then runs; I will read the result when it ends."

describe("a step that owes an artifact and waits on background work", () => {
  it("files the artifact written after the task ends, and is not re-asked", async () => {
    await runFlowWithAgentLog(
      [composer("work"), afterWaiting([WAITING], step(1, "work", reply.artifact("Verify passed")))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "Add a --json flag")

          expectAwaiting(filed, "approval")
          expect(sectionOf(filed, "1-work")).toBe("Verify passed")
          // One spawn and no re-ask: the sentence about waiting was never read as the
          // step's answer, so nothing told the agent its response held no JSON.
          expect(stepRuns(yield* agentLog).length).toBe(1)
          expect(yield* transcriptTags(id)).not.toContain("Reask")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed", // the plan
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
    )
  })

  it("does not take JSON the agent quoted while waiting for its envelope", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        afterWaiting(
          ['Waiting on verify. The config it reads is `{"retries": 3}`.'],
          step(1, "work", reply.artifact("Verify passed")),
        ),
      ],
      (id) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "Add a --json flag")
          expect(sectionOf(filed, "1-work")).toBe("Verify passed")
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }),
    )
  })

  it("files the first envelope, and reads nothing the agent wrote after it", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        afterWaiting([reply.artifact("Review done")], step(1, "work", reply.prose("done"))),
      ],
      (id) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "Add a --json flag")
          expect(sectionOf(filed, "1-work")).toBe("Review done")
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }),
    )
  })

  it("is re-asked when the task ends and no result held an envelope", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        afterWaiting([WAITING], step(1, "work", reply.prose("Verify passed."))),
        onPrompt(/./, reply.artifact("Verify passed"), "the re-ask"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "Add a --json flag")
          expect(sectionOf(filed, "1-work")).toBe("Verify passed")
          expect(stepRuns(yield* agentLog).length).toBe(2)
          expect(yield* transcriptTags(id)).toContain("Reask")
        }),
    )
  })
})

describe("a step that files while background work is still running", () => {
  const NOTICE = "background work your last filing stopped"

  it("records the stopped task on the filing, and names it in that session's next prompt only", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        afterWaiting([reply.artifact("Review done")], step(1, "work", reply.prose("done"))),
        onPrompt(/which task/, reply.prose("The one I was waiting on."), "first chat"),
        onPrompt(/and now/, reply.prose("Nothing is running."), "second chat"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          expect(yield* stoppedByFilings(id)).toEqual([[{ id: "waited-on" }]])

          yield* act(id, 1, human.chat("which task?"))
          yield* act(id, 1, human.chat("and now?"))

          const [first, told, quiet] = stepRuns(yield* agentLog).map(promptOf)
          // The turn that filed was told nothing: nothing had been stopped yet.
          expect(first).not.toContain(NOTICE)
          expect(told?.startsWith("which task?")).toBe(true)
          expect(told).toContain(NOTICE)
          expect(told).toContain("- waited-on")
          // Said once. The chat that read it stopped nothing, so the next is bare.
          expect(quiet).toBe("and now?")
        }),
    )
  })

  it("records nothing, and says nothing, where the work ended before the filing", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        afterWaiting([WAITING], step(1, "work", reply.artifact("Verify passed"))),
        onPrompt(/which task/, reply.prose("None."), "chat"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.chat("which task?"))

          expect(yield* stoppedByFilings(id)).toEqual([])
          expect(stepRuns(yield* agentLog).at(-1)?.prompt).toBe("which task?")
        }),
    )
  })
})

describe("a conversational step that waits on background work", () => {
  it("files every result of the turn as one message, in order", async () => {
    const said = [
      "Two review agents are running; I will report when they are back.",
      "The first is back: the parser change is sound.",
      "Both are back. The parser change is sound and the migration needs a second look.",
    ] as const
    await runFlowWithAgentLog(
      [
        composer({ agent: "plan", conversational: true }, "work"),
        step(1, "plan", reply.prose("What should I look at?")),
        afterWaiting([said[0], said[1]], onPrompt(/review both/, reply.prose(said[2]), "report")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const told = yield* act(id, 1, human.chat("review both"))

          expectAwaiting(told, "conversation")
          expect(yield* lastOutput(id)).toEqual({ type: "message", text: said.join("\n\n") })
        }),
    )
  })
})
