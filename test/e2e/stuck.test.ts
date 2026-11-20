// A step that could not do the work, and a person deciding what happens — end to
// end, through the real engine.
//
// `stuck` stops the trak. Nothing is scheduled off the back of it and no plan is
// made from it: what a person does next is theirs, and one of the things they may
// do is ask the composer for a different rest of the plan, in their own words.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterReplan,
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
import { workDeclaring } from "../support/library.js"
import { fail } from "../support/scripted-checks.js"
import { onPrompt, reply } from "../support/scripted-agent.js"
import type { SessionRequest } from "../../src/agent/types/session.js"
import { stepName } from "../../src/workflow/domain/outputs/proposal.js"
import { slotAt, type Trak } from "../../src/workflow/domain/trak.js"

/**
 * The plan as agent names, in order. Hoisted because a `.map` inside a test body
 * is one callback deeper than this repository allows — see `human-gates`.
 */
const agentsOf = (trak: Trak): readonly string[] => (trak.plan?.steps ?? []).map(stepName)

/** Every turn that asked for one step's artifact, oldest first. */
const runsFor = (runs: readonly SessionRequest[], key: string): readonly SessionRequest[] =>
  runs.filter((r) => r.prompt.includes(`artifact named \`${key}\``))

const VERIFY = new Map([
  [
    "verify",
    {
      name: "verify",
      description: "Runs the project's own verification.",
      timeoutSeconds: 60,
      askedEverySeconds: undefined,
      exclusive: false,
      cache: true,
      ignoresLinguistGenerated: false,
      units: undefined,
      cacheAcross: "platform" as const,
      path: "/repo/.orkestra/checks/verify.sh",
    },
  ],
])

describe("a stuck step stops, and nothing is planned from it", () => {
  it("parks at its own gate rather than routing anywhere on its own", async () => {
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        step(2, "review", reply.stuck("two passes over the diff")),
      ],
      (id) =>
        Effect.gen(function* () {
          expectAwaiting(yield* createAndStart(id, "x"), "approval")
          const gaveUp = yield* act(id, 1, human.approve())
          expectAwaiting(gaveUp, "stuck")
          // Nothing has been spent on it: no composer turn, no step re-run, and
          // nothing on the trak waiting for a plan. Reading it is the point of
          // stopping here.
          expect(gaveUp.reconsult).toBeUndefined()
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
            "AgentReturned",
          ])
        }),
    )
  })

  it("runs no checks, because the account is not an artifact and is filed nowhere", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.stuck("two different libraries"))],
      (id, _agentLog, checksLog) =>
        Effect.gen(function* () {
          const gaveUp = yield* createAndStart(id, "x")
          expectAwaiting(gaveUp, "stuck")
          expect((yield* checksLog).ran).toEqual([])
          // Filed like any other document: the account of why a step could not do
          // the work is the most useful thing it leaves behind, and who gets shown
          // it is a question for the read side.
          expect(gaveUp.artifacts.get("1-work")?.sections).toMatchObject({
            "What I tried": "two different libraries",
          })
        }),
      workDeclaring(["verify"], { checks: VERIFY }),
      { verify: [fail("should never run")] },
    )
  })

  it("is skipped past, leaving the hole its account describes and saying so", async () => {
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        step(2, "review", reply.stuck("reading the diff twice")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          const gaveUp = yield* act(id, 1, human.approve())
          expectAwaiting(gaveUp, "stuck")
          // The review is the last step, so moving on runs off the end of the
          // plan — and the work is still kept, which is what a trak is for.
          const done = yield* act(id, 2, human.skip("we will look ourselves"))
          expectState(done, "Finished")
          expect(done.artifacts.get("2-review")?.sections).toBeDefined()
          expect(slotAt(done, 2).skipNote).toBe("we will look ourselves")
        }),
    )
  })

  it("refuses an approval there, because there is nothing filed to take", async () => {
    await runFlow(
      [composer("work", "review"), step(1, "work", reply.stuck("everything I could think of"))],
      (id) =>
        Effect.gen(function* () {
          expectAwaiting(yield* createAndStart(id, "x"), "stuck")
          const refused = yield* act(id, 1, human.approve())
          expect(refused.state).toMatchObject({ _tag: "Failed", kind: "engine" })
        }),
    )
  })
})

/** Two steps planned, the second stuck, and a person saying what to do instead. */
const stuckThenReplanned = [
  composer("plan", "work", "review"),
  step(1, "plan", reply.artifact("the plan")),
  step(2, "work", reply.stuck("both approaches to the migration")),
  afterReplan("work", "review"),
  // The replacement work is a new entry at a new index, not a second go at `3-work`.
  step(4, "work", reply.artifact("done, the other way")),
  step(5, "review", reply.artifact("no blockers")),
]

