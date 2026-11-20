// The path where nothing goes wrong: the agent cooperates and the human approves.
//
// Every trak here runs `manual`, which is what `create` defaults to: a person is
// standing at every gate. What "happy" means is that each one is approved and each
// step produces what it was asked for. A trak whose person said otherwise is
// `run-mode.test.ts`, and nothing an agent or the composer writes can say it.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlow, runFlowWithAgentLog, step } from "../support/flow.js"
import {
  act,
  artifactOf,
  sectionOf,
  create,
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectState,
  human,
  logTags,
} from "../support/scenario.js"
import type { TranscriptEntry, TurnPosition } from "../../src/agent/types/transcript-entry.js"
import type { Event } from "../../src/workflow/domain/event.js"
import { Store } from "../../src/workflow/ports/store.js"
import { onPrompt, onResume, reply } from "../support/scripted-agent.js"
import { slotAt } from "../../src/workflow/domain/trak.js"

/** Transcript entries of one kind. At module scope so an assertion is not a fifth callback. */
const countNotes = (entries: readonly TranscriptEntry[], prefix: string): number =>
  entries.filter((e) => e._tag === "Note" && e.text.startsWith(prefix)).length

const countTags = (entries: readonly TranscriptEntry[], tag: TranscriptEntry["_tag"]): number =>
  entries.filter((e) => e._tag === tag).length

/** The time each line was stamped with, in the order the file holds them. */
const stamps = (entries: readonly TranscriptEntry[]): readonly number[] =>
  entries.flatMap((e) => (e.at === undefined ? [] : [e.at]))

/** The same numbers in order, which is what they already are when nothing went backwards. */
const ascending = (values: readonly number[]): readonly number[] =>
  [...values].sort((a, b) => a - b)

/** The distinct positions the transcript was stamped with, in the order they appear. */
const positions = (entries: readonly TranscriptEntry[]): readonly (TurnPosition | undefined)[] => [
  ...new Set(entries.map((e) => e.position)),
]

describe("happy path", () => {
  it("composes, runs one step, and waits — an artifact never advances itself", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.gen(function* () {
        // The plan is the first thing that waits: nothing has run yet, and the
        // whole sequence is what approving it commits to.
        const plan = yield* create(id, "Add a --json flag")
        expectAwaitingProposal(plan)
        expect(plan.plan?.steps).toHaveLength(2)
        expect(plan.artifacts.size).toBe(0)

        const parked = yield* act(id, 0, human.approve())
        expectAwaiting(parked, "approval")
        expect(sectionOf(parked, "1-work")).toBe("Added --json")

        const done = yield* act(id, 1, human.approve())
        expectState(done, "Finished")
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
          "WorkCommitted", // Integrating's catch-all, which is what ends the trak
        ])
      }),
    )
  })

  it("runs a two-step sequence, gating both artifacts, then settles past the last", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("the work")),
      ],
      (id) =>
        Effect.gen(function* () {
          const first = yield* createAndStart(id, "Add a --json flag")
          expectState(first, "AwaitingHuman", 1)

          // The LAST step's artifact gates too — Finished waits for its approval.
          const second = yield* act(id, 1, human.approve())
          expectState(second, "AwaitingHuman", 2)

          const done = yield* act(id, 2, human.approve())
          expectState(done, "Finished")
          expect(slotAt(done, 1).iterations).toBe(1)
          expect(slotAt(done, 2).iterations).toBe(1)
          expect([...done.artifacts.keys()]).toEqual(["1-plan", "2-work"])
        }),
    )
  })

  it("a review that approves is confirmed by the human, not trusted on its own", async () => {
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        // No `approve` envelope: a reviewer content with the work writes its
        // findings like any other step, and that IS the approval.
        step(2, "review", reply.artifact("checked the tests — ship it")),
      ],
      (id) =>
        Effect.gen(function* () {
          const artifactGate = yield* createAndStart(id, "x")
          expectAwaiting(artifactGate, "approval")

          // Approving the work runs the reviewer, which parks again — on its own
          // artifact. A human who disagrees needs somewhere to say so.
          const reviewGate = yield* act(id, 1, human.approve())
          expectAwaiting(reviewGate, "approval")
          expectState(reviewGate, "AwaitingHuman", 2)

          const done = yield* act(id, 2, human.approve())
          expectState(done, "Finished")
          // And the review is readable afterwards, which an Approval never was.
          expect(sectionOf(done, "2-review")).toBe("checked the tests — ship it")
        }),
    )
  })

  it("writes down what the agent did, with a burst of thinking as one line", async () => {
    // Tier 2 of the store, which nothing asserted on until a real transcript came
    // back 87% `Unknown`. Three things are pinned here: that the events a turn
    // produces are named rather than dropped, and that `withTranscript` records a
    // burst of thinking ONCE and a re-announced session ONCE. A real turn sends
    // dozens of ticks, and picks its session back up once per background task —
    // per-tick and per-re-entry lines are what made the log unreadable.
    await runFlow(
      [
        { ...composer("work"), thinks: 3 },
        { ...step(1, "work", reply.artifact("done")), thinks: 12, reannounces: 2 },
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const store = yield* Store
          const entries = yield* store.transcript(id)

          // One per turn, not one per tick — and the count is what would regress.
          expect(countNotes(entries, "Thinking")).toBe(2)
          // Two turns, two sessions, though the second turn announced its own three
          // times. Nothing collapsed that was not a repeat, and nothing became "Unknown".
          expect(countTags(entries, "Session")).toBe(2)
          expect(countNotes(entries, "Unknown")).toBe(0)

          // Every line says which turn wrote it, and the two turns say different
          // things. This is the only tier that can assert that: a unit test of
          // `carried` sees one value, and what could regress is the two *call
          // sites* — `Compose` passing the composer's marker and `SpawnStep`
          // passing its step — not the spread.
          expect(positions(entries)).toStrictEqual(["composer", 1])

          // And every line says when it was written, which is what makes a duration a
          // stored fact rather than a provider heartbeat. Asserted here for the same
          // reason: the stamp is applied at the one call site, and only a flow reaching
          // the store proves it survived to the file. Non-decreasing because they were
          // written in this order and a duration is the gap between two of them.
          const times = stamps(entries)
          expect(times).toHaveLength(entries.length)
          expect(ascending(times)).toStrictEqual(times)
        }),
    )
  })
})

