// A trak whose person said in advance how much of it they wanted to stand at.
//
// The theme is *what it still stops for*. Running unattended is the easy half — the
// judgement is in the gates the mode deliberately does not reach, and in the fact that
// nothing invents a `HumanActed` to say a person took the press.

import { Deferred, Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterRaised,
  child,
  childStep,
  composer,
  composerAsks,
  composerResumes,
  composerUnsure,
  runFlow,
  runFlowWithAgentLog,
  spawn,
  step,
} from "../support/flow.js"
import {
  act,
  approveAll,
  artifactOf,
  create,
  expectAwaiting,
  expectState,
  human,
  idle,
  logged,
  logTags,
} from "../support/scenario.js"
import { workDeclaring } from "../support/library.js"
import { fail, pass } from "../support/scripted-checks.js"
import { onPromptAfter, onResume, reply } from "../support/scripted-agent.js"
import { Drives } from "../../src/app/drive.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { advance } from "../../src/workflow/runtime.js"
import { worktreeOf, writeWork } from "../support/git.js"
import type { SessionRequest } from "../../src/agent/types/session.js"
import type { AgentLog } from "../support/scripted-agent.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { slotAt, type Trak, type TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { driveChild, landOnParent } from "../../src/workflow/runtime.js"

/** The sessions each step turn ran on, hoisted for `resumedTurns`'s reason. */
const sessionsOf = (log: AgentLog): readonly string[] =>
  log.requests.map((r) => r.resumeFrom ?? r.sessionId)

/** Did the log reach the step's turn? Hoisted for the same reason. */
const hasComposed = (tags: readonly string[]): boolean => tags.includes("ComposerReturned")
const marksOf = (t: Trak): readonly (readonly [number, string])[] =>
  [...t.marks].map(([at, m]) => [at, m._tag])

/** The tag of every mark on the trak, hoisted for `resumedTurns`'s reason. */
const marksTagged = (t: Trak): readonly string[] => marksOf(t).map(([, tag]) => tag)

/** The entries a hold held until they were accepted, and none of the rule's own marks. */
const heldAt = (t: Trak): readonly number[] =>
  [...t.marks].flatMap(([at, m]) => (m._tag === "Held" ? [at] : []))

/** The event a forked drive is born from, hoisted: one callback deeper is one too many. */
const bornAuto = (description: string) => (): Event =>
  Events.trakCreated(description, undefined, "auto")

/**
 * The turns that picked a conversation back up. Hoisted because a `.filter` inside a
 * test body is one callback deeper than this repository allows.
 */
const resumedTurns = (log: AgentLog): readonly SessionRequest[] =>
  log.requests.filter((r) => r.resumeFrom !== undefined)

/** How many gates a person answered. Hoisted for the reason `resumedTurns` is. */
const pressesIn = (tags: readonly string[]): number => tags.filter((t) => t === "HumanActed").length

/** The trak as it stands now, without acting on it. */
const current = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return replayHistory(id, yield* store.events(id))
  })

/**
 * A spawn of one piece that only writes a document, and a step after it. What the
 * flows about a piece ending itself run: nothing a scripted agent does touches the
 * branch, so the piece's branch never moves.
 */
const onePiece = [
  composer("work", spawn(child("review", "security")), "plan"),
  step(1, "work", reply.artifact("the change")),
  childStep("review", "security", reply.artifact("no injection")),
  step(3, "plan", reply.artifact("addressed")),
]

