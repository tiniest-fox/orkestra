/**
 * Tier 1: the plan projection, with no React and no fetch.
 *
 * What is worth asserting here is the facts the map and the bar would get silently
 * wrong — where the trak is when the state carries no step, that a failed trak marks
 * the entry the *log* says it died at, and that the composer's row can tell a trak that
 * died with a plan from one that died without ever getting one.
 */

import { describe, expect, it } from "vitest"
import type { EventDto, TrakStateDto } from "../../../api/types"
import {
  makeAgentReturned,
  makeCheckFailed,
  makeChecksPassed,
  makeChildrenSpawned,
  makeComposerReturned,
  makeEffectFailed,
  makeEffectsRan,
  makeHumanActed,
  makeRestarted,
  makeStopped,
  makeStopRequested,
  makeTrakCreated,
  makeTurnFailed,
  makeWorkCommitted,
} from "../../../fixtures"
import { composerStatus, keptAt, stepAt, stepStatuses } from "./planView"

const created: EventDto = makeTrakCreated({ description: "commit every step" })

/** A turn that returned for one entry, which is the commonest way an entry gets behind. */
const ran = (step: number): EventDto =>
  makeAgentReturned({
    step,
    sessionId: `s-${String(step)}`,
    output: { type: "artifact", sections: { Summary: "did it" } },
  })

describe("stepAt", () => {
  it("reads the step off the states that carry one", () => {
    expect(stepAt({ _tag: "AgentWorking", step: 3 })).toBe(3)
    expect(stepAt({ _tag: "AwaitingHuman", step: 2, kind: "approval" })).toBe(2)
  })

  it("is undefined before a plan exists and after it has run out", () => {
    expect(stepAt({ _tag: "Composing" })).toBeUndefined()
    expect(stepAt({ _tag: "Finished" })).toBeUndefined()
    // `Failed` too — the entry it died at is in the log, not on the state.
    expect(stepAt({ _tag: "Failed", kind: "provider", error: "exited 1" })).toBeUndefined()
  })
})

describe("stepStatuses", () => {
  it("puts everything before the position behind it and everything after ahead", () => {
    const state: TrakStateDto = { _tag: "AwaitingHuman", step: 2, kind: "approval" }
    expect(stepStatuses(state, [], 5)).toEqual(["done", "done", "gate", "todo", "todo"])
  })

  it("marks a running entry from the state's own tag", () => {
    expect(stepStatuses({ _tag: "CheckRunning", step: 1 }, [], 3)).toEqual([
      "done",
      "running",
      "todo",
    ])
  })

  it("marks the entry a failed trak died at, read off the log", () => {
    const log: readonly EventDto[] = [
      created,
      makeTurnFailed({ step: 1, reason: "the CLI exited 1" }),
    ]
    const state: TrakStateDto = { _tag: "Failed", kind: "provider", error: "exited 1" }
    expect(stepStatuses(state, log, 4)).toEqual(["done", "failed", "todo", "todo"])
  })

  it("takes the LAST failure, because a trak can fail, resume and fail again", () => {
    const log: readonly EventDto[] = [
      makeTurnFailed({ step: 0, reason: "first" }),
      makeTurnFailed({ step: 2, reason: "again, further on" }),
    ]
    const state: TrakStateDto = { _tag: "Failed", kind: "agent", error: "again" }
    expect(stepStatuses(state, log, 4)).toEqual(["done", "done", "failed", "todo"])
  })

  it("calls an entry done at rest only where the log says it ran", () => {
    // `Finished` used to be a verdict for the whole plan. A trak parked at a wait is
    // `Finished` with a step still to run, and the map drew that step green under a flag.
    expect(stepStatuses({ _tag: "Finished" }, [ran(0), ran(1)], 4)).toEqual([
      "done",
      "done",
      "todo",
      "todo",
    ])
    // The same at a trak archived with an entry it never reached, and nothing changes
    // where every entry did run.
    expect(stepStatuses({ _tag: "Abandoned", reason: "later" }, [ran(0)], 2)).toEqual([
      "done",
      "todo",
    ])
    expect(stepStatuses({ _tag: "Merged", sha: "9f31c07" }, [ran(0), ran(1)], 2)).toEqual([
      "done",
      "done",
    ])
  })

  it("calls every entry todo before anything has run", () => {
    expect(stepStatuses({ _tag: "AwaitingProposal" }, [], 3)).toEqual(["todo", "todo", "todo"])
  })

  // Thirteen states carry no position and the plan is over in none of them. Watched in
  // the lab: two steps had returned, passed and committed, and the map drew the lot grey.
  it("keeps what has run behind the plan when the state names no position at all", () => {
    // The composer, asked again with work behind it — the ordinary shape, not a failure.
    expect(stepStatuses({ _tag: "AwaitingProposal" }, [created, ran(0), ran(1)], 4)).toEqual([
      "done",
      "done",
      "todo",
      "todo",
    ])
    // A failure with no step to blame, which reaches none of `failedStep`'s three events.
    const failed: TrakStateDto = { _tag: "Failed", kind: "engine", error: "only answers apply" }
    expect(stepStatuses(failed, [ran(0)], 3)).toEqual(["done", "todo", "todo"])
  })

  it("counts a skip and a spawn as having run, the same three the engine counts", () => {
    const log: readonly EventDto[] = [
      makeHumanActed({ step: 0, action: { _tag: "Skip" } }),
      makeChildrenSpawned({ step: 1, ids: ["c-1", "c-2"] }),
      // An approval is not a run: the entry it answers for is the one still standing.
      makeHumanActed({ step: 2, action: { _tag: "Approve" } }),
    ]
    expect(stepStatuses({ _tag: "Composing" }, log, 3)).toEqual(["done", "done", "todo"])
  })
})