/** Each `Background` row's set of task ids, in transcript order. At module scope for the
 * reason `countNotes` is: an assertion is not the place for a fifth nested callback. */
const levelSets = (entries: readonly TranscriptEntry[]): readonly (readonly string[])[] =>
  entries.flatMap((e) => (e._tag === "Background" ? [e.tasks.map((t) => t.id)] : []))

describe("the background level in the store", () => {
  it("writes one row per change of set, though teardown repeats an unchanged one", () => {
    // The level has REPLACE semantics, so a set equal to the last one recorded says
    // nothing — and a real teardown emits one unchanged level per task it is stopping,
    // in the same millisecond. What is kept is each change, empty set included: the
    // last row is what was outstanding when the turn ended, and the empty one is the
    // only thing that says the last job landed.
    return runFlow(
      [
        composer("work"),
        {
          ...step(1, "work", reply.artifact("done")),
          levels: [["a"], ["a"], ["a", "b"], [], [], []],
        },
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const store = yield* Store
          expect(levelSets(yield* store.transcript(id))).toStrictEqual([["a"], ["a", "b"], []])
        }),
    )
  })
})

/** The text each turn wrote its output as, in log order. At module scope for the reason
 * `countNotes` is: an assertion is not the place for a fifth nested callback. */
const wroteAs = (events: readonly Event[]): readonly (string | undefined)[] =>
  events.flatMap((e) =>
    e._tag === "AgentReturned" || e._tag === "ComposerReturned" ? [e.envelope] : [],
  )

describe("the text a turn wrote its output as", () => {
  it("is recorded byte for byte, fence markers and all", async () => {
    // What the pane depends on: a surface subtracts this string from the words it draws,
    // so anything but exactly what the agent wrote leaves JSON on screen — or leaves the
    // fence markers behind as an empty code block. Only a tier where the real extractor
    // runs over a real response can say the whole fence came back and not the object.
    const filed = reply.artifact("done")
    await runFlow([composer("work"), step(1, "work", filed)], (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        const store = yield* Store
        const wrote = wroteAs(yield* store.events(id))

        expect(wrote).toHaveLength(2)
        // The step's, exactly as the fake wrote it.
        expect(wrote[1]).toBe(filed)
        // And the composer's, whose body this test does not write: the shape is the claim.
        expect(wrote[0]?.startsWith("```json\n")).toBe(true)
        expect(wrote[0]?.endsWith("\n```")).toBe(true)
      }),
    )
  })
})

describe("declared artifact shapes", () => {
  it("a step with a declared shape returns sections, and they render as one document", async () => {
    await runFlow(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Add a --json flag", [{ agent: "design", instruction: "Design it." }]),
          "compose: an agent with more than one section",
        ),
        step(1, "design", reply.sectioned({ Summary: "add the flag", Steps: "| edit | ork.ts |" })),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")

          // The trak holds the sections; rendering is what a reader asks for.
          expect(parked.artifacts.get("1-design")?.sections).toEqual({
            Summary: "add the flag",
            Steps: "| edit | ork.ts |",
          })
          expect(artifactOf(parked, "1-design")).toBe(
            "## Summary\n\nadd the flag\n\n## Steps\n\n| edit | ork.ts |",
          )

          expectState(yield* act(id, 1, human.approve()), "Finished")
        }),
    )
  })

  it("re-prompts a step that omits a required section, without touching the log", async () => {
    await runFlowWithAgentLog(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Add a --json flag", [{ agent: "design", instruction: "Design it." }]),
          "compose: an agent with more than one section",
        ),
        step(1, "design", reply.sectioned({ Summary: "only this one" })),
        onResume(reply.sectioned({ Summary: "and now", Steps: "| both |" }), "corrected"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "x")
          expectAwaiting(parked, "approval")
          expect(parked.artifacts.get("1-design")?.sections).toHaveProperty("Steps")

          // The retry happened inside elicit: one AgentReturned, one iteration,
          // and the re-prompt named the section rather than restating the trak.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
          expect(slotAt(parked, 1).iterations).toBe(1)
          expect((yield* agentLog).requests.at(-1)?.prompt).toContain("Steps")
        }),
    )
  })
})