/** The one check a flow here declares, for the step that fails it once and then fixes it. */
const CHECKS = new Map([
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

/**
 * The step's answer to a check failure — matched on the resume, because a retry prompt
 * carries only what is new and never names the artifact again.
 */
const retry = (content: string) => onResume(reply.artifact(content), "retry")

describe("a trak nobody is standing at", () => {
  it("plans it, runs it and keeps the work, with nobody asked anything", () =>
    runFlow([composer("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.gen(function* () {
        const done = yield* create(id, "Add a --json flag", "auto")
        expectState(done, "Finished")
        // **No `HumanActed` anywhere**, which is the whole assertion: the presses were
        // not taken on somebody's behalf and recorded as theirs, they were not needed.
        // What says why is the mode on the first line.
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "WorkCommitted", // step 0's own work kept
          "EffectsRan", // and its effects run, of which this agent declares none
          "WorkCommitted", // Integrating's catch-all, which is what ends the trak
        ])
      }),
    ))

  it("hands each piece of a spawn the mode its parent is running under", () =>
    runFlow(
      [
        composer("work", spawn(child("review", "security")), "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        step(3, "plan", reply.artifact("addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Rate-limit the public API", "auto")
          expect(parked.state).toEqual({ _tag: "AwaitingChildren", step: 2 })
          expect(slotAt(parked, 2).children).toHaveLength(1)
          // A piece that dropped back to `manual` would park at every position of every
          // spawn, on a trak whose person said they would stand at none of them.
          const started = yield* driveChild(parked, 2, 0)
          expect(started.mode).toBe("auto")
        }),
    ))

  it("ends a piece itself once its plan runs out, and the parent goes on from the landing", () =>
    runFlow(onePiece, (id) =>
      Effect.gen(function* () {
        const parked = yield* create(id, "Rate-limit the public API", "auto")
        const piece = yield* driveChild(parked, 2, 0)

        // Nothing on its branch, so the archive — and no event records a press. The
        // ending is the catch-all commit running straight into the teardown.
        expectState(piece, "Closed")
        expect(yield* logTags(piece.id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "WorkCommitted",
          "EffectsRan",
          "WorkCommitted", // Integrating's catch-all, with no sha
          "WorktreeRemoved",
        ])

        // What the daemon does next for every child that came to rest: the landing
        // is the same one a person's press makes, so the parent runs out as well.
        yield* landOnParent(piece)
        const done = yield* current(id)
        expectState(done, "Finished")
        expect(artifactOf(done, "2.0-review/0-review")).toContain("no injection")
        expect(pressesIn(yield* logTags(id))).toBe(0)
      }),
    ))
})

describe("questions on a trak nobody is standing at", () => {
  it("answers a step's questions itself, on the step's own session", () =>
    runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.questions("which flag name?")),
        onResume(reply.artifact("Added --json")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const done = yield* create(id, "Add a --json flag", "auto")
          expectState(done, "Finished")
          // Two turns at the step and no `HumanActed` between them: the question was
          // answered by saying nobody is coming, not by anybody answering it.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "ConditionsMet",
            "AgentReturned", // the questions
            "AgentReturned", // the artifact, after being told to decide for itself
            "ChecksPassed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "WorkCommitted", // Integrating's catch-all
          ])
          // Resumed, not restarted: the questions are in that conversation, and the
          // body carries only what is new.
          const resumed = resumedTurns(yield* agentLog)
          expect(resumed).toHaveLength(1)
          expect(resumed[0]?.prompt).toContain("Nobody is standing at this trak")
        }),
    ))

  it("stops asking on its own behalf once a position has spent its turns", () =>
    runFlow(
      [
        composer("work"),
        step(1, "work", reply.questions("which flag name?")),
        // Two, because a scripted turn answers once: the step is told to decide for
        // itself twice, and asks again both times.
        onResume(reply.questions("really, which flag name?"), "asks again"),
        onResume(reply.questions("no, really"), "asks a third time"),
      ],
      (id) =>
        Effect.gen(function* () {
          // Told twice and asking a third time, the step has not been helped by being
          // told — so the round nobody would have bought is the one that parks.
          const parked = yield* create(id, "Add a --json flag", "auto")
          expectAwaiting(parked, "answers")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "ConditionsMet",
            "AgentReturned",
            "AgentReturned",
            "AgentReturned",
          ])
        }),
    ))

  it("answers the composer's questions too, so it never stops before it has a plan", () =>
    runFlowWithAgentLog(
      [
        composerAsks("own PR or not?"),
        composerResumes("work"),
        step(1, "work", reply.artifact("Added --json")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const done = yield* create(id, "Add a --json flag", "auto")
          expectState(done, "Finished")
          // Two composer turns, the second on the first's session, and no gate
          // between them.
          expect((yield* logTags(id)).slice(0, 4)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned", // the questions
            "ComposerReturned", // the plan, after being told to decide for itself
          ])
          const resumed = resumedTurns(yield* agentLog)
          expect(resumed).toHaveLength(1)
          expect(resumed[0]?.prompt).toContain("Nobody is standing at this trak")
        }),
    ))
})

/**
 * The round a `smart` trak buys, end to end: `1-work` is built, `2-review` sends it
 * back by name, and the fix the composer plans for it is applied and committed with
 * nobody asked anything at any point.
 */