describe("stepStatuses, at rest, on an entry that ran and failed", () => {
  const archived: TrakStateDto = { _tag: "Abandoned", reason: "later" }

  it("reads the failure the trak was archived on, at every failure event", () => {
    // It read *not started* over a whole transcript: `ranAt` counts a turn returning,
    // and a turn that died never did.
    expect(
      stepStatuses(archived, [ran(1), makeTurnFailed({ step: 2, reason: "exited 1" })], 4),
    ).toEqual(["todo", "done", "failed", "todo"])
    // A step that returned and then failed its checks or its effects read `done`.
    expect(stepStatuses(archived, [ran(1), makeCheckFailed({ step: 1 })], 2)).toEqual([
      "todo",
      "failed",
    ])
    expect(stepStatuses(archived, [ran(1), makeEffectFailed({ step: 1 })], 2)).toEqual([
      "todo",
      "failed",
    ])
  })

  it("lets what came after answer a failure — a return, a pass, an approval, a skip", () => {
    const resumed = [makeTurnFailed({ step: 1, reason: "exited 1" }), ran(1)]
    expect(stepStatuses(archived, resumed, 2)).toEqual(["todo", "done"])
    const passed = [ran(1), makeCheckFailed({ step: 1 }), makeChecksPassed({ step: 1 })]
    expect(stepStatuses(archived, passed, 2)).toEqual(["todo", "done"])
    const taken = [
      ran(1),
      makeCheckFailed({ step: 1 }),
      makeHumanActed({ step: 1, action: { _tag: "Approve" } }),
    ]
    expect(stepStatuses(archived, taken, 2)).toEqual(["todo", "done"])
    const effects = [ran(1), makeEffectFailed({ step: 1 }), makeEffectsRan({ step: 1 })]
    expect(stepStatuses(archived, effects, 2)).toEqual(["todo", "done"])
  })

  // A composer gate records `step: 0`, and entry 0 is a real step on a child trak and on a
  // trak opened with a named agent. Read off `HumanActed.step`, approving the plan cleared
  // the first step's failure — over both composer gates and all three failure events.
  it("does not let a press at a composer gate answer a failure on plan entry 0", () => {
    const proposed = makeComposerReturned({ sessionId: "s-plan-2" })
    const askedFirst = makeComposerReturned({
      sessionId: "s-plan-3",
      output: { type: "questions", questions: [{ question: "one or two?", options: [] }] },
    })
    const approve = makeHumanActed({ step: 0, action: { _tag: "Approve" } })
    const skip = makeHumanActed({ step: 0, action: { _tag: "Skip" } })
    for (const gate of [proposed, askedFirst]) {
      const died = [makeTurnFailed({ step: 0, reason: "exited 1" }), gate, approve]
      expect(stepStatuses(archived, died, 2)).toEqual(["failed", "todo"])
      const checks = [ran(0), makeCheckFailed({ step: 0 }), gate, approve]
      expect(stepStatuses(archived, checks, 2)).toEqual(["failed", "todo"])
      const effects = [ran(0), makeEffectFailed({ step: 0 }), gate, skip]
      expect(stepStatuses(archived, effects, 2)).toEqual(["failed", "todo"])
    }
    // The same press at the step's own gate still answers it.
    const taken = [ran(0), makeCheckFailed({ step: 0 }), approve]
    expect(stepStatuses(archived, taken, 2)).toEqual(["done", "todo"])
  })

  // A stop opens a gate at either end, and which end is `Stopped.step`: absent is the
  // composer's run, present is the step's turn. A walk that knew only the three obvious
  // openers was wrong in both directions on a log carrying one.
  it("reads the gate a stop opens, at both ends", () => {
    const proposed = makeComposerReturned({ sessionId: "s-plan" })
    const approve = makeHumanActed({ step: 0, action: { _tag: "Approve" } })
    // The composer is stopped mid-re-compose and the standing plan approved. The last
    // step event was entry 0's failing check, so its failure used to be cleared here.
    const recompose: readonly EventDto[] = [
      proposed,
      approve,
      ran(0),
      makeCheckFailed({ step: 0 }),
      makeHumanActed({ step: 0, action: { _tag: "Replan", reason: "wrong shape" } }),
      makeWorkCommitted({ step: 0, sha: "abc1234" }),
      makeStopped({}),
      approve,
    ]
    expect(stepStatuses(archived, recompose, 2)).toEqual(["failed", "todo"])
    // The step's own turn is stopped and the step then skipped — a `conversation` gate,
    // which offers `Skip`. The composer's gate is long closed and must not swallow it.
    const skipped: readonly EventDto[] = [
      proposed,
      approve,
      makeTurnFailed({ step: 0, reason: "exited 1" }),
      makeRestarted({ step: 0 }),
      makeStopped({ step: 0 }),
      makeHumanActed({ step: 0, action: { _tag: "Skip" } }),
    ]
    expect(stepStatuses(archived, skipped, 2)).toEqual(["done", "todo"])
  })

  // Since `StopRequested`, the intent names the end and the `Stopped` after it carries
  // nothing — which must not read as the composer's gate opening.
  it("reads the gate off the intent on a log written since, and nothing off the bare ending", () => {
    const proposed = makeComposerReturned({ sessionId: "s-plan" })
    const approve = makeHumanActed({ step: 0, action: { _tag: "Approve" } })
    const skipped: readonly EventDto[] = [
      proposed,
      approve,
      makeTurnFailed({ step: 0, reason: "exited 1" }),
      makeRestarted({ step: 0 }),
      makeStopRequested({ step: 0 }),
      makeStopped({ sessionId: undefined }),
      makeHumanActed({ step: 0, action: { _tag: "Skip" } }),
    ]
    expect(stepStatuses(archived, skipped, 2)).toEqual(["done", "todo"])
  })

  it("does not let a chat answer it, which takes no gate", () => {
    const argued = [
      ran(1),
      makeCheckFailed({ step: 1 }),
      makeHumanActed({ step: 1, action: { _tag: "Chat", message: "why?" } }),
    ]
    expect(stepStatuses(archived, argued, 2)).toEqual(["todo", "failed"])
  })
})

