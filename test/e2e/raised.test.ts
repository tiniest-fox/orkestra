// A step that did its work and sent the plan back with it — end to end, through the
// real engine.
//
// The plan grows the ordinary way: the step files an artifact like any other, a
// person approves it, the work is kept, and *then* the composer is asked what the
// rest of the plan should be. Nobody judges whether the remaining plan survives —
// the composer owns the plan, and a requirement is by definition something it has
// not planned against.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterRaised,
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
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectReconsult,
  expectState,
  human,
  logTags,
  sectionOf,
} from "../support/scenario.js"
import { onPrompt, reply } from "../support/scripted-agent.js"
import { stepName } from "../../src/workflow/domain/outputs/proposal.js"
import type { Trak } from "../../src/workflow/domain/trak.js"

/** The plan as agent names, in order. Hoisted — see `stuck`. */
const agentsOf = (trak: Trak): readonly string[] => (trak.plan?.steps ?? []).map(stepName)

/** A step that files its work and names one thing the plan does not cover. */
const foundThenPlanned = [
  composer("plan", "work"),
  step(1, "plan", reply.raising("the plan", ["the footer wants designing first"])),
  afterRaised("design", "work"),
  step(3, "design", reply.sectioned({ Summary: "here it is", Steps: "1. draw it" })),
  step(4, "work", reply.artifact("built against the design")),
]

describe("a raised requirement grows the plan, after the gate the artifact hit anyway", () => {
  it("gates like any other artifact, and buys nothing until a person approves", async () => {
    await runFlow(foundThenPlanned, (id) =>
      Effect.gen(function* () {
        const found = yield* createAndStart(id, "x")
        // An ordinary approval gate: what is on the table is the step's work,
        // and nothing an agent writes moves a trak on its own.
        expectAwaiting(found, "approval")
        expectReconsult(found, "Raised")
        // The turn that is now owed is in the plan, so a person at this gate can see
        // what approving buys. It is `todo` like any other entry ahead of the trak,
        // and it goes again if they argue the units away instead.
        expect(agentsOf(found)).toEqual(["compose", "plan", "compose", "work"])
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

  it("keeps the work first, then asks — the plan gate is what a person answers", async () => {
    await runFlow(foundThenPlanned, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        const replanned = yield* act(id, 1, human.approve())
        expectAwaitingProposal(replanned)
        // The commit lands at the step boundary exactly as it does everywhere
        // else, and the compose follows it rather than replacing it.
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "HumanActed",
          "WorkCommitted", // step 0's own work kept, before anything is asked
          "EffectsRan", // and its effects run, which is where the boundary ends
          "ComposerReturned",
        ])
        // The join is the unrun tail: everything that ran is kept, and the plan
        // the composer hands back replaces only what had not started.
        expect(agentsOf(replanned)).toEqual(["compose", "plan", "compose", "design", "work"])
        expect(sectionOf(replanned, "1-plan")).toBe("the plan")
        expectState(yield* approveAll(id, replanned), "Finished")
      }),
    )
  })

  it("tells the composer what was raised AND the tail it may hand back unchanged", async () => {
    await runFlowWithAgentLog(foundThenPlanned, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        yield* act(id, 1, human.approve())

        const runs = composerRuns(yield* agentLog)
        expect(runs).toHaveLength(2)
        // Fresh, not resumed — the same rule every re-consultation follows.
        expect(runs[1]?.resumeFrom).toBeUndefined()
        expect(runs[1]?.sessionId).not.toBe(runs[0]?.sessionId)
        expect(runs[1]?.prompt).toContain("the footer wants designing first")
        // The tail with its instruction. Without it the cheapest answer — the
        // plan unchanged plus one entry — cannot be written down at all.
        //
        // `3` rather than `2`: the ask stands in the plan at the join while this turn
        // runs, so the tail behind it is where it will be once the turn lands.
        expect(runs[1]?.prompt).toContain("`3-work` — ")
        expect(runs[1]?.prompt).toContain("Nothing here says that work")
      }),
    )
  })
})

