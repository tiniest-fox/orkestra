// Flows where a human is in the loop: approval, revision, answering questions.

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
  artifactOf,
  sectionOf,
  approveAll,
  create,
  createAndStart,
  expectAwaiting,
  expectAwaitingProposal,
  expectReconsult,
  expectState,
  human,
  logTags,
} from "../support/scenario.js"
import { onPrompt, onResume, reply, type AgentLog } from "../support/scripted-agent.js"
import { artifactKey } from "../../src/workflow/domain/outputs/proposal.js"
import { slotAt, type Trak } from "../../src/workflow/domain/trak.js"

/** Hoisted: a `.map` inside a flow body is one callback past the limit. */
const artifactKeys = (trak: Trak): readonly string[] => trak.plan?.steps.map(artifactKey) ?? []

/** A two-step plan, at module scope so the re-compose turn stays one callback deep. */
const TWO_STEPS = [
  { agent: "plan", instruction: "Plan it." },
  { agent: "work", instruction: "Do it." },
] as const

/** Every prompt as one string. Keeps assertions out of a fifth nested callback. */
const allPrompts = (log: AgentLog): string => log.requests.map((r) => r.prompt).join("\n")

describe("approval gate", () => {
  it("parks after the artifact and advances only when approved", async () => {
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("Added --json")),
        step(2, "review", reply.artifact("no blockers")),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")
          expectState(parked, "AwaitingHuman", 1)

          // Approving runs the reviewer, whose own artifact parks in turn.
          const review = yield* act(id, 1, human.approve())
          expectAwaiting(review, "approval")

          expectState(yield* act(id, 2, human.approve()), "Finished")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed", // the plan
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 1's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all, which is what ends the trak
          ])
        }),
    )
  })

  it("sitting parked forever is correct — nothing polls the trak", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("v1"))], (id) =>
      Effect.gen(function* () {
        const parked = yield* createAndStart(id, "x")
        expectAwaiting(parked, "approval")
        // no timer, no reconciler: the log is unchanged until a human acts
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
        ])
      }),
    )
  })
})

describe("asking for a change", () => {
  it("re-runs the same step with what the human said, and gates the result too", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.artifact("v1 — too broad")),
        onResume(reply.artifact("v2 — narrower"), "step0 resumed"),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expect(sectionOf(parked, "1-work")).toBe("v1 — too broad")

          const retried = yield* act(id, 1, human.chat("narrower please"))
          expectAwaiting(retried, "approval")
          expect(sectionOf(retried, "1-work")).toBe("v2 — narrower")
          expect(slotAt(retried, 1).iterations).toBe(2)

          expectState(yield* act(id, 1, human.approve()), "Finished")
        }),
    )
  })

  it("resumes the SAME session on the retry, so the agent keeps its context", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.artifact("v1")),
        onResume(reply.artifact("v2"), "step0 resumed"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          yield* act(id, 1, human.chat("again"))

          const runs = stepRuns(yield* agentLog)
          expect(runs).toHaveLength(2)
          expect(runs[0]?.sessionId).toBe(runs[1]?.sessionId)
          expect(runs[0]?.resumeFrom).toBeUndefined()
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
    )
  })

  it("carries the feedback text into the resume prompt", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.artifact("v1")),
        onResume(reply.artifact("v2"), "step0 resumed"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          yield* act(id, 1, human.chat("please be narrower"))
          const log = yield* agentLog
          expect(log.requests.at(-1)?.prompt).toContain("please be narrower")
          // a resume prompt carries only the new context
          expect(log.requests.at(-1)?.prompt).not.toContain("Do the work.")
        }),
    )
  })
})

