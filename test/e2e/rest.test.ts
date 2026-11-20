// Coming to rest, and the three doors around it: a human declares a trak over, the
// world comes back to one that finished, and a plan that said it stopped short is
// asked again rather than resting at all.
//
// The theme is *what the record can later say*. A trak that rots leaves a hole in
// the corpus, and a trak abandoned without committing leaves a finding nobody can
// check — so both assertions here are about what survives, not about the state tag.
// The third door is the same bet: one piece of work stays one record, however many
// times the plan grows.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterStoppingShort,
  afterReentry,
  composer,
  composerStopping,
  runFlow,
  runFlowWithAgentLog,
  step,
} from "../support/flow.js"
import {
  act,
  create,
  createAndStart,
  expectAwaiting,
  expectState,
  human,
  logTags,
} from "../support/scenario.js"
import { type AgentLog, reply } from "../support/scripted-agent.js"
import { advance } from "../../src/workflow/runtime.js"
import { Events } from "../../src/workflow/domain/event.js"
import { stepName } from "../../src/workflow/domain/outputs/proposal.js"
import { record } from "../../src/workflow/domain/record.js"
import { Store } from "../../src/workflow/ports/store.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"

const abandon = (id: TrakId, why: string) => advance(id, Events.abandoned(why))
const reenter = (id: TrakId, what: string) => advance(id, Events.reentered(what))

/** How many times an event kind is in the log. Hoisted: a `.filter` in a flow body
 * is one callback past the limit. */
const countOf = (tags: readonly string[], tag: string): number =>
  tags.filter((t) => t === tag).length

/** Hoisted for the same reason: a `.map` inside a flow body is one callback too deep. */
const allPrompts = (log: AgentLog): string => log.requests.map((r) => r.prompt).join("\n")

const recordOf = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return record(id, yield* store.events(id))
  })

describe("abandonment", () => {
  it("keeps the work on the way out, so the attempts are still readable", async () => {
    await runFlow(
      [composer("work", "review"), step(1, "work", reply.artifact("first attempt at the parser"))],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")

          const done = yield* abandon(id, "did it by hand in the end")
          expectState(done, "Abandoned")

          // It commits on the way out, which is the whole design: the commit is
          // what leaves the attempt somewhere a person can go and look. The
          // checkout goes after it, because somebody said they were done — the
          // one thing a trak that merely ran out of plan does not do.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "Abandoned",
            "WorkCommitted",
            "WorktreeRemoved",
          ])
          expect(done.artifacts.has("1-work")).toBe(true)
        }),
    )
  })

  it("reads as its own outcome in the record, quoting the reason", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        yield* abandon(id, "tried three times, did it by hand")

        // Not a failure, and the record must not say it was: nothing broke, a
        // person decided, and the sentence they typed is the one thing here no
        // count could have produced.
        const r = yield* recordOf(id)
        expect(r.outcome).toBe("abandoned — tried three times, did it by hand")
      }),
    )
  })

  it("can be declared before a plan exists, which is where most of them die", async () => {
    await runFlow([composer("work")], (id) =>
      Effect.gen(function* () {
        const proposed = yield* create(id, "Add a --json flag")
        expectState(proposed, "AwaitingProposal")

        // The plan gate is where a trak is most likely to be given up on — the
        // idea did not survive contact with the plan — and nothing about that
        // should need a step to have run first.
        expectState(yield* abandon(id, "the plan showed this is two traks"), "Abandoned")
        // No step ever ran, and the trak is still worth having in the corpus: a
        // plan nobody accepted is a finding about the composer.
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "Abandoned",
          "WorkCommitted",
          "WorktreeRemoved",
        ])
      }),
    )
  })

  it("is refused once a trak has already come to rest", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        const started = yield* createAndStart(id, "Add a --json flag")
        expectState(yield* act(id, 0, human.approve()), "Finished")

        // An engine failure rather than a second terminal state, because there is
        // nothing to declare over. `ork archive` refuses before appending, so
        // this is the log a hand-written event would leave rather than one a CLI
        // can produce.
        const after = yield* abandon(id, "changed my mind")
        expectState(after, "Failed")
        expect(started.description).toBe("Add a --json flag")
      }),
    )
  })
})