const sentBackThenFixed = [
  composer("work", "review"),
  step(1, "work", reply.artifact("built it")),
  step(2, "review", reply.correcting("sent back", "1-work", "§Verification claims a check")),
  afterRaised(
    { agent: "work", instruction: "Say what actually ran.", continues: "1-work" },
    "review",
  ),
  step(4, "work", reply.artifact("§Verification now quotes the run")),
  step(5, "review", reply.artifact("it holds up")),
]

describe("a smart trak where nothing goes wrong", () => {
  it("plans it, runs it and keeps the work, with nobody asked anything", () =>
    runFlow([composer("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.gen(function* () {
        const done = yield* create(id, "Add a --json flag", "smart")
        expectState(done, "Finished")
        // **No `HumanActed` anywhere**, which is the whole of what changed: the plan
        // went past because the composer reported nothing and asked nothing, and the
        // step went past because it filed in one turn and reported the same.
        expect(pressesIn(yield* logTags(id))).toBe(0)
      }),
    ))

  it("stops at the step that says it met a fork, and takes the plan gate before it", () =>
    runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.artifact("Added --json", "some")),
        step(2, "review", reply.artifact("it holds up")),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Add a --json flag", "smart")
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
          // The plan was never read, so the one press this trak costs is the document
          // whose own turn asked for it.
          expect(pressesIn(yield* logTags(id))).toBe(0)
          // Approving it runs the rest: the review reported nothing and raised
          // nothing, so the trak finishes on the one press.
          const done = yield* act(id, 1, human.approve())
          expectState(done, "Finished")
          expect(pressesIn(yield* logTags(id))).toBe(1)
        }),
    ))

  it("stops at the step that says it met several", () =>
    runFlow([composer("work"), step(1, "work", reply.artifact("Added --json", "a_lot"))], (id) =>
      Effect.gen(function* () {
        const parked = yield* create(id, "Add a --json flag", "smart")
        expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
      }),
    ))

  it("stops before anything is built where the composer says the plan was ambiguous", () =>
    runFlow([composerUnsure("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.gen(function* () {
        const parked = yield* create(id, "Add a --json flag", "smart")
        expect(parked.state).toEqual({ _tag: "AwaitingProposal" })
      }),
    ))
})

describe("a smart trak's pieces", () => {
  it("ends a piece that only wrote documents, and holds one that committed", () =>
    runFlow(
      [
        composer("work", spawn(child("review", "security"), child("review", "the client")), "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        // Parks at its own gate for reporting a fork, which is the moment the test
        // puts a file on its branch — a scripted agent writes nothing itself.
        childStep("review", "the client", reply.artifact("one N+1", "some")),
        step(3, "plan", reply.artifact("addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Rate-limit the public API", "smart")

          // A piece with nothing on its branch has nothing for a person to look at
          // before it goes, so it goes.
          expectState(yield* driveChild(parked, 2, 0), "Closed")

          const stopped = yield* driveChild(parked, 2, 1)
          expectAwaiting(stopped, "approval")
          writeWork(worktreeOf(stopped), "client.ts", "export const client = true\n")
          // A piece holding code is what the mode stands at: finished, checkout kept,
          // the press still a person's.
          expect((yield* act(stopped.id, 0, human.approve())).state).toEqual({ _tag: "Finished" })
        }),
    ))
})

describe("what a smart trak still stops for", () => {
  it("a step that asked a question, once the person has answered it", () =>
    runFlow(
      [
        composer("work"),
        step(1, "work", reply.questions("which flag name?")),
        onResume(reply.artifact("Added --json")),
      ],
      (id) =>
        Effect.gen(function* () {
          const asking = yield* create(id, "Add a --json flag", "smart")
          expectAwaiting(asking, "answers")
          const filed = yield* act(id, 1, human.answer("--json"))
          // Two turns at the position: the person is already in this document, and
          // reading what came back is the cheap end of that.
          expect(filed.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
        }),
    ))

  it("a step whose check failed once and then passed", () =>
    runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("Added --json")), retry("now with tests")],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Add a --json flag", "smart")
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
          // Nobody was asked about the failure — the step fixed it — and the document
          // that came back is still one a person reads.
          expect(pressesIn(yield* logTags(id))).toBe(0)
        }),
      workDeclaring(["verify"], { checks: CHECKS }),
      { verify: [fail("2 errors"), pass] },
    ))

  it("a step planned as a conversation, even filing on its first turn", () =>
    runFlow(
      [
        composer({ agent: "plan", conversational: true }),
        step(1, "plan", reply.artifact("Scope. Here is the shape")),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Add a --json flag", "smart")
          // The entry said a person would be in the room for this, and a step that
          // turned out to have enough to go on has not changed what was planned.
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
        }),
    ))

  it("a step that raised work nobody planned", () =>
    runFlow(
      [
        composer("work"),
        step(1, "work", reply.raising("Added --json", ["the offline case still needs building"])),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Add a --json flag", "smart")
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
        }),
    ))

  // A step that only sent another document back is not one of these: it names work the
  // plan already has a step for, so it runs through. The round below asserts that end
  // to end, and the row above is the half of the same envelope that does stop.
})

