// Talking to a parked agent: a human types, the agent answers, nothing moves.
//
// The theme is the reply itself — that it costs one turn, resumes the same
// conversation, leaves the work alone, and puts the human back exactly where they
// were. Which gate they were at is `human-gates`; whether prose is a failure on a
// turn nobody asked for is `agent-failures`.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import {
  act,
  countTag,
  sectionOf,
  create,
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectState,
  human,
  logTags,
  transcriptTags,
} from "../support/scenario.js"
import { onPrompt, onResume, reply, type AgentLog } from "../support/scripted-agent.js"
import type { SessionId, SessionRequest } from "../../src/agent/types/session.js"
import { slotAt, type Trak } from "../../src/workflow/domain/trak.js"

// Hoisted: a `.map` inside a flow body is one callback past the limit.

/** Every prompt as one string. */
const allPrompts = (log: AgentLog): string => log.requests.map((r) => r.prompt).join("\n")

const sessionIds = (runs: readonly SessionRequest[]): readonly (SessionId | undefined)[] =>
  runs.map((r) => r.sessionId)

/** What the trak has settled, as text. */
const decisionTexts = (trak: Trak): readonly string[] => trak.decisions.map((d) => d.text)

const resumedFrom = (runs: readonly SessionRequest[]): readonly (SessionId | undefined)[] =>
  runs.map((r) => r.resumeFrom)

describe("a step answering a question", () => {
  it("replies in prose, and the human is left standing at the same gate", async () => {
    await runFlowWithAgentLog(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("Added --json to `list` only")),
        onPrompt(
          /why only list/,
          reply.prose("Because the other commands take no options."),
          "ask",
        ),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const answered = yield* act(id, 1, human.chat("why only list?"))

          // Same gate, same step, same artifact: a conversation is not a version.
          expectAwaiting(answered, "approval")
          expectState(answered, "AwaitingHuman", 1)
          expect(sectionOf(answered, "1-work")).toBe("Added --json to `list` only")
          expect(slotAt(answered, 1).iterations).toBe(1)

          // One turn, not a spawn and not a retry — `converse` never re-prompts prose.
          expect(stepRuns(yield* agentLog).length).toBe(2)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed", // the plan
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed", // the question
            // The reply is not work, so nothing verifies it — the same reason it
            // does not count as an iteration.
            "AgentReturned", // the answer
          ])
        }),
    )
  })

  it("resumes the same conversation rather than starting a fresh one", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.artifact("v1")),
        onPrompt(/why/, reply.prose("Because."), "answer"),
        onPrompt(/narrower/, reply.artifact("v2"), "revise"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.chat("why?"))
          const revised = yield* act(id, 1, human.chat("make it narrower"))

          // The reply not counting as an attempt must not cost the next turn its
          // session — this is the assertion that pins the two together.
          const runs = stepRuns(yield* agentLog)
          const first = runs[0]?.sessionId
          expect(sessionIds(runs)).toEqual([first, first, first])
          expect(resumedFrom(runs.slice(1))).toEqual([first, first])

          // And a conversation can still end in work.
          expect(sectionOf(revised, "1-work")).toBe("v2")
          expect(slotAt(revised, 1).iterations).toBe(2)
        }),
    )
  })
})

describe("a chat that changes the document", () => {
  it("sends only the sections it edited, and the rest stand as filed", async () => {
    // The cost this removes: a one-line chat re-filing the whole document, two thirds
    // of it verbatim. The envelope carries the edit; the engine lays it over the rest.
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/two steps/, reply.sectioned({ Steps: "1. edit ork.ts\n2. test it" }), "amend"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const amended = yield* act(id, 1, human.chat("make it two steps"))

          expectAwaiting(amended, "approval")
          expect(sectionOf(amended, "1-design", "Steps")).toBe("1. edit ork.ts\n2. test it")
          // Not sent, so not lost.
          expect(sectionOf(amended, "1-design")).toBe("add the flag")
          // An edit is work: it is verified and counts as an iteration, where a reply
          // does neither.
          expect(slotAt(amended, 1).iterations).toBe(2)
          expect(stepRuns(yield* agentLog).length).toBe(2)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
    )
  })

  it("owes the same envelope at whichever gate the chat came from", async () => {
    // The contract promises the relaxation on every chat, and a chat is offered at
    // every gate — so the engine tells a filed artifact from a stuck account by what
    // the position filed, not by where it is parked. A step that filed and then asked
    // is chatted at from `answers`, and one section is still a whole envelope there.
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/test it too/, reply.questions("Which runner?"), "ask"),
        onPrompt(/vitest/, reply.sectioned({ Steps: "1. edit ork.ts\n2. vitest" }), "amend"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const asked = yield* act(id, 1, human.chat("test it too?"))
          expectAwaiting(asked, "answers")

          const amended = yield* act(id, 1, human.chat("vitest"))
          expectAwaiting(amended, "approval")
          expect(sectionOf(amended, "1-design", "Steps")).toBe("1. edit ork.ts\n2. vitest")
          expect(sectionOf(amended, "1-design")).toBe("add the flag")
          expect(stepRuns(yield* agentLog).length).toBe(3)
        }),
    )
  })
})