describe("a person asking the composer for a different rest of the plan", () => {
  it("replaces the slot still owed its work, rather than planning from 0", async () => {
    await runFlow(stuckThenReplanned, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        const gaveUp = yield* act(id, 1, human.approve())
        expectAwaiting(gaveUp, "stuck")

        // What they say goes to the composer, whose plan waits at the plan gate
        // like any other: what is on the table is a sequence nobody has read yet.
        const replanned = yield* act(id, 2, human.replan("try a smaller piece first"))
        expectReconsult(replanned, "Replanned")
        expectAwaitingProposal(replanned)
        // The stuck `work` keeps its place — it happened — and the compose that
        // answered the replan is written down where it ran.
        // The stuck `work` keeps index 2 — it happened — and the compose that
        // answered the replan is written down where it ran, with the work it
        // proposed instead following at an index of its own.
        expect(agentsOf(replanned)).toEqual([
          "compose",
          "plan",
          "work",
          "compose",
          "work",
          "review",
        ])
        // and the trak is renamed: the turn that just re-cut the plan is the one
        // that knows what this work turned out to be.
        expect(replanned.plan?.title).toBe("the work, re-cut")

        // Approving it enters the join — the slot the stuck step left owed —
        // rather than starting the trak again.
        const running = yield* act(id, 1, human.approve())
        expectAwaiting(running, "approval")
        expect(sectionOf(running, "1-plan")).toBe("the plan") // kept, not re-run
        expect(sectionOf(running, "4-work")).toBe("done, the other way")
        expectState(yield* approveAll(id, running), "Finished")
      }),
    )
  })
})

describe("what the re-consulted composer is handed", () => {
  it("a fresh session, and the person's reason rather than the agent's account", async () => {
    await runFlowWithAgentLog(stuckThenReplanned, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        yield* act(id, 1, human.approve())
        yield* act(id, 2, human.replan("try a smaller piece first"))

        const runs = composerRuns(yield* agentLog)
        expect(runs).toHaveLength(2)
        // Fresh, not resumed: a resumed composer defends the plan it wrote, and
        // could never be handed the decisions filed since it wrote it.
        expect(runs[1]?.resumeFrom).toBeUndefined()
        expect(runs[1]?.sessionId).not.toBe(runs[0]?.sessionId)
        // It is told what happened, what is kept, and what it may not re-propose.
        expect(runs[1]?.prompt).toContain("Where this has got to")
        expect(runs[1]?.prompt).toContain("`1-plan` — `.orkestra/.trak/1-plan.md`")
        expect(runs[1]?.prompt).toContain("try a smaller piece first")
        // And NOT the account. An agent is usually stuck because it is wrong
        // about the cause, so what the person said having read it is what the
        // plan gets made against.
        expect(runs[1]?.prompt).not.toContain("both approaches to the migration")
      }),
    )
  })

  it("does not resume the session of the step the new plan replaced", async () => {
    // The failure this whole ladder exists to avoid: the agent hired to arrive
    // without five failed attempts inheriting the conversation that contains them.
    await runFlowWithAgentLog(stuckThenReplanned, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "x")
        yield* act(id, 1, human.approve())
        yield* act(id, 2, human.replan("try a smaller piece first"))
        yield* act(id, 1, human.approve())

        // **The replacement is a different entry, not a second attempt at the same
        // one.** The stuck `3-work` keeps its session and its account; the work the
        // composer proposed instead runs at `5-work`, so a fresh context falls out
        // of the shape rather than being forced by clearing a slot.
        expect(runsFor(stepRuns(yield* agentLog), "2-work")).toHaveLength(1)
        const [retry] = runsFor(stepRuns(yield* agentLog), "4-work")
        expect(retry?.resumeFrom).toBeUndefined()
        expect(retry?.sessionId).not.toBe(
          runsFor(stepRuns(yield* agentLog), "2-work")[0]?.sessionId,
        )
      }),
    )
  })

  it("is offered at an ordinary approval gate too, and joins after the filed step", async () => {
    // Nothing is on the table here: the step did its work, and a person simply
    // wants the rest of the plan to be something else.
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        afterReplan("review"),
        step(3, "review", reply.artifact("no blockers")),
      ],
      (id) =>
        Effect.gen(function* () {
          expectAwaiting(yield* createAndStart(id, "x"), "approval")
          const replanned = yield* act(id, 1, human.replan("review it instead of building"))
          expectReconsult(replanned, "Replanned")
          expect(agentsOf(replanned)).toEqual(["compose", "plan", "compose", "review"])
          expectState(yield* approveAll(id, replanned), "Finished")
        }),
    )
  })

  it("sends the composer's own questions back to the composer, not into a step", async () => {
    // A proposal exists by the time a replan happens, so "is there a proposal"
    // cannot tell a composer's question from a step's — this is the state that
    // answers it instead.
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.stuck("everything I could think of")),
        onPrompt(/A person stopped at/, reply.askWithOptions("own PR?", "yes", "no"), "asks"),
        onPrompt(
          /1\. yes/,
          reply.proposal("ignored", [{ agent: "work", instruction: "again" }]),
          "then plans",
        ),
        // A new entry after the compose that answered the questions, not a retry.
        step(3, "work", reply.artifact("done")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          const asked = yield* act(id, 1, human.replan("split it in two"))
          expectState(asked, "AwaitingComposerAnswers")

          const planned = yield* act(id, 1, human.answer("yes"))
          expectAwaitingProposal(planned)
          expect(agentsOf(planned)).toEqual(["compose", "work", "compose", "work"])
          expectState(yield* approveAll(id, planned), "Finished")
        }),
    )
  })
})