describe("a fix a review asked for, on a trak set to smart", () => {
  it("is planned, applied and kept between two verdicts, with nobody asked", () =>
    runFlow(sentBackThenFixed, (id) =>
      Effect.gen(function* () {
        // **Not one press.** The verdict raised no work the plan does not have — it
        // named a document the plan already has a step for — so its own gate goes
        // past with the re-cut, the fix and the second verdict behind it.
        const done = yield* create(id, "Add a --json flag", "smart")
        expectState(done, "Finished")
        expect(yield* logTags(id)).toEqual([
          "TrakCreated",
          "WorktreeReady",
          "ComposerReturned",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "WorkCommitted", // 1-work, kept without anybody taking it
          "EffectsRan",
          "ConditionsMet",
          "AgentReturned",
          "ChecksPassed",
          "WorkCommitted", // 2-review's verdict, kept the same way
          "EffectsRan",
          "ComposerReturned", // the re-cut, unread
          "ConditionsMet",
          "AgentReturned", // the fix
          "ChecksPassed",
          "WorkCommitted",
          "EffectsRan",
          "ConditionsMet",
          "AgentReturned", // the review of the fix
          "ChecksPassed",
          "WorkCommitted",
          "EffectsRan",
          "WorkCommitted", // Integrating's catch-all, which ends the trak
        ])
      }),
    ))

  it("costs six presses on manual, which is what the mode is buying", () =>
    runFlow(sentBackThenFixed, (id) =>
      Effect.gen(function* () {
        const created = yield* create(id, "Add a --json flag", "manual")
        const done = yield* approveAll(id, created)
        expectState(done, "Finished")
        expect(pressesIn(yield* logTags(id))).toBe(6)
      }),
    ))
})

describe("a conversation on a trak nobody is standing at", () => {
  it("tells a step that ended on a conversational note to carry on, and stops at what it files", () =>
    runFlowWithAgentLog(
      [
        composer({ agent: "plan", conversational: true }),
        step(1, "plan", reply.prose("What are we optimising for — speed or scope?")),
        onResume(reply.artifact("Scope. Here is the shape")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          // Planned as a conversation, so its document waits for a person even on `auto`.
          const parked = yield* create(id, "Add a --json flag", "auto")
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "ConditionsMet",
            "AgentReturned", // the prose
            "AgentReturned", // the artifact, after being told nobody is reading
            "ChecksPassed",
          ])
          const resumed = resumedTurns(yield* agentLog)
          expect(resumed).toHaveLength(1)
          expect(resumed[0]?.prompt).toContain("Continue with your work")
        }),
    ))
})