describe("a chat whose envelope is refused", () => {
  it("re-prompts an envelope that was meant and refused, and files what the retry sends", async () => {
    // Before this, a refused amendment was filed as prose: the person read the raw
    // JSON, the agent was never told, and the guidance in the refusal had no reader.
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/two steps/, reply.sectioned({ steps: "1. edit ork.ts\n2. test it" }), "misspelt"),
        onResume(reply.sectioned({ Steps: "1. edit ork.ts\n2. test it" }), "corrected"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const amended = yield* act(id, 1, human.chat("make it two steps"))

          expectAwaiting(amended, "approval")
          expect(sectionOf(amended, "1-design", "Steps")).toBe("1. edit ork.ts\n2. test it")
          expect(sectionOf(amended, "1-design", "steps")).toBeUndefined()
          // The retry happened below the engine: one ending, and the transcript is
          // the only place it shows.
          expect(yield* countTag(id, "AgentReturned")).toBe(2)
          expect(yield* transcriptTags(id)).toContain("Reask")
          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(3)
          expect(runs[2]?.resumeFrom).toBe(runs[1]?.sessionId)
        }),
    )
  })

  it("takes a reply that ends in JSON that was never an envelope as the answer", async () => {
    // The false positive `converse` exists to protect: a config block shown to the
    // person is not an envelope that got something wrong, and costs one turn.
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/what config/, 'This one:\n```json\n{ "port": 3000 }\n```', "shown"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const answered = yield* act(id, 1, human.chat("what config does it read?"))
          expectAwaiting(answered, "approval")
          expect(sectionOf(answered, "1-design")).toBe("add the flag")
          expect(stepRuns(yield* agentLog)).toHaveLength(2)
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }),
    )
  })

  it("hands the last text to the person when three envelopes in a row are refused", async () => {
    // A person is at the prompt, so the ending is their reading the raw text and
    // saying so — not the trak settling failed under them.
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/two steps/, reply.sectioned({ steps: "x" }), "misspelt"),
        onResume(reply.sectioned({ steps: "x" }), "misspelt again"),
        onResume(reply.sectioned({ steps: "x" }), "misspelt a third time"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const parked = yield* act(id, 1, human.chat("make it two steps"))
          expectAwaiting(parked, "approval")
          expect(sectionOf(parked, "1-design", "Steps")).toBe("1. edit ork.ts")
          expect(slotAt(parked, 1).iterations).toBe(1)
          expect(stepRuns(yield* agentLog)).toHaveLength(4)
          expect(yield* logTags(id)).not.toContain("TurnFailed")
        }),
    )
  })
})