describe("asking for a different rest of the plan, with a document on the table", () => {
  it("keeps the work first, then runs the composer with what the person said", async () => {
    await runFlowWithAgentLog(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1 — the wrong shape")),
        afterReplan("work"),
        step(3, "work", reply.artifact("v2 — the other shape")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")

          const asking = yield* act(id, 1, human.replan("do it the other way"))
          expectAwaitingProposal(asking)
          expectReconsult(asking, "Replanned")
          // The commit lands before the composer runs, at the boundary a raised
          // requirement already uses — so the step's work is on the branch, and the
          // composer's checkout is clean.
          expect((yield* logTags(id)).slice(-4)).toEqual([
            "HumanActed",
            "WorkCommitted",
            "EffectsRan",
            "ComposerReturned",
          ])
          // `1-work` is kept, and the person's words are what the composer read.
          expect(sectionOf(asking, "1-work")).toBe("v1 — the wrong shape")
          const reconsult = composerRuns(yield* agentLog).at(-1)
          expect(reconsult?.prompt).toContain("do it the other way")

          const again = yield* act(id, 1, human.approve())
          expect(sectionOf(again, "3-work")).toBe("v2 — the other shape")
          expectState(yield* approveAll(id, again), "Finished")
        }),
    )
  })
})

describe("disagreeing with a reviewer", () => {
  it("overrules a review by talking to the reviewer, which then names the work", async () => {
    await runFlowWithAgentLog(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        step(2, "review", reply.artifact("no blockers")),
        // The human talks to the REVIEWER — it is what just spoke. Told it let
        // something through, it runs again, and the work it uncovers this time is
        // what puts the plan back in front of the composer. The engine never
        // interprets the disagreement.
        onPrompt(
          /I still want tests/,
          reply.raising("fair — no tests", ["write tests for the flag"]),
          "reconsiders",
        ),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          const review = yield* act(id, 1, human.approve())
          expectAwaiting(review, "approval")

          // The reviewer reconsiders and names the work — which parks like any
          // artifact, so the human who caused it reads it before anything is spent.
          const found = yield* act(id, 2, human.chat("I still want tests"))
          expectAwaiting(found, "approval")
          expect(slotAt(found, 1).iterations).toBe(1) // the work has not re-run
          expect(slotAt(found, 2).iterations).toBe(2) // the reviewer has
          expectReconsult(found, "Raised")

          // joined, not mapped: a callback here is one nesting level too deep
          expect(allPrompts(yield* agentLog)).toContain("I still want tests")
        }),
    )
  })

  it("agreeing is just approve — a review's gate advances like any other", async () => {
    await runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("v1")),
        step(2, "review", reply.artifact("no blockers")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          yield* act(id, 1, human.approve())
          expectState(yield* act(id, 2, human.approve()), "Finished")
          // three gates now: the plan, the artifact, and the review
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
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 1's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all, which is what ends the trak
          ])
        }),
    )
  })
})

describe("the plan gate", () => {
  it("nothing has run when a plan is waiting — approving is what starts it", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          const plan = yield* create(id, "Add a --json flag")
          expectAwaitingProposal(plan)
          expect(plan.plan?.steps).toHaveLength(2)
          // the composer ran; no step did
          expect(stepRuns(yield* agentLog)).toHaveLength(0)

          expectAwaiting(yield* act(id, 0, human.approve()), "approval")
          expect(stepRuns(yield* agentLog)).toHaveLength(1)
        }),
    )
  })

  it("saying something goes back to the COMPOSER, not into step 0", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        // The composer is who just spoke, so this is who the message reaches. It
        // answers with a new plan, which waits in turn.
        onPrompt(/too coarse/, reply.proposal("Add a --json flag", TWO_STEPS), "re-composed"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("the work")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          const replanned = yield* act(id, 0, human.chat("too coarse — split it"))

          expectAwaitingProposal(replanned)
          expect(artifactKeys(replanned)).toEqual(["0-compose", "1-plan", "2-work"])
          // Still nothing has run. Asserted on the prompts rather than with
          // stepRuns(), which counts a composer *resume* as a step — see flow.ts.
          expect(allPrompts(yield* agentLog)).not.toContain("artifact named")

          const runs = composerRuns(yield* agentLog)
          expect(runs).toHaveLength(2)
          expect(runs[0]?.sessionId).toBe(runs[1]?.sessionId)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
          // the message travels; the request does not repeat
          expect(runs[1]?.prompt).toContain("too coarse — split it")
          expect(runs[1]?.prompt).not.toContain("Available techniques")
        }),
    )
  })

  it("records the plan approval as one HumanActed, then runs the sequence", async () => {
    await runFlow(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("p")),
        step(2, "work", reply.artifact("s")),
      ],
      (id) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "x"))
          expectState(done, "Finished")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed", // the plan
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 1's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all, which is what ends the trak
          ])
        }),
    )
  })
})