describe("a decider trak, which takes every document and leaves every call to the person", () => {
  it("plans it, runs it and keeps the work, each gate marked as the mode's", () =>
    runFlow(
      [
        composer("work", "review"),
        step(1, "work", reply.raising("Added --json", ["the offline case still needs building"])),
        afterRaised({ agent: "work", instruction: "Build the offline case." }, "review"),
        step(3, "work", reply.artifact("offline case built", "a_lot")),
        step(4, "review", reply.artifact("it holds up")),
      ],
      (id) =>
        Effect.gen(function* () {
          // A step that raised work, the re-cut it bought and a step reporting several
          // forks all stop `smart`; none of them is a question or a conversation.
          const done = yield* create(id, "Add a --json flag", "decider")
          expectState(done, "Finished")
          expect(pressesIn(yield* logTags(id))).toBe(0)
          expect(new Set(marksTagged(done))).toEqual(new Set(["Mode"]))
        }),
    ))

  it("stops at a step's questions, and takes the document filed after the answer", () =>
    runFlow(
      [
        composer("work"),
        step(1, "work", reply.questions("which flag name?")),
        onResume(reply.artifact("Added --json")),
      ],
      (id) =>
        Effect.gen(function* () {
          const asking = yield* create(id, "Add a --json flag", "decider")
          expectAwaiting(asking, "answers")
          const done = yield* act(id, 1, human.answer("--json"))
          expectState(done, "Finished")
          expect(pressesIn(yield* logTags(id))).toBe(1)
        }),
    ))

  it("stops at the composer's questions, and takes the plan filed after the answer", () =>
    runFlow(
      [
        composerAsks("own PR or not?"),
        composerResumes("work"),
        step(1, "work", reply.artifact("Added --json")),
      ],
      (id) =>
        Effect.gen(function* () {
          const asking = yield* create(id, "Add a --json flag", "decider")
          expectState(asking, "AwaitingComposerAnswers")
          const done = yield* act(id, 0, human.answer("own PR"))
          expectState(done, "Finished")
          expect(pressesIn(yield* logTags(id))).toBe(1)
        }),
    ))

  it("stops at a conversation rather than telling the step to file", () =>
    runFlow(
      [
        composer({ agent: "plan", conversational: true }),
        step(1, "plan", reply.prose("What are we optimising for — speed or scope?")),
      ],
      (id) =>
        Effect.gen(function* () {
          const talking = yield* create(id, "Add a --json flag", "decider")
          expect(talking.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "conversation" })
        }),
    ))

  it("stops at a step planned as a conversation that files on its first turn", () =>
    runFlow(
      [
        composer({ agent: "plan", conversational: true }),
        step(1, "plan", reply.artifact("Scope. Here is the shape")),
      ],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Add a --json flag", "decider")
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
        }),
    ))

  it("stops at a step that gave up", () =>
    runFlow([composer("work"), step(1, "work", reply.stuck("two different libraries"))], (id) =>
      Effect.gen(function* () {
        const parked = yield* create(id, "Add a --json flag", "decider")
        expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "stuck" })
      }),
    ))

  it("stops at a check that keeps failing", () =>
    runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("Added --json")), retry("still broken")],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* create(id, "Add a --json flag", "decider")
          expect(parked.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "checks" })
        }),
      workDeclaring(["verify"], { checks: CHECKS }),
      { verify: [fail("2 errors"), fail("2 errors")] },
    ))

  it("ends a piece itself once its plan runs out, as auto does", () =>
    runFlow(onePiece, (id) =>
      Effect.gen(function* () {
        const parent = yield* create(id, "Rate-limit the public API", "decider")
        expect((yield* driveChild(parent, 2, 0)).state._tag).toBe("Closed")
      }),
    ))
})