describe("a chat whose envelope does not parse", () => {
  it("re-prompts with the parser's complaint, and files what the retry sends", async () => {
    // Unparseable JSON looked the same as prose to the extractor, so a turn that meant
    // to file was filed as a message and the agent was never told.
    const broken = '```json\n{ "type": "artifact", "sections": { "Steps": "a" "b" } }\n```'
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/two steps/, `Done.\n\n${broken}`, "broken"),
        onResume(reply.sectioned({ Steps: "1. edit ork.ts\n2. test it" }), "corrected"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const amended = yield* act(id, 1, human.chat("make it two steps"))

          expectAwaiting(amended, "approval")
          expect(sectionOf(amended, "1-design", "Steps")).toBe("1. edit ork.ts\n2. test it")
          expect(yield* transcriptTags(id)).toContain("Reask")
          const log = yield* agentLog
          expect(allPrompts(log)).toMatch(/does not parse.*at position \d+/)
          const runs = stepRuns(log)
          expect(runs).toHaveLength(3)
          expect(runs[2]?.resumeFrom).toBe(runs[1]?.sessionId)
        }),
    )
  })

  it("takes prose that quotes an envelope inline as the answer, with no retry", async () => {
    // What an agent says when asked why its last filing was not read: the key it names
    // sits in a sentence, not at the start of a block.
    const said =
      'It was not read because the envelope `{ "type": "artifact", "sections": { … } }` had a trailing comma.'
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/why was it not read/, said, "explains"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const answered = yield* act(id, 1, human.chat("why was it not read?"))
          expectAwaiting(answered, "approval")
          expect(sectionOf(answered, "1-design", "Steps")).toBe("1. edit ork.ts")
          expect(stepRuns(yield* agentLog)).toHaveLength(2)
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }),
    )
  })

  it("still takes plain prose as the answer, with no retry", async () => {
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(/why one step/, "Because the flag touches one file { ork.ts }.", "prose"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const answered = yield* act(id, 1, human.chat("why one step?"))
          expectAwaiting(answered, "approval")
          expect(sectionOf(answered, "1-design", "Steps")).toBe("1. edit ork.ts")
          expect(stepRuns(yield* agentLog)).toHaveLength(2)
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }),
    )
  })
})

describe("a chat that settles something without editing", () => {
  it("files a requirement settled in conversation on an envelope with no sections", async () => {
    await runFlowWithAgentLog(
      [
        composer("design"),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "1. edit ork.ts" })),
        onPrompt(
          /per key/,
          reply.settling([
            { text: "rate limiting is per key", kind: "constraint", source: "stated" },
          ]),
          "settled",
        ),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const settled = yield* act(id, 1, human.chat("rate limit per key, not per IP"))
          expectAwaiting(settled, "approval")
          expect(sectionOf(settled, "1-design")).toBe("add the flag")
          expect(decisionTexts(settled)).toContain("rate limiting is per key")
          expect(stepRuns(yield* agentLog)).toHaveLength(2)
        }),
    )
  })
})

describe("the composer answering a question about its plan", () => {
  it("answers without re-proposing, and nothing runs", async () => {
    await runFlowWithAgentLog(
      [
        composer("work", "review"),
        onPrompt(/why does review/, reply.prose("Because it needs something to read."), "answer"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const planned = yield* create(id, "Add a --json flag")
          expectAwaitingProposal(planned)

          const answered = yield* act(id, 0, human.chat("why does review come last?"))
          expectAwaitingProposal(answered)
          // Three entries: the compose that wrote the two steps is one of them, and the
          // chat resumed its session rather than starting a run of its own.
          expect(answered.plan?.steps.length).toBe(3)

          const log = yield* agentLog
          expect(allPrompts(log)).not.toContain("artifact named")
          const runs = composerRuns(log)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
    )
  })
})

describe("arguing with a step that could not do the work", () => {
  it("keeps the stuck gate intact, so what it offers still means what it meant", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "review"),
        step(1, "plan", reply.artifact("v1")),
        step(2, "review", reply.stuck("two passes over the diff")),
        onPrompt(/look again/, reply.prose("You are right, I missed them."), "answer"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const gaveUp = yield* act(id, 1, human.approve())
          expectAwaiting(gaveUp, "stuck")

          // The case a display-only "reply" gate loses: after the reviewer answers,
          // the human is still standing where the account put them, with the same
          // three answers — not one gate further forward.
          const answered = yield* act(id, 2, human.chat("tests exist, look again"))
          expectAwaiting(answered, "stuck")

          // And the reply cost nothing but a turn of the reviewer's own session.
          expect(slotAt(answered, 1).iterations).toBe(1)
          // The human's words went to the reviewer, and nothing was scheduled off
          // the back of it: nothing is planned from a stuck account.
          expect(answered.reconsult).toBeUndefined()
          expect(allPrompts(yield* agentLog)).toContain("tests exist, look again")
        }),
    )
  })
})