describe("the agent asks a question", () => {
  it("parks for answers, then resumes the session with them", async () => {
    await runFlow(
      [
        composer("work"),
        step(1, "work", reply.questions("Which subcommands?")),
        onResume(reply.artifact("Added --json to list only"), "answered"),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "answers")

          // The answer resumes the step; its artifact then waits like any other.
          const answered = yield* act(id, 0, human.answer("just list"))
          expectAwaiting(answered, "approval")
          expect(artifactOf(answered, "1-work")).toContain("list only")

          expectState(yield* act(id, 1, human.approve()), "Finished")
        }),
    )
  })

  it("numbers the answers in the resume prompt", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.questions("Which?", "How many?")),
        onResume(reply.artifact("done"), "answered"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "x")
          yield* act(id, 1, human.answer("list", "three"))
          const prompt = (yield* agentLog).requests.at(-1)?.prompt ?? ""
          expect(prompt).toContain("1. list")
          expect(prompt).toContain("2. three")
        }),
    )
  })
})

describe("skipping a step", () => {
  const askThenNext = [
    composer("plan", "work"),
    step(1, "plan", reply.questions("Which subcommands?")),
    step(2, "work", reply.artifact("Added --json to list")),
  ]

  it("moves on without it, and files nothing under its name", async () => {
    await runFlow(askThenNext, (id) =>
      Effect.gen(function* () {
        const parked = yield* createAndStart(id, "Add a --json flag")
        expectAwaiting(parked, "answers")

        const skipped = yield* act(id, 1, human.skip("no need, it's a docs change"))

        // The next step ran, and the skipped one left nothing behind: no
        // artifact, no attempt, and nothing verified.
        expectAwaiting(skipped, "approval")
        expectState(skipped, "AwaitingHuman", 2)
        expect(artifactOf(skipped, "1-plan")).toBeUndefined()
        expect(slotAt(skipped, 1).iterations).toBe(1) // the turn that asked
        expect(slotAt(skipped, 1).skipNote).toBe("no need, it's a docs change")

        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "HumanActed", // the plan
          "ConditionsMet",
          "AgentReturned", // 0-plan asks
          "HumanActed", // skipped
          // No ChecksPassed for 0-plan: there is nothing to check.
          "WorkCommitted", // step 0's own work kept
          "EffectsRan", // and its effects run, of which this agent declares none
          "ConditionsMet",
          "AgentReturned", // 1-work
          "ChecksPassed",
        ])
      }),
    )
  })

  it("tells the next step it was skipped, and what the human said about it", async () => {
    await runFlowWithAgentLog(askThenNext, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Add a --json flag")
        yield* act(id, 1, human.skip("no need, it's a docs change"))

        // A step that files nothing is indistinguishable from one that has not run
        // yet unless the prompt says so — which is the one thing a later agent must
        // not conclude. And the message lands where an instruction lands.
        const prompt = stepRuns(yield* agentLog).at(-1)?.prompt ?? ""
        expect(prompt).toContain("- 1-plan  — skipped")
        expect(prompt).toContain("`1-plan` was skipped")
        expect(prompt).toContain("no need, it's a docs change")
      }),
    )
  })

  it("is a skip with nothing said when nothing was said", async () => {
    await runFlowWithAgentLog(askThenNext, (id, agentLog) =>
      Effect.gen(function* () {
        const trak = yield* createAndStart(id, "Add a --json flag")
        expectAwaiting(trak, "answers")
        const skipped = yield* act(id, 1, human.skip())

        // Recorded either way, and the two halves are why the slot carries a flag
        // beside the note: *was it skipped* stays true with nothing said.
        expect(slotAt(skipped, 1).skipped).toBe(true)
        expect(slotAt(skipped, 1).skipNote).toBeUndefined()

        const prompt = stepRuns(yield* agentLog).at(-1)?.prompt ?? ""
        expect(prompt).toContain("`1-plan` was skipped")
        expect(prompt).not.toContain("The person running this said")
      }),
    )
  })

  it("is refused where the step has already filed, rather than acting as a second approve", async () => {
    await runFlow(
      [composer("plan", "work"), step(1, "plan", reply.artifact("here is the plan"))],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")

          // There is a document on the table, so taking it is the thing to do.
          // Routing a skip forward here would make it `Approve` under another
          // name, and record a step as un-run that produced work.
          const refused = yield* act(id, 1, human.skip("actually never mind"))
          expectState(refused, "Failed")
          if (refused.state._tag === "Failed") {
            expect(refused.state.error).toContain("already filed")
          }
        }),
    )
  })
})