describe("changing how a trak is run, part-way through", () => {
  it("is picked up at the next gate, and the turn in flight finishes on its own session", async () => {
    // The turn is genuinely running when the mode changes: `onPromptAfter` holds the
    // step's answer until the test releases it, so the change lands mid-turn rather
    // than between two. What has to hold is that nothing is killed — the step files on
    // the session it already had, and it is the gate *after* it that stands.
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        composer("work", "review"),
        onPromptAfter(
          /artifact named `1-work`/,
          Deferred.await(release),
          reply.artifact("Added --json"),
        ),
        step(2, "review", reply.artifact("holds up")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const drives = yield* Drives
          yield* drives.start(id, bornAuto("Add a --json flag"))
          yield* logged(id, hasComposed)

          const changed = yield* advance(id, Events.modeChanged("manual"))
          expect([changed.mode, changed.state]).toStrictEqual([
            "manual",
            { _tag: "AgentWorking", step: 1 },
          ])

          yield* Deferred.succeed(release, undefined)
          yield* idle(id)
          const parked = yield* current(id)
          // Parked at the gate `auto` would have taken, with no `Stopped` anywhere and
          // the turn's own ending on the log after the change.
          expect(parked.state).toStrictEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
          expect(yield* logTags(id)).toStrictEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "ConditionsMet",
            "ModeChanged",
            "AgentReturned",
            "ChecksPassed",
          ])
          // One turn at the step, on the session minted for it: nothing resumed and
          // nothing restarted.
          const log = yield* agentLog
          expect(sessionsOf(log)).toHaveLength(2)
          expect(resumedTurns(log)).toHaveLength(0)
          // The plan gate went past on the mode's account and still says so; the
          // step's gate did not, and says nothing.
          expect([...parked.marks.keys()]).toStrictEqual([0])
        }),
    )
  })

  it("holds the step it was pressed at, and lets the ones after it go past", () =>
    runFlow(
      [
        composer("work", "review", "plan"),
        step(1, "work", reply.artifact("Added --json", "some")),
        step(2, "review", reply.artifact("holds up")),
        step(3, "plan", reply.artifact("nothing further")),
      ],
      (id) =>
        Effect.gen(function* () {
          // Stopped by the rung it reported, which is where the person presses Hold.
          const parked = yield* create(id, "Add a --json flag", "smart")
          expectAwaiting(parked, "approval")
          const held = yield* advance(id, Events.holdChanged(true))
          // Pending, not spent: it holds the step the trak is standing at.
          expect([held.holding, held.state]).toStrictEqual([true, parked.state])

          // Approving that step is what spends it, and the record says which step it
          // held. The steps after it are the mode's as they would have been.
          const done = yield* act(id, 1, human.approve())
          expectState(done, "Finished")
          expect(done.holding).toBe(false)
          expect(marksOf(done)).toStrictEqual([
            [0, "Uneventful"],
            [1, "Held"],
            [2, "Uneventful"],
            [3, "Uneventful"],
          ])
        }),
    ))

  it("changes one piece of a spawn, and neither its siblings nor its parent", () =>
    runFlow(
      [
        composer("work", spawn(child("review", "security"), child("review", "the client")), "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        childStep("review", "the client", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Rate-limit the public API")
          yield* act(id, 0, human.approve())
          const parent = yield* act(id, 1, human.approve())
          expect(parent.state).toStrictEqual({ _tag: "AwaitingChildren", step: 2 })
          const security = yield* driveChild(parent, 2, 0)
          const client = yield* driveChild(parent, 2, 1)
          expectAwaiting(security, "approval")

          const changed = yield* advance(security.id, Events.modeChanged("auto"))
          expect([changed.mode, changed.state]).toStrictEqual(["auto", security.state])
          expect((yield* current(client.id)).mode).toBe("manual")
          expect((yield* current(id)).mode).toBe("manual")
        }),
    ))
})

// A hold is one press for one step, and what counts as accepting one is the whole
// question: a question is a turn ending, not the step being taken.
describe("what spends a hold", () => {
  it("keeps a hold across a question, and stands at the gate the answer reaches", async () => {
    // A hold is pressed while the step is running, so the trak is on `auto` throughout
    // and nothing else could be standing this gate. `onPromptAfter` holds the step's
    // answer until the press has landed.
    const release = Effect.runSync(Deferred.make<void>())
    await runFlow(
      [
        composer("work", "review"),
        onPromptAfter(
          /artifact named `1-work`/,
          Deferred.await(release),
          reply.questions("which flag name?"),
        ),
        onResume(reply.artifact("Added --json")),
        step(2, "review", reply.artifact("holds up")),
      ],
      (id) =>
        Effect.gen(function* () {
          const drives = yield* Drives
          yield* drives.start(id, bornAuto("Add a --json flag"))
          yield* logged(id, hasComposed)
          const held = yield* advance(id, Events.holdChanged(true))
          expect([held.holding, held.state]).toStrictEqual([
            true,
            { _tag: "AgentWorking", step: 1 },
          ])

          yield* Deferred.succeed(release, undefined)
          yield* idle(id)
          // The question stands, because a pending hold answers no to every gate. But
          // answering a question is not looking at the work, so the press it was: the
          // hold is still pending here.
          const asking = yield* current(id)
          expectAwaiting(asking, "answers")
          expect(asking.holding).toBe(true)

          // And the gate the answer reaches stands too: `auto` would have taken this
          // artifact, and the hold — still pending, since nothing has been accepted —
          // stands it instead.
          const filed = yield* act(id, 1, human.answer("--json"))
          expect(filed.state).toStrictEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
          expect([filed.holding, heldAt(filed)]).toStrictEqual([true, []])
          expect(yield* logTags(id)).toStrictEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "ConditionsMet",
            "HoldChanged",
            "AgentReturned", // the questions
            "HumanActed", // the answer
            "AgentReturned", // the artifact
            "ChecksPassed",
          ])
          // Accepting the step is what spends it; the review after it is the mode's.
          const done = yield* act(id, 1, human.approve())
          expectState(done, "Finished")
          expect([done.holding, heldAt(done)]).toStrictEqual([false, [1]])
        }),
    )
  })
})