describe("what an artifact that raises something does not buy", () => {
  it("nothing at all, when it is sent back instead of approved", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.raising("the plan", ["the footer wants designing first"])),
        onPrompt(/we already have a design/, reply.artifact("fair — the plan"), "second thoughts"),
        step(2, "work", reply.artifact("built")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          // Ordering is the whole of this: the route is after the approval gate,
          // so an artifact a person argues with never reaches the composer.
          const rewritten = yield* act(id, 1, human.chat("we already have a design"))
          expectAwaiting(rewritten, "approval")
          expect(rewritten.reconsult).toBeUndefined()
          // Including the entry it was standing in: the question was withdrawn, so
          // the plan is the one it was before anything asked.
          expect(agentsOf(rewritten)).toEqual(["compose", "plan", "work"])
          expectState(yield* approveAll(id, rewritten), "Finished")
          expect(composerRunsIn(yield* logTags(id))).toBe(1)
        }),
    )
  })

  it("composes once, not again at the next step's commit", async () => {
    // Unguarded this is an infinite loop: the field survives until the plan
    // answering it begins, so the NEXT commit boundary would compose again — and
    // each splice drops what the position holds.
    await runFlow(foundThenPlanned, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        const replanned = yield* act(id, 1, human.approve())
        const done = yield* approveAll(id, replanned)
        expectState(done, "Finished")
        expect(composerRunsIn(yield* logTags(id))).toBe(2)
      }),
    )
  })

  it("composes from the last step too, where the plan would have run out", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.raising("done", ["we should also update the README"])),
        afterRaised("work"),
        step(3, "work", reply.artifact("README updated")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          const appended = yield* act(id, 1, human.approve())
          expectAwaitingProposal(appended)
          expect(agentsOf(appended)).toEqual(["compose", "work", "compose", "work"])
          expectState(yield* approveAll(id, appended), "Finished")
        }),
    )
  })
})

/**
 * A review that sends work back by name, and the fix the composer plans for it — put
 * into the conversation that produced the document it is against.
 */
const correctedThenFixed = [
  composer("work", "review"),
  step(1, "work", reply.artifact("built it")),
  step(
    2,
    "review",
    reply.correcting("sent back", "1-work", "§Verification claims a check that never ran"),
  ),
  afterRaised({ agent: "work", instruction: "Say what actually ran.", continues: "1-work" }),
  step(4, "work", reply.artifact("§Verification now quotes the run")),
]

describe("a correction against a named document", () => {
  it("carries on rather than stopping, and reaches the composer with the name on it", async () => {
    await runFlowWithAgentLog(correctedThenFixed, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        yield* act(id, 1, human.approve())
        // An ordinary approval gate. `stuck` is the envelope that stops a trak; this
        // one filed its work, so the plan grows instead.
        const sentBack = yield* act(id, 2, human.approve())
        expectAwaitingProposal(sentBack)

        const asked = composerRuns(yield* agentLog).at(-1)?.prompt ?? ""
        expect(asked).toContain("not good enough to work from")
        expect(asked).toContain("`1-work` — §Verification claims a check that never ran")
      }),
    )
  })

  it("puts the step that answers it back into the conversation that produced it", async () => {
    await runFlowWithAgentLog(correctedThenFixed, (id, agentLog) =>
      Effect.gen(function* () {
        const filed = yield* createAndStart(id, "x")
        expectState(yield* approveAll(id, filed), "Finished")

        const runs = stepRuns(yield* agentLog)
        const built = runs.at(0)
        const fixed = runs.at(-1)
        // The same session, resumed — so the turn arrives holding the code it wrote
        // rather than paying to rebuild what the complaint is about.
        expect(fixed?.resumeFrom).toBe(built?.sessionId)
        expect(fixed?.sessionId).toBe(built?.sessionId)
        // And it is a new position all the same: nothing that ran is re-entered.
        expect(fixed?.prompt).toContain("artifact named `4-work`")
      }),
    )
  })

  it("starts fresh when the name matches no entry, which is all a wrong key costs", async () => {
    await runFlowWithAgentLog(
      [
        ...correctedThenFixed.slice(0, 3),
        afterRaised({ agent: "work", instruction: "Fix it.", continues: "7-nobody" }),
        step(4, "work", reply.artifact("fixed anyway")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "x")
          expectState(yield* approveAll(id, filed), "Finished")

          const runs = stepRuns(yield* agentLog)
          expect(runs.at(-1)?.resumeFrom).toBeUndefined()
          expect(runs.at(-1)?.sessionId).not.toBe(runs.at(0)?.sessionId)
        }),
    )
  })
})

/** How many composer turns a log records. */
const composerRunsIn = (tags: readonly string[]): number =>
  tags.filter((t) => t === "ComposerReturned").length