describe("the COMPOSER asks a question", () => {
  const askThenPropose = [
    onPrompt(
      /Compose a pipeline/,
      reply.askWithOptions("Is this a bugfix or a redesign?", "bugfix", "redesign"),
      "compose: asks",
    ),
    onResume(
      reply.proposal("Add a --json flag", [{ agent: "work", instruction: "do it" }]),
      "compose: proposes",
    ),
    step(1, "work", reply.artifact("done")),
  ]

  it("parks before any step exists, then composes with the answer", async () => {
    await runFlow(askThenPropose, (id) =>
      Effect.gen(function* () {
        const parked = yield* create(id, "Change how listing works")
        // Its own state, not an `answers` gate with a nominal step: answering
        // re-runs `Compose`, where answering a step resumes that step. That used
        // to be told apart by "is there a proposal yet", which stopped being true
        // the moment the composer could be re-consulted mid-flight.
        expectState(parked, "AwaitingComposerAnswers")
        expect(parked.plan).toBeUndefined()

        // The answer produces a plan, which waits like any other plan.
        const plan = yield* act(id, 0, human.answer("bugfix"))
        expect(plan.plan?.steps).toHaveLength(2)
        expectAwaitingProposal(plan)

        expectAwaiting(yield* act(id, 1, human.approve()), "approval")
        expectState(yield* act(id, 1, human.approve()), "Finished")
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned", // asked
          "HumanActed", // answered
          "ComposerReturned", // proposed
          "HumanActed", // plan approved
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

  it("resumes the composer's own session, so it still knows why it asked", async () => {
    await runFlowWithAgentLog(askThenPropose, (id, agentLog) =>
      Effect.gen(function* () {
        yield* create(id, "x")
        yield* act(id, 0, human.answer("bugfix"))

        const runs = composerRuns(yield* agentLog)
        expect(runs).toHaveLength(2)
        expect(runs[0]?.sessionId).toBe(runs[1]?.sessionId)
        expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        // the answer travels, the original request does not repeat
        expect(runs[1]?.prompt).toContain("1. bugfix")
        expect(runs[1]?.prompt).not.toContain("Available techniques")
      }),
    )
  })

  it("rejects a human action other than answers while still composing", async () => {
    await runFlow(askThenPropose, (id) =>
      Effect.gen(function* () {
        yield* create(id, "x")
        const after = yield* act(id, 0, human.approve())
        // Approve is meaningless with no proposal to approve — loud, not ignored
        expect(after.state._tag).toBe("Failed")
      }),
    )
  })
})