describe("re-entry", () => {
  it("appends to the plan that ran, so one piece of work stays one record", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.artifact("the --json flag")),
        afterReentry("review"),
        step(3, "review", reply.artifact("the flaky assertion, made deterministic")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          expectState(yield* act(id, 1, human.approve()), "Finished")

          // The door. Nothing was watching for this; a person typed it.
          const back = yield* reenter(id, "CI failed on main: the auth test is flaky")
          expectState(back, "AwaitingProposal")

          const running = yield* act(id, 1, human.approve())
          // **Appended, not replaced.** Step 0 is untouched and its artifact is
          // still filed — a fresh plan starting at 0 would have overwritten the
          // record this whole phase exists to keep.
          expect(running.plan?.steps.map(stepName)).toEqual([
            "compose",
            "work",
            "compose",
            "review",
          ])
          // The appended step ran and parked at its own gate — position 1, which
          // is what says the plan was extended rather than restarted.
          expectState(running, "AwaitingHuman", 3)

          const done = yield* act(id, 3, human.approve())
          expectState(done, "Finished")
          expect([...done.artifacts.keys()]).toEqual(["1-work", "3-review"])
        }),
    )
  })

  it("hands the composer what came back, and the work already on the branch", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.artifact("the --json flag")),
        afterReentry("review"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.approve())
          yield* reenter(id, "CI failed on main: the auth test is flaky")

          // The composer cannot plan anything useful without the sentence, and it
          // must not re-propose finished work — so both have to be in the prompt.
          const asked = allPrompts(yield* agentLog)
          expect(asked).toContain("CI failed on main: the auth test is flaky")
          expect(asked).toContain("1-work")
        }),
    )
  })

  it("picks up an abandoned trak too, because both are at rest", async () => {
    await runFlow(
      [composer("work"), step(1, "work", reply.artifact("v1")), afterReentry("review")],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* abandon(id, "parked this for a fortnight")

          // Abandonment is a declaration, not a deletion: the reason someone gave
          // up can stop applying, and the branch is still there.
          const back = yield* reenter(id, "we need this after all")
          expectState(back, "AwaitingProposal")
          // The abandoned trak's plan was kept and extended, not discarded — the
          // splice happens when the proposal lands, so the gate shows the whole of
          // what will run.
          expect(back.plan?.steps.map(stepName)).toEqual(["compose", "work", "compose", "review"])
        }),
    )
  })

  it("is refused on a trak that has not come to rest", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        const parked = yield* createAndStart(id, "Add a --json flag")
        expectAwaiting(parked, "approval")

        // A gate is a person who owes an answer, and something arriving while they
        // are still deciding is a thing to tell them rather than to schedule.
        // `ork reenter` refuses before appending; this is what a hand-written event
        // would leave.
        const after = yield* reenter(id, "actually, more")
        expectState(after, "Failed")
        // And nothing was scheduled: no worktree was re-made, no composer ran.
        expect(yield* logTags(id)).toContain("Reentered")
        expect(countOf(yield* logTags(id), "WorktreeReady")).toBe(1)
      }),
    )
  })
})

describe("a plan that said where it ends", () => {
  const question = "one service or two — not decidable until the discovery lands"

  /** The composer stops short, is asked again, and the second plan finishes. */
  const stoppedShort = [
    composerStopping(question, "work"),
    step(1, "work", reply.artifact("what the flag needs")),
    afterStoppingShort("review"),
    step(3, "review", reply.artifact("read it, it holds")),
  ]

  it("asks the composer again instead of coming to rest", async () => {
    await runFlow(stoppedShort, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        // The same approval that would have finished this trak yesterday. The
        // work is kept first — the commit lands before anything is asked — and
        // the plan gate is what a person answers next.
        const asked = yield* act(id, 1, human.approve())
        expectState(asked, "AwaitingProposal")
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed", // the plan
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "HumanActed",
          "WorkCommitted", // step 0's work kept, before anything is asked
          "EffectsRan", // and its effects run, which is where the boundary ends
          "ComposerReturned",
        ])
        // Appended, exactly as a re-entry is: nothing that ran is dropped.
        expect(asked.plan?.steps.map(stepName)).toEqual(["compose", "work", "compose", "review"])

        const running = yield* act(id, 1, human.approve())
        expectState(running, "AwaitingHuman", 3)
        const done = yield* act(id, 3, human.approve())
        expectState(done, "Finished")
        expect([...done.artifacts.keys()]).toEqual(["1-work", "3-review"])
      }),
    )
  })

  it("asks once — the second plan proposed no compose of its own, so the trak ends", async () => {
    // The convergence guard. It used to rest on `revise` clearing a field an absent
    // question left behind; now the entry that asks again is one the composer has to
    // propose, so a plan that proposes none cannot ask.
    await runFlow(stoppedShort, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        yield* act(id, 1, human.approve())
        yield* act(id, 1, human.approve())
        const done = yield* act(id, 3, human.approve())
        expectState(done, "Finished")
        expect(done.plan?.steps.map(stepName)).toEqual(["compose", "work", "compose", "review"])
        expect(countOf(yield* logTags(id), "ComposerReturned")).toBe(2)
      }),
    )
  })

  it("hands the composer back its own question, and the work that has run", async () => {
    await runFlowWithAgentLog(stoppedShort, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        yield* act(id, 1, human.approve())

        const asked = allPrompts(yield* agentLog)
        expect(asked).toContain(question)
        expect(asked).toContain("You planned this turn yourself")
        // Nothing is owed rescuing: every step ran and filed, so the unblock
        // ladder stays out of it.
        expect(asked).not.toContain("Where a slot is still owed its work")
      }),
    )
  })

  it("leaves a plan with nothing left to ask exactly where it was", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("the --json flag"))], (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        const done = yield* act(id, 1, human.approve())
        expectState(done, "Finished")
        expect(countOf(yield* logTags(id), "ComposerReturned")).toBe(1)
      }),
    )
  })
})