describe("keptAt", () => {
  it("finds the sha an entry committed", () => {
    const log: readonly EventDto[] = [makeWorkCommitted({ step: 1, sha: "4f1c2ab" })]
    expect(keptAt(log, 1)).toBe("4f1c2ab")
    expect(keptAt(log, 2)).toBeUndefined()
  })

  it("ignores a commit that kept nothing", () => {
    // `sha` absent means nothing has been committed on this branch yet, which is not
    // the same as the entry having no commit to show.
    expect(keptAt([makeWorkCommitted({ step: 1 })], 1)).toBeUndefined()
  })
})

describe("composerStatus", () => {
  const composed: EventDto = makeComposerReturned({
    sessionId: "s-1",
    output: { type: "proposal", title: "Add a client", steps: [] },
  })

  it("is running while the plan is being worked out", () => {
    expect(composerStatus({ _tag: "Composing" }, [], "s-1", true)).toBe("running")
    expect(composerStatus({ _tag: "Preparing" }, [], "s-1", true)).toBe("running")
    // The composer's own turn being stopped is still that turn; a step's is past the plan.
    expect(composerStatus({ _tag: "Stopping" }, [], "s-1", true)).toBe("running")
  })

  it("is a gate at the plan and at the questions before it", () => {
    expect(composerStatus({ _tag: "AwaitingProposal" }, [], "s-1", true)).toBe("gate")
    expect(composerStatus({ _tag: "AwaitingComposerAnswers" }, [], "s-1", true)).toBe("gate")
  })

  it("is done once it has returned, wherever the trak has got to since", () => {
    expect(composerStatus({ _tag: "AgentWorking", step: 1 }, [composed], "s-1", true)).toBe("done")
    expect(composerStatus({ _tag: "Finished" }, [composed], "s-1", true)).toBe("done")
  })

  // The one distinction the log is needed for: both of these are `Failed`, and only
  // the second one is the composer's failure.
  it("blames the composer only when the trak never got a plan", () => {
    const failed: TrakStateDto = { _tag: "Failed", kind: "agent", error: "exited 1" }
    expect(composerStatus(failed, [composed], "s-1", true)).toBe("done")
    expect(composerStatus(failed, [], "s-1", true)).toBe("failed")
  })

  // A plan the composer stopped short of has an entry sitting there waiting for it, and
  // a turn that asked a question instead of filling it in has produced nothing. Found in
  // the lab: the composer asked, nobody answered, and the entry drew itself green.
  it("does not call a run that only asked a question a plan", () => {
    const asked: EventDto = makeComposerReturned({
      sessionId: "s-2",
      output: { type: "questions", questions: [{ question: "which of the two?", options: [] }] },
    })
    expect(composerStatus({ _tag: "AwaitingComposerAnswers" }, [asked], "s-2", true)).toBe("gate")
    const failed: TrakStateDto = { _tag: "Failed", kind: "engine", error: "only answers apply" }
    expect(composerStatus(failed, [composed, asked], "s-2", true)).toBe("failed")
  })

  // The other answer that lands a compose entry. Read as *did it return a proposal*,
  // a trak the composer brought to rest drew its composer's row as not started — and
  // nothing on that screen would have said otherwise.
  it("counts the answer that says the work is already done", () => {
    const ended: EventDto = makeComposerReturned({
      sessionId: "s-3",
      output: { type: "finished", reason: "the branch already carries it" },
    })
    expect(composerStatus({ _tag: "Finished" }, [ended], "s-3", true)).toBe("done")
    expect(composerStatus({ _tag: "AgentWorking", step: 1 }, [ended], "s-3", false)).toBe("done")
  })

  // A run the trak has moved past is settled, so the state says nothing about it and
  // its own session is the whole answer.
  it("answers a settled run from its own session alone", () => {
    const working: TrakStateDto = { _tag: "AgentWorking", step: 1 }
    expect(composerStatus(working, [composed], "s-1", false)).toBe("done")
    expect(composerStatus(working, [composed], "s-2", false)).toBe("failed")
  })

  // The regression: a global "has one ever returned" is true the moment any compose
  // succeeds, so every later run inherited its verdict.
  it("does not let an earlier compose vouch for the run that failed", () => {
    const failed: TrakStateDto = { _tag: "Failed", kind: "provider", error: "exited 1" }
    expect(composerStatus(failed, [composed], "s-2", true)).toBe("failed")
  })

  // The same regression one entry earlier: an ask a step's raised work bought stands in
  // the plan with no run of its own, and with no session to match it read `done` off the
  // compose before it — at the gate where a person decides whether to buy the turn.
  it("reads an entry with no run of its own as not started, whatever landed before it", () => {
    const gate: TrakStateDto = { _tag: "AwaitingHuman", step: 1, kind: "approval" }
    expect(composerStatus(gate, [composed], undefined, true)).toBe("todo")
    // And as running the moment the composer is asked for it.
    expect(composerStatus({ _tag: "Composing" }, [composed], undefined, true)).toBe("running")
  })
})
