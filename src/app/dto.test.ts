// Tier-1: exhaustively exercise the pure domain→DTO switches in dto.ts.
//
// This is the server-side half of the drift guard the `client-style` skill
// calls out as load-bearing — a new Event/TrakState variant is a TS error in
// the server's switch until handled, and an assertion here too, so the
// contract cannot go silently stale. The client's `eventView` switch is the
// other half. Both must agree on the `_tag`/`type` literals this file asserts.

import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ActRequestDto } from "@orkestra/shared/dto/actions"
import type { TrakDetailDto } from "@orkestra/shared/dto/trak"
import { noEstimate, noUsage } from "../agent/types/usage.js"
import { Places } from "../agent/types/place.js"
import { SessionId } from "../agent/types/session.js"
import { TranscriptEntry } from "../agent/types/transcript-entry.js"
import type { Agent } from "../library/types/agent.js"
import type { Library } from "../library/types/library.js"
import type { Runner } from "../library/types/runner.js"
import { CommitSha, WorktreePath, BranchName, Worktree } from "../vcs/index.js"
import {
  actFromDto,
  latestStretch,
  toHostedProcessDto,
  toDetailDto,
  toEventDto,
  toFrameDto,
  toGoalDto,
  toGoalLogDto,
  toStateDto,
  toSummaryDto,
  toTranscriptEntryDto,
} from "./dto.js"
import { Event, Events, stamped } from "../workflow/domain/event.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { GoalEvent, GoalEvents, replayGoal } from "../workflow/domain/goal.js"
import { Actions } from "../workflow/domain/human-action.js"
import { Edits } from "../workflow/domain/plan-edit.js"
import {
  emptyTrak,
  GoalId,
  Mark,
  noSlot,
  type Trak,
  TrakId,
  TrakState,
} from "../workflow/domain/trak.js"
import { Frame } from "../workflow/ports/feed.js"
import { HostedState } from "../workflow/ports/hosted-processes.js"
import type { Outage } from "../workflow/ports/outages.js"
import type { InFlightTurn } from "../workflow/ports/runs.js"
import { PreparingPhase } from "../vcs/types/preparing.js"
import { artifact } from "../workflow/domain/outputs/artifact.js"
import { planOf, Proposal, proposal } from "../workflow/domain/outputs/proposal.js"
import { askPlainly } from "../workflow/domain/outputs/questions.js"
import { stuck } from "../workflow/domain/outputs/stuck.js"

const sid = SessionId.make("00000000-0000-4000-8000-000000000001")
const branch = BranchName.make("trak/abc")
const path = WorktreePath.make("/tmp/wk")
const sha = CommitSha.make("deadbeef")

const wt = (): Worktree => Worktree.make({ path: path, branch: branch, base: sha })
const stepProp = proposal("Add a --json flag", [{ agent: "work", instruction: "do it" }])

/** One agent, named `work` so `stepProp`'s entry resolves; every other name does not. */
const work: Agent = {
  name: "work",
  description: "Does the work.",
  brief: "Do it.",
  model: "opus",
  permission: "write",
  sections: [],
  checks: [],
  effects: [],
  conditions: [],
  processes: [],
  skills: [],
  start: true,
  place: "sandbox" as const,
  icon: undefined,
  effort: undefined,
}
/** The library the mappers resolve a plan entry's model against — one agent, and the engine's own. */
const LIB: Library = {
  agents: new Map([[work.name, work]]),
  generic: { ...work, name: "generic", model: "haiku", start: false },
  checks: new Map(),
  processes: new Map(),
  tools: new Map(),
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
  root: "/repo",
  models: {
    allowed: ["opus", "sonnet", "haiku"],
    efforts: new Map(),
    composer: "haiku",
    windows: { opus: 1_000_000 },
  },
  composition: "",
  goals: "",
  guidance: "",
}

/** A row for a bare trak, so a case can be nothing but the log it projects from. */
const summaryOf = (history: readonly Event[]) =>
  toSummaryDto({
    trak: { ...emptyTrak(TrakId.make("t1")), description: "d" },
    history,
    running: false,
  })

describe("toStateDto — exhausts TrakState", () => {
  const cases: [string, TrakState, unknown][] = [
    ["Preparing", TrakState.Preparing(), { _tag: "Preparing" }],
    ["Composing", TrakState.Composing(), { _tag: "Composing" }],
    ["AwaitingProposal", TrakState.AwaitingProposal(), { _tag: "AwaitingProposal" }],
    ["AgentWorking", TrakState.AgentWorking({ step: 3 }), { _tag: "AgentWorking", step: 3 }],
    ["Stopping", TrakState.Stopping({ step: 3 }), { _tag: "Stopping", step: 3 }],
    // The composer's stop has no position, and the key is absent rather than undefined.
    ["Stopping, the composer", TrakState.Stopping({ step: undefined }), { _tag: "Stopping" }],
    ["CheckRunning", TrakState.CheckRunning({ step: 1 }), { _tag: "CheckRunning", step: 1 }],
    [
      "AwaitingHuman",
      TrakState.AwaitingHuman({ step: 0, kind: "answers" }),
      { _tag: "AwaitingHuman", step: 0, kind: "answers" },
    ],
    [
      "AwaitingComposerAnswers",
      TrakState.AwaitingComposerAnswers(),
      { _tag: "AwaitingComposerAnswers" },
    ],
    [
      "AwaitingHuman{stuck}",
      TrakState.AwaitingHuman({ step: 1, kind: "stuck" }),
      { _tag: "AwaitingHuman", step: 1, kind: "stuck" },
    ],
    [
      "ConditionRunning",
      TrakState.ConditionRunning({ step: 2 }),
      { _tag: "ConditionRunning", step: 2 },
    ],
    ["Spawning", TrakState.Spawning({ step: 2 }), { _tag: "Spawning", step: 2 }],
    ["HandingOff", TrakState.HandingOff({ step: 2 }), { _tag: "HandingOff", step: 2 }],
    [
      "AwaitingChildren",
      TrakState.AwaitingChildren({ step: 2 }),
      { _tag: "AwaitingChildren", step: 2 },
    ],
    ["Joining", TrakState.Joining({ step: 2 }), { _tag: "Joining", step: 2 }],
    ["Committing", TrakState.Committing({ step: 2 }), { _tag: "Committing", step: 2 }],
    // Carries its position across like the boundary state it follows: the drawer draws
    // what the send printed on that step's own row, so a mapping that dropped the index
    // would put a pull request's link at the wrong position.
    ["Effecting", TrakState.Effecting({ step: 2 }), { _tag: "Effecting", step: 2 }],
    ["Integrating", TrakState.Integrating(), { _tag: "Integrating" }],
    ["Finished", TrakState.Finished(), { _tag: "Finished" }],
    [
      "Failed",
      TrakState.Failed({ error: "boom", kind: "provider", apiKind: undefined }),
      {
        _tag: "Failed",
        error: "boom",
        kind: "provider",
      },
    ],
    [
      // The key is absent rather than present and undefined, which is what lets a
      // client read *nobody said* apart from `unclassified`.
      "Failed, classified",
      TrakState.Failed({ error: "boom", kind: "provider", apiKind: "interrupted" }),
      {
        _tag: "Failed",
        error: "boom",
        kind: "provider",
        apiKind: "interrupted",
      },
    ],
  ]
  for (const [name, state, expected] of cases) {
    it(`maps ${name}`, () => {
      expect(toStateDto(state)).toStrictEqual(expected)
    })
  }

  it("says which archive an archive failure stopped, off the position it failed from", () => {
    const failed = TrakState.Failed({
      error: "teardown failed",
      kind: "archive",
      apiKind: undefined,
    })
    const from = [
      [TrakState.Closing({ merged: CommitSha.make("abc1234") }), "merged"],
      [TrakState.Closing({ merged: undefined }), "closed"],
      [TrakState.Abandoning({ reason: "over" }), "abandoned"],
    ] as const
    for (const [position, archiving] of from) {
      expect(toStateDto(failed, position)).toStrictEqual({
        _tag: "Failed",
        error: "teardown failed",
        kind: "archive",
        archiving,
      })
    }
    // Any other kind carries no key, wherever it failed from.
    const engine = TrakState.Failed({ error: "boom", kind: "engine", apiKind: undefined })
    expect(toStateDto(engine, TrakState.Closing({ merged: undefined }))).not.toHaveProperty(
      "archiving",
    )
  })

  it("says a failed effect stopped it, which is what offers the skip", () => {
    const project = TrakState.Failed({ error: "no", kind: "project", apiKind: undefined })
    const effecting = TrakState.Effecting({ step: 2 })
    expect(toStateDto(project, effecting)).toHaveProperty("effecting", true)
    // An engine failure at the same position is not one a skip goes past.
    const engine = TrakState.Failed({ error: "boom", kind: "engine", apiKind: undefined })
    expect(toStateDto(engine, effecting)).not.toHaveProperty("effecting")
    expect(toStateDto(project, TrakState.CheckRunning({ step: 2 }))).not.toHaveProperty("effecting")
  })
})

/** A detail off the trak alone: no log, nobody driving, no check, and a project with
 *  no `deploy.sh` and no checks to run next — the case every test not about those is. */
const detailOf = (
  trak: Trak,
  project: {
    readonly nextChecks: readonly string[]
    readonly deployScript: boolean
    readonly handOffBase: string | undefined
  } = { nextChecks: [], deployScript: false, handOffBase: undefined },
): TrakDetailDto =>
  toDetailDto({ trak, events: [], transcript: [], asked: { ...project, lib: LIB } })

describe("toDetailDto — projects `state`, never the engine's remembered gate", () => {
  // The regression this pins: `Trak.lastGate` is the last gate parked at and
  // survives into `AgentWorking` on purpose. A wire field carrying it let a
  // client act on a trak that had already moved on, which `decide` rejected as
  // an unexpected event and which sent a healthy trak to `Failed{engine}`.
  // Nothing on the wire may answer "parked?" from anything but `state`.
  const workingPastAGate = {
    ...emptyTrak(TrakId.make("t1")),
    description: "d",
    state: TrakState.AgentWorking({ step: 0 }),
    lastGate: TrakState.AwaitingProposal(),
  }

  it("reports the state the trak is actually in", () => {
    const dto = detailOf(workingPastAGate)
    expect(dto.state).toStrictEqual({ _tag: "AgentWorking", step: 0 })
  })

  it("carries no gate field, even though the engine still remembers one", () => {
    expect(workingPastAGate.lastGate).toStrictEqual({ _tag: "AwaitingProposal" })
    const dto = detailOf(workingPastAGate)
    expect("gate" in dto).toBe(false)
  })

  it("reports custody as given, without synthesising an elapsed time", () => {
    // `since` is the record's `startedAt` and nothing else — no pid, which a browser
    // cannot act on, and no elapsed time, which the port does not report.
    const dto = toDetailDto({
      trak: workingPastAGate,
      events: [],
      transcript: [],
      holder: { pid: 7, startedAt: 42 },
      asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: LIB },
    })
    expect(dto.custody).toStrictEqual({ holder: { since: 42 } })
  })

  it("carries the accumulated decisions, which are what a trak IS rather than scaffolding", () => {
    const decided = {
      ...workingPastAGate,
      decisions: [{ text: "the admin view is out", source: "stated", at: "0-plan" }] as const,
    }
    const dto = detailOf(decided)
    expect(dto.decisions).toStrictEqual([
      { text: "the admin view is out", source: "stated", at: "0-plan", id: "0-plan.1" },
    ])
  })

  it("reports an empty channel as empty, because most traks decide nothing", () => {
    expect(detailOf(workingPastAGate).decisions).toStrictEqual([])
  })

  it("says which gates went past with nobody reading, off what was stamped when they did", () => {
    // The whole of the record: no `HumanActed` is written when this happens, so a
    // client looking for one would find nothing and report a trak somebody read.
    // Read off `Trak.marks` rather than the mode, which is what keeps the mark
    // where it is when the mode changes afterwards — this trak is on `manual` now.
    const unread = {
      ...workingPastAGate,
      mode: "manual",
      plan: planOf(stepProp),
      marks: new Map([[0, Mark.Mode()]]),
    } as const
    expect(detailOf(unread).marks).toStrictEqual([{ _tag: "Mode", at: 0 }])
    expect(detailOf(workingPastAGate).marks).toStrictEqual([])
  })

  it("carries which entries a hold held until they were accepted, straight across", () => {
    expect(
      toDetailDto({
        trak: { ...workingPastAGate, marks: new Map([[2, Mark.Held()]]) },
        events: [],
        transcript: [],
        asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: LIB },
      }).marks,
    ).toStrictEqual([{ _tag: "Held", at: 2 }])
  })

  it("carries whether a hold is pending, straight across", () => {
    expect(
      toDetailDto({
        trak: { ...workingPastAGate, holding: true },
        events: [],
        transcript: [],
        asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: LIB },
      }).holding,
    ).toBe(true)
  })

  it("carries the next step's check names as given, and an empty list as empty", () => {
    // Which names is the route's question — it holds the library and this does not — so
    // the mapper's whole job is not to lose them.
    expect(
      detailOf(workingPastAGate, {
        nextChecks: ["verify"],
        deployScript: false,
        handOffBase: undefined,
      }).nextChecks,
    ).toStrictEqual(["verify"])
    expect(detailOf(workingPastAGate).nextChecks).toStrictEqual([])
  })
})

/** A trak holding a plan of these steps and nothing else. */
const planned = (steps: Proposal["steps"]): Trak => ({
  ...emptyTrak(TrakId.make("t1")),
  description: "d",
  plan: planOf(proposal("t", steps)),
})

describe("toDetailDto — the model a plan entry runs on", () => {
  // The rule this copies is the spawn site's, `modelOf(step) ?? agent.model`, and the
  // point of carrying the answer is that no screen has to hold a second copy of it.
  const modelsOf = (trak: Trak) =>
    detailOf(trak).plan?.steps.map((s) => (s.type === "agent" ? s.model : undefined))

  it("carries the agent file's own model where the entry picked none", () => {
    expect(modelsOf(planned([{ agent: "work", instruction: "do it" }]))).toEqual(["opus"])
  })

  it("carries the entry's pick over the agent file's, where New Chat made one", () => {
    expect(
      modelsOf(
        planned([{ agent: "work", instruction: "ask", conversational: true, model: "sonnet" }]),
      ),
    ).toEqual(["sonnet"])
  })

  it("carries none for an agent the library cannot name, rather than a guess", () => {
    const [entry] = detailOf(planned([{ agent: "nobody", instruction: "do it" }])).plan?.steps ?? []
    expect(entry !== undefined && "model" in entry).toBe(false)
  })

  it("carries the model's context window from the project's table, and none where it states none", () => {
    // `opus` has a window in the fixture library and `sonnet` has not: the screen
    // drawing how full a step's context is divides by the first and draws no
    // ceiling for the second, and holds no table of its own for either.
    const [onOpus, onSonnet] =
      detailOf(
        planned([
          { agent: "work", instruction: "do it" },
          { agent: "work", instruction: "ask", conversational: true, model: "sonnet" },
        ]),
      ).plan?.steps ?? []
    expect(onOpus).toMatchObject({ model: "opus", contextWindow: 1_000_000 })
    expect(onSonnet !== undefined && "contextWindow" in onSonnet).toBe(false)
  })

  it("carries the minting entry's model for a step continuing its session", () => {
    // The chat's pick, `sonnet`, is what the header has to say the fix runs on: the
    // fix's own file says `opus`, and a session is never resumed under another model.
    // The chat ran, so its position holds a session; the fix has not.
    const chatted = planned([
      { agent: "work", instruction: "ask", conversational: true, model: "sonnet" },
      { agent: "work", instruction: "fix it", continues: "0-work" },
    ])
    const ran: Trak = {
      ...chatted,
      slots: new Map([[0, { ...noSlot, session: SessionId.make("s-0") }]]),
    }
    expect(modelsOf(ran)).toEqual(["sonnet", "sonnet"])
  })
})

describe("toDetailDto — the effort a plan entry runs at", () => {
  const withEfforts: Library = {
    ...LIB,
    agents: new Map([[work.name, { ...work, effort: "xhigh" }]]),
    models: { ...LIB.models, efforts: new Map([["sonnet", "low"]]) },
  }
  const effortsOf = (trak: Trak) =>
    toDetailDto({
      trak,
      events: [],
      transcript: [],
      asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: withEfforts },
    }).plan?.steps.map((s) => (s.type === "agent" ? s.effort : undefined))

  it("carries the agent file's level on its own model, and the pick's default on a pick", () => {
    expect(effortsOf(planned([{ agent: "work", instruction: "do it" }]))).toEqual(["xhigh"])
    expect(
      effortsOf(
        planned([{ agent: "work", instruction: "ask", conversational: true, model: "sonnet" }]),
      ),
    ).toEqual(["low"])
  })

  it("is absent where nothing declared one — the CLI's default, which the engine cannot know", () => {
    const [entry] = detailOf(planned([{ agent: "work", instruction: "do it" }])).plan?.steps ?? []
    expect(entry !== undefined && "effort" in entry).toBe(false)
  })
})

describe("the append frame and the detail are one projection", () => {
  // The gap this pins: a drawer patches itself from frames and re-reads only as a
  // backstop, so a field the detail has and the frame lacks is a field the drawer
  // draws stale until somebody closes it. Both are built from `toProjectionDto`, and
  // this is the assertion that they were.
  const projected = {
    ...emptyTrak(TrakId.make("t1")),
    description: "d",
    mode: "smart",
    holding: true,
    state: TrakState.AgentWorking({ step: 1 }),
    plan: planOf(stepProp),
    worktree: wt(),
    decisions: [{ text: "the admin view is out", source: "stated", at: "0-plan" }],
    marks: new Map([[0, Mark.Mode()]]),
  } as const

  it("carries on the frame every derived field the detail carries", () => {
    const detail = detailOf(projected)
    const frame = toFrameDto(
      Frame.Appended({ id: projected.id, seq: 1, event: Events.trakCreated("d"), trak: projected }),
      LIB,
    )
    expect(frame).toMatchObject({
      mode: detail.mode,
      holding: detail.holding,
      skippingChecks: detail.skippingChecks,
      state: detail.state,
      plan: detail.plan,
      worktree: detail.worktree,
      decisions: detail.decisions,
      marks: detail.marks,
    })
    // And the plan on both is the real one, not an empty projection agreeing with itself.
    expect(detail.plan?.steps).toHaveLength(1)
  })

  it("leaves an absent plan and checkout absent on both, rather than `undefined`", () => {
    const bare = { ...emptyTrak(TrakId.make("t1")), description: "d" }
    const detail = detailOf(bare)
    const frame = toFrameDto(
      Frame.Appended({ id: bare.id, seq: 1, event: Events.trakCreated("d"), trak: bare }),
      LIB,
    )
    expect(["plan" in detail, "worktree" in detail, "plan" in frame, "worktree" in frame]).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it("maps a drive to the same custody the detail reports", () => {
    const id = TrakId.make("t1")
    expect(toFrameDto(Frame.Drive({ id, holder: { pid: 7, startedAt: 42 } }), LIB)).toStrictEqual({
      _tag: "Drive",
      trak: "t1",
      custody: { holder: { since: 42 } },
    })
    expect(toFrameDto(Frame.Drive({ id, holder: undefined }), LIB)).toStrictEqual({
      _tag: "Drive",
      trak: "t1",
      custody: {},
    })
  })

  it("maps a turn in flight to the same shape the detail reports, and its release to none", () => {
    const id = TrakId.make("t1")
    const turn = { step: undefined, usage: noUsage, estimate: { ...noEstimate, outputTokens: 9 } }
    expect(toFrameDto(Frame.InFlight({ id, turn }), LIB)).toStrictEqual({
      _tag: "InFlight",
      trak: "t1",
      turn: { usage: { ...noUsage, tools: {} }, estimate: { ...noEstimate, outputTokens: 9 } },
    })
    expect(toFrameDto(Frame.InFlight({ id, turn: undefined }), LIB)).toStrictEqual({
      _tag: "InFlight",
      trak: "t1",
    })
  })
})

describe("toEventDto — events with no nested output union", () => {
  it("TrakCreated", () => {
    expect(toEventDto(Events.trakCreated("hello"))).toStrictEqual({
      _tag: "TrakCreated",
      description: "hello",
    })
  })
  it("WorktreeReady", () => {
    expect(toEventDto(Events.worktreeReady(wt()))).toStrictEqual({
      _tag: "WorktreeReady",
      worktree: { path: path, branch: branch, base: sha },
    })
  })
  it("WorktreeFailed", () => {
    expect(toEventDto(Events.worktreeFailed("oh no"))).toStrictEqual({
      _tag: "WorktreeFailed",
      reason: "oh no",
    })
  })
  it("WorkCommitted with sha present", () => {
    expect(toEventDto(Events.workCommitted(sha))).toStrictEqual({ _tag: "WorkCommitted", sha: sha })
  })
  it("WorkCommitted without sha — absent key, not present-and-undefined", () => {
    expect(toEventDto(Events.workCommitted(undefined))).toStrictEqual({ _tag: "WorkCommitted" })
  })
  it("WorkCommitted with a step — absent key, not present-and-undefined, when there is none", () => {
    expect(toEventDto(Events.workCommitted(sha, 2))).toStrictEqual({
      _tag: "WorkCommitted",
      sha: sha,
      step: 2,
    })
    expect(toEventDto(Events.workCommitted(undefined, 0))).toStrictEqual({
      _tag: "WorkCommitted",
      step: 0,
    })
  })
  it("HumanActed approve", () => {
    expect(toEventDto(Events.humanActed(0, Actions.approve()))).toStrictEqual({
      _tag: "HumanActed",
      step: 0,
      action: { _tag: "Approve" },
    })
  })
  it("HumanActed replan — the reason travels, because it is the whole action", () => {
    expect(toEventDto(Events.humanActed(2, Actions.replan("try a smaller piece")))).toStrictEqual({
      _tag: "HumanActed",
      step: 2,
      action: { _tag: "Replan", reason: "try a smaller piece" },
    })
  })

  it("HumanActed skip, with and without the optional message", () => {
    expect(toEventDto(Events.humanActed(1, Actions.skip("docs only")))).toStrictEqual({
      _tag: "HumanActed",
      step: 1,
      action: { _tag: "Skip", message: "docs only" },
    })
    // Absent rather than empty, and absent all the way to the wire: an optional
    // field left unset is a key JSON does not send, which is what lets both ends
    // read "skipped, nothing said" out of the same shape.
    const nothingSaid = toEventDto(Events.humanActed(1, Actions.skip()))
    expect(JSON.stringify(nothingSaid)).toBe(
      '{"_tag":"HumanActed","step":1,"action":{"_tag":"Skip"}}',
    )
  })

  it("HumanActed answer, with and without the note alongside", () => {
    expect(
      toEventDto(Events.humanActed(1, Actions.answer(["list only"], "we ship on Friday"))),
    ).toStrictEqual({
      _tag: "HumanActed",
      step: 1,
      action: { _tag: "AnswerQuestions", answers: ["list only"], note: "we ship on Friday" },
    })
    // Absent all the way to the wire, on `Skip`'s reasoning: a key JSON does not send is
    // what lets a surface tell "answered, nothing else said" from an empty note it would
    // then have to draw a caption over.
    const nothingElse = toEventDto(Events.humanActed(1, Actions.answer(["list only"])))
    expect(JSON.stringify(nothingElse)).toBe(
      '{"_tag":"HumanActed","step":1,"action":{"_tag":"AnswerQuestions","answers":["list only"]}}',
    )
  })

  it("HumanActed chat", () => {
    expect(toEventDto(Events.humanActed(1, Actions.chat("no")))).toStrictEqual({
      _tag: "HumanActed",
      step: 1,
      action: { _tag: "Chat", message: "no" },
    })
  })
  it("ChecksPassed with empty ran list (legible: no checks declared)", () => {
    expect(toEventDto(Events.checksPassed(3, []))).toStrictEqual({
      _tag: "ChecksPassed",
      step: 3,
      ran: [],
    })
  })
  it("CheckFailed", () => {
    expect(toEventDto(Events.checkFailed(0, "verify", "boom"))).toStrictEqual({
      _tag: "CheckFailed",
      step: 0,
      name: "verify",
      output: "boom",
    })
  })
})

describe("toEventDto — a wait a person skipped", () => {
  it("carries the merge the re-ask found, and no key where it found none", () => {
    expect(toEventDto(Events.waitSkipped(2, "pr-merged"))).toStrictEqual({
      _tag: "WaitSkipped",
      step: 2,
      name: "pr-merged",
    })
    expect(toEventDto(Events.waitSkipped(2, "merged", sha))).toStrictEqual({
      _tag: "WaitSkipped",
      step: 2,
      name: "merged",
      merged: sha,
    })
  })
})

describe("toEventDto — the merge's own failure", () => {
  it("MergeFailed", () => {
    expect(toEventDto(Events.mergeFailed("merge: git merge exited 2"))).toStrictEqual({
      _tag: "MergeFailed",
      reason: "merge: git merge exited 2",
    })
  })
})

/**
 * `apiKind` is the one thing a failure keeps once the state has moved off it, and it is the
 * one thing the mapper drops.
 *
 * `FailedStateDto` carries it, so a surface can say *the agent was interrupted* while the
 * trak is stopped — but that state is gone the moment somebody restarts, and the log is all
 * that is left. `reason` crosses and the classification does not, so a history can only
 * re-derive the kind by matching English against the provider's sentence, which is the thing
 * `apiKind` exists to stop. `FailedStateDto`'s own comment argues for both axes; only one of
 * them is on the wire twice.
 */
describe("toEventDto — what a failure keeps after the state has moved past it", () => {
  const DROPPED = "API Error: Connection closed mid-response. The response above may be incomplete."

  it("TurnFailed carries what the provider called it, not only what it said", () => {
    expect(toEventDto(Events.turnFailed(2, sid, DROPPED, undefined, "interrupted"))).toStrictEqual({
      _tag: "TurnFailed",
      step: 2,
      sessionId: sid,
      reason: DROPPED,
      apiKind: "interrupted",
    })
  })

  it("says nothing where the provider reported nothing to classify", () => {
    expect(toEventDto(Events.turnFailed(2, sid, "the CLI exited 1"))).toStrictEqual({
      _tag: "TurnFailed",
      step: 2,
      sessionId: sid,
      reason: "the CLI exited 1",
    })
  })
})

describe("toEventDto — events that carry a composer/step output union", () => {
  it("ComposerReturned with a proposal", () => {
    expect(toEventDto(Events.composerReturned(sid, stepProp))).toStrictEqual({
      _tag: "ComposerReturned",
      sessionId: sid,
      output: {
        type: "proposal",
        title: "Add a --json flag",
        steps: [{ type: "agent", agent: "work", instruction: "do it", conversational: false }],
      },
    })
  })
})

// The flag the engine leaves absent when it is false, and which the wire states
// either way: a plan rendered without it reads as an ordinary sequence of steps
// whichever it is.
describe("toStepDto — the plan entry's optional flag", () => {
  it("states conversational rather than omitting it", () => {
    const plan = proposal("Talk it through, then fan out", [
      { agent: "discovery", instruction: "riff on it", conversational: true },
      {
        type: "spawn",
        instruction: "two lenses",
        children: [
          { agent: "review", instruction: "security" },
          { agent: "build", instruction: "the docs half" },
        ],
      },
    ])
    const dto = toEventDto(Events.composerReturned(sid, plan))
    expect(dto).toMatchObject({
      output: {
        steps: [
          { type: "agent", agent: "discovery", conversational: true },
          {
            type: "spawn",
            children: [[{ agent: "review" }], [{ agent: "build" }]],
          },
        ],
      },
    })
  })

  // A piece is a plan, and the wire sends it as one — which is also where the
  // engine's two ways of writing a piece become one shape.
  it("sends a piece as its steps, in order, whichever way the composer wrote it", () => {
    const plan = proposal("Port the routes", [
      {
        type: "spawn",
        instruction: "two parts, one checked",
        children: [
          {
            steps: [
              { agent: "build", instruction: "move /events" },
              { agent: "review", instruction: "read the moved route" },
            ],
          },
          { agent: "build", instruction: "move /traks" },
        ],
      },
    ])
    expect(toEventDto(Events.composerReturned(sid, plan))).toMatchObject({
      output: {
        steps: [
          {
            type: "spawn",
            children: [
              [
                { agent: "build", instruction: "move /events" },
                { agent: "review", instruction: "read the moved route" },
              ],
              [{ agent: "build", instruction: "move /traks" }],
            ],
          },
        ],
      },
    })
  })
})

describe("the rung a warrant carries, which is the only place one crosses", () => {
  it("says what the turn reported, so a document nobody read says why nobody had to", () => {
    // The rung itself is not on the plan or the artifact DTO: what a surface draws is
    // the reason a *gate* went past, and that is this. A `Uneventful` warrant with no
    // rung on it would be the client inventing the quiet half of the claim.
    const filed = {
      ...emptyTrak(TrakId.make("t2")),
      description: "d",
      mode: "smart",
      plan: planOf(stepProp),
      marks: new Map([[0, Mark.Uneventful({ ambiguity: "none" })]]),
    } as const
    expect(detailOf(filed).marks).toStrictEqual([{ _tag: "Uneventful", at: 0, ambiguity: "none" }])
  })
})

describe("toEventDto — the rest of the composer/step output union", () => {
  it("ComposerReturned with questions (omits absent optional fields)", () => {
    expect(toEventDto(Events.composerReturned(sid, askPlainly("why?")))).toStrictEqual({
      _tag: "ComposerReturned",
      sessionId: sid,
      output: { type: "questions", questions: [{ question: "why?", options: [] }] },
    })
  })
  it("AgentReturned with an artifact", () => {
    expect(
      toEventDto(Events.agentReturned(2, sid, artifact({ Summary: "the body" }))),
    ).toStrictEqual({
      _tag: "AgentReturned",
      step: 2,
      sessionId: sid,
      output: { type: "artifact", sections: { Summary: "the body" } },
    })
  })
  it("AgentReturned with a stuck account, which shares no shape with an artifact", () => {
    expect(
      toEventDto(Events.agentReturned(0, sid, stuck("twice", "it hung", "the lock"))),
    ).toStrictEqual({
      _tag: "AgentReturned",
      step: 0,
      sessionId: sid,
      output: { type: "stuck", tried: "twice", happened: "it hung", diagnosis: "the lock" },
    })
  })
  it("AgentReturned with the documents an artifact faulted, which the wire must not drop", () => {
    const against = [{ at: "0-plan", text: "no offline case" }] as const
    expect(
      toEventDto(Events.agentReturned(1, sid, artifact({ S: "x" }, undefined, against))),
    ).toStrictEqual({
      _tag: "AgentReturned",
      step: 1,
      sessionId: sid,
      output: { type: "artifact", sections: { S: "x" }, corrections: against },
    })
  })
  it("AgentReturned with the requirements an envelope carried, on either envelope", () => {
    const decided = [{ text: "the admin view is out", source: "stated" }] as const
    expect(toEventDto(Events.agentReturned(2, sid, artifact({ S: "x" }, decided)))).toStrictEqual({
      _tag: "AgentReturned",
      step: 2,
      sessionId: sid,
      output: { type: "artifact", sections: { S: "x" }, requirements: decided },
    })
    expect(
      toEventDto(Events.agentReturned(0, sid, stuck("twice", "it hung", "the lock", decided))),
    ).toStrictEqual({
      _tag: "AgentReturned",
      step: 0,
      sessionId: sid,
      output: {
        type: "stuck",
        tried: "twice",
        happened: "it hung",
        diagnosis: "the lock",
        requirements: decided,
      },
    })
  })
  it("TurnFailed with both optionals omitted", () => {
    expect(toEventDto(Events.turnFailed(undefined, undefined, "boom"))).toStrictEqual({
      _tag: "TurnFailed",
      reason: "boom",
    })
  })
  it("TurnFailed with both optionals present", () => {
    expect(toEventDto(Events.turnFailed(2, sid, "boom"))).toStrictEqual({
      _tag: "TurnFailed",
      step: 2,
      sessionId: sid,
      reason: "boom",
    })
  })
  it("Restarted without sessionId", () => {
    expect(toEventDto(Events.restarted(undefined))).toStrictEqual({ _tag: "Restarted" })
  })
  /**
   * Both optionals carry, and `step` is the one a surface cannot do without: it is the
   * only ending an interrupted turn ever gets, so a reader pairing filed documents to
   * turns by counting endings is off by one per interruption without it.
   */
  it("Restarted with the position of the turn it ended", () => {
    expect(toEventDto(Events.restarted(sid, 3))).toStrictEqual({
      _tag: "Restarted",
      sessionId: sid,
      step: 3,
    })
  })
  /** A restart that re-parked a gate ended no turn, so there is no position to name. */
  it("Restarted with a session and no position, which is one at a gate", () => {
    expect(toEventDto(Events.restarted(sid))).toStrictEqual({ _tag: "Restarted", sessionId: sid })
  })
})

/**
 * The other event that ends a turn nothing else ended — a person's press rather than a
 * dead engine, with the same two optionals and the same reasons for them.
 */
describe("toEventDto — a turn a person stopped", () => {
  /**
   * Both matter for the reason `Restarted`'s do: the stop is the only ending the turn it
   * killed ever gets, and the session is what the person's next message resumes.
   */
  it("Stopped with the position and session of the turn it killed", () => {
    expect(toEventDto(Events.stopped(sid, 3))).toStrictEqual({
      _tag: "Stopped",
      sessionId: sid,
      step: 3,
    })
  })
  /** The intent carries the turn's ending, as `Stopped` did before it existed. */
  it("StopRequested with the position, session and spend of the turn it is ending", () => {
    const spend = { ...noUsage, outputTokens: 12 }
    expect(toEventDto(Events.stopRequested(sid, 3, spend))).toMatchObject({
      _tag: "StopRequested",
      sessionId: sid,
      step: 3,
      usage: { outputTokens: 12 },
    })
  })
  /** A stopped composer has no index, and one that found nothing in flight has neither. */
  it("Stopped with nothing to name, which is a press that raced the turn finishing", () => {
    expect(toEventDto(Events.stopped(sid, undefined))).toStrictEqual({
      _tag: "Stopped",
      sessionId: sid,
    })
    expect(toEventDto(Events.stopped(undefined, undefined))).toStrictEqual({ _tag: "Stopped" })
  })
  /**
   * The killed turn's spend, read off the run record before the kill. Every take-over
   * that kills a turn carries it: a filing, a recompose pressed mid-turn and an archive
   * kill the same turn the same way, so each carries the same field.
   */
  it("every take-over that killed a turn, with what the turn had spent", () => {
    const spend = { ...noUsage, outputTokens: 96_166, costUsd: 1.2 }
    expect(toEventDto(Events.stopped(sid, 3, spend))).toMatchObject({
      _tag: "Stopped",
      usage: { outputTokens: 96_166, costUsd: 1.2 },
    })
    expect(toEventDto(Events.filingAsked(sid, 3, spend))).toMatchObject({
      _tag: "FilingAsked",
      usage: { outputTokens: 96_166 },
    })
    expect(toEventDto(Events.humanActed(3, Actions.replan("other"), sid, spend))).toMatchObject({
      _tag: "HumanActed",
      sessionId: sid,
      usage: { outputTokens: 96_166 },
    })
    expect(toEventDto(Events.abandoned("enough", sid, 3, spend))).toMatchObject({
      _tag: "Abandoned",
      sessionId: sid,
      step: 3,
      usage: { outputTokens: 96_166 },
    })
  })
  it("a press at a gate and an archive of a parked trak carry none of the three", () => {
    expect(toEventDto(Events.humanActed(3, Actions.replan("other")))).toStrictEqual({
      _tag: "HumanActed",
      step: 3,
      action: { _tag: "Replan", reason: "other" },
    })
    expect(toEventDto(Events.abandoned("enough"))).toStrictEqual({
      _tag: "Abandoned",
      reason: "enough",
    })
  })
})

describe("actFromDto — maps client requests back to HumanAction", () => {
  it("approve round-trips", () => {
    expect(actFromDto({ action: "approve" })).toStrictEqual(Actions.approve())
  })
  it("approve carries each edit to the plan, and leaves the proposal it names to the route", () => {
    expect(
      actFromDto({
        action: "approve",
        edits: {
          proposal: 4,
          steps: [
            { edit: "remove", at: 1 },
            { edit: "instruction", at: 2, instruction: "smaller" },
            { edit: "continues", at: 3 },
            { edit: "continues", at: 4, key: "2-work" },
            { edit: "clearWait", at: 4 },
            { edit: "agent", at: 5, agent: "design" },
            { edit: "model", at: 5, model: "codex/gpt-5.6-sol" },
          ],
        },
      }),
    ).toStrictEqual(
      Actions.approve([
        Edits.remove(1),
        Edits.reword(2, "smaller"),
        Edits.continueFrom(3),
        Edits.continueFrom(4, "2-work"),
        Edits.clearWait(4),
        Edits.swapAgent(5, "design"),
        Edits.pickModel(5, "codex/gpt-5.6-sol"),
      ]),
    )
  })
  it("replan round-trips with its reason", () => {
    expect(actFromDto({ action: "replan", reason: "smaller" })).toStrictEqual(
      Actions.replan("smaller"),
    )
  })
  it("chat round-trips with message", () => {
    expect(actFromDto({ action: "chat", message: "more" })).toStrictEqual(Actions.chat("more"))
  })
  it("answer round-trips with a non-empty list", () => {
    expect(actFromDto({ action: "answer", answers: ["a", "b"] })).toStrictEqual(
      Actions.answer(["a", "b"]),
    )
  })
  it("answer carries the note alongside, trimmed", () => {
    expect(
      actFromDto({ action: "answer", answers: ["a"], note: "  we ship on Friday\n" }),
    ).toStrictEqual(Actions.answer(["a"], "we ship on Friday"))
  })
  /**
   * The one normalisation, and the reason it is here rather than in each caller: a form,
   * a shell prompt loop and a test can all send a note, and only this makes *no note
   * renders nothing* true of every path. A blank one would put an empty heading in a
   * prompt, which reads as a person having said something.
   */
  it("drops a note of only whitespace, which is the same as sending none", () => {
    expect(actFromDto({ action: "answer", answers: ["a"], note: "   " })).toStrictEqual(
      Actions.answer(["a"]),
    )
    expect(actFromDto({ action: "answer", answers: ["a"], note: "" })).toStrictEqual(
      Actions.answer(["a"]),
    )
  })
  it("skip round-trips, message or no message", () => {
    expect(actFromDto({ action: "skip", message: "docs only" })).toStrictEqual(
      Actions.skip("docs only"),
    )
    expect(actFromDto({ action: "skip" })).toStrictEqual(Actions.skip())
  })
})

describe("ActRequestDto — the boundary, not the mapping, rejects a bad answer list", () => {
  // A `throw` in `actFromDto` reaches the client as a 500. The list being
  // non-empty is a fact about the request, so the Schema states it and
  // `schemaBodyJson` refuses with a 400 before any mapping runs.
  const decode = Schema.decodeUnknownEither(ActRequestDto)

  it("rejects an empty answers list", () => {
    expect(Either.isLeft(decode({ action: "answer", answers: [] }))).toBe(true)
  })
  it("accepts a non-empty answers list", () => {
    expect(Either.isRight(decode({ action: "answer", answers: ["a"] }))).toBe(true)
  })
  it("rejects an unknown action", () => {
    expect(Either.isLeft(decode({ action: "nonsense" }))).toBe(true)
  })
})

describe("toProposalDto — the composer's own line", () => {
  it("carries a rationale when there is one, and omits the key when there is not", () => {
    // Optional on the wire where `conversational` is required, and the difference
    // is the fact rather than the encoding: absent means the composer had nothing
    // to say, which is most plans, and a client should be able to read that.
    const only = { agent: "build", instruction: "Do it." }
    const bare = toEventDto(Events.composerReturned(sid, proposal("Add a flag", [only])))
    expect(bare).toMatchObject({ output: { title: "Add a flag" } })
    expect(JSON.stringify(bare)).not.toContain("rationale")

    const found = Proposal.make({
      title: "Add a flag",
      rationale: "`ork list` already builds the rows, so this is a formatter.",
      steps: [only],
    })
    expect(toEventDto(Events.composerReturned(sid, found))).toMatchObject({
      output: { rationale: "`ork list` already builds the rows, so this is a formatter." },
    })
  })
})

describe("toEventDto — the time and the spend, carried but unrendered", () => {
  it("carries `at` when the store stamped one, and omits the key when it did not", () => {
    // Spread over the body rather than added to twenty `.make` calls, so a new
    // Event variant gets its timestamp without anyone remembering. The absent
    // case is a log written before `Store.append` stamped one — a time the
    // engine did not measure is not one to invent.
    expect(toEventDto(stamped(Events.closed(), 1_754_000_000_000))).toStrictEqual({
      _tag: "Closed",
      at: 1_754_000_000_000,
    })
    expect(toEventDto(Events.closed())).toStrictEqual({ _tag: "Closed" })
  })

  it("carries usage on the events that end a turn, and omits it when unmeasured", () => {
    const spend = { ...noUsage, outputTokens: 812, costUsd: 0.04, tools: { Read: 3 } }

    expect(toEventDto(Events.agentReturned(0, sid, artifact({ S: "v1" }), spend))).toMatchObject({
      usage: { outputTokens: 812, costUsd: 0.04, tools: { Read: 3 } },
    })
    // Absent means unmeasured, which is a different fact from free.
    expect(
      JSON.stringify(toEventDto(Events.agentReturned(0, sid, artifact({ S: "v1" })))),
    ).not.toContain("usage")
    expect(toEventDto(Events.composerReturned(sid, stepProp, spend))).toMatchObject({
      usage: { costUsd: 0.04 },
    })
    expect(toEventDto(Events.turnFailed(0, sid, "dropped", spend))).toMatchObject({
      usage: { costUsd: 0.04 },
    })
  })

  it("carries the context reading and the provider's window beside the spend, only where read", () => {
    const read = {
      ...noUsage,
      cacheReadTokens: 47_114,
      context: { inputTokens: 8, outputTokens: 2, cacheReadTokens: 23_557, cacheWriteTokens: 178 },
      contextWindow: 200_000,
    }
    expect(toEventDto(Events.agentReturned(0, sid, artifact({ S: "v1" }), read))).toMatchObject({
      usage: {
        cacheReadTokens: 47_114,
        context: {
          inputTokens: 8,
          outputTokens: 2,
          cacheReadTokens: 23_557,
          cacheWriteTokens: 178,
        },
        contextWindow: 200_000,
      },
    })
    // A stopped turn carries whatever the run record held at the kill, reading included.
    expect(toEventDto(Events.stopped(sid, 0, read))).toMatchObject({
      usage: { contextWindow: 200_000 },
    })
    const wire = JSON.stringify(
      toEventDto(Events.agentReturned(0, sid, artifact({ S: "v1" }), { ...noUsage })),
    )
    expect(wire).not.toContain("context")
  })
})

describe("toSummaryDto — when a person last touched the trak", () => {
  // Hand-stamped rather than appended through a store: the subject is which
  // events count and which `at` wins, and a real clock would make both
  // unassertable.
  it("reports the newest human-caused event's time", () => {
    expect(
      summaryOf([
        stamped(Events.trakCreated("d"), 1000),
        stamped(Events.humanActed(0, Actions.approve()), 2000),
        stamped(Events.humanActed(1, Actions.approve()), 3000),
      ]).touched,
    ).toBe(3000)
  })

  it("counts a stop, which nothing but a person's press ever writes", () => {
    // The line `Restarted` is on the wrong side of: a restart is written on boot recovery
    // too and cannot say which it was, where a stop is always somebody interrupting — and
    // the gate it opens is one they are standing at, so the row belongs at the top of
    // `Needs you` rather than wherever the turn it killed had left it.
    expect(
      summaryOf([stamped(Events.trakCreated("d"), 1000), stamped(Events.stopped(sid, 0), 9000)])
        .touched,
    ).toBe(9000)
  })

  it("counts the other four ways a person reaches a trak", () => {
    // Each is a person acting on a trak from outside a gate, so each moves the
    // row — a just-merged trak that sorted to the bottom of `Merged` would be
    // the one thing you came back to look at, at the far end of its section.
    const after = (e: Event): number | undefined =>
      summaryOf([stamped(Events.trakCreated("d"), 1000), stamped(e, 9000)]).touched
    expect(after(Events.closed())).toBe(9000)
    expect(after(Events.merged())).toBe(9000)
    expect(after(Events.abandoned("did it by hand"))).toBe(9000)
    expect(after(Events.reentered("CI went red"))).toBe(9000)
  })

  it("ignores everything an agent or the engine wrote, however recent", () => {
    // The inversion this prevents: a trak grinding unattended writes events on
    // every turn, and counting them would float it above one somebody just
    // answered. `Restarted` is in here because the daemon writes it on boot
    // recovery too, and the event cannot say which it was.
    expect(
      summaryOf([
        stamped(Events.trakCreated("d"), 1000),
        stamped(Events.composerReturned(sid, stepProp), 5000),
        stamped(Events.agentReturned(0, sid, artifact({ S: "v1" })), 6000),
        stamped(Events.checksPassed(0, ["verify"]), 7000),
        stamped(Events.workCommitted(sha, 0), 8000),
        stamped(Events.restarted(sid, 0), 9000),
      ]).touched,
    ).toBe(1000)
  })

  it("omits the key for a log written before the store stamped anything", () => {
    // Absent is *we do not know*, and the list sorts it last rather than
    // coercing it to a zero that would claim 1970.
    const dto = summaryOf([Events.trakCreated("d"), Events.humanActed(0, Actions.approve())])
    expect("touched" in dto).toBe(false)
  })

  it("reads the newest stamped touch past an unstamped one", () => {
    // A log part-written before `at` existed holds both kinds. Taking the last
    // qualifying event's time would report absent for a trak touched this
    // morning, so the newest `at` wins rather than the latest event.
    expect(
      summaryOf([stamped(Events.trakCreated("d"), 4000), Events.humanActed(0, Actions.approve())])
        .touched,
    ).toBe(4000)
  })
})

describe("toTranscriptEntryDto — the position its turn ran for", () => {
  it("carries a step index, the composer's marker, and omits the key for neither", () => {
    // Three states, because they are three facts: a position, the turn that has
    // none, and a line written before the engine stamped anything. Absent key
    // rather than present-and-undefined, the same shape `WorkCommitted` uses.
    expect(toTranscriptEntryDto({ _tag: "Session", id: "s-0", position: 2 })).toStrictEqual({
      _tag: "Session",
      id: "s-0",
      position: 2,
    })
    expect(
      toTranscriptEntryDto({ _tag: "Tool", name: "Read", kind: "Read", position: "composer" }),
    ).toStrictEqual({ _tag: "Tool", name: "Read", kind: "Read", position: "composer" })
    expect(toTranscriptEntryDto({ _tag: "Note", text: "Thinking" })).toStrictEqual({
      _tag: "Note",
      text: "Thinking",
    })
  })

  it("carries the stamp, the detachment and a retry across unchanged", () => {
    // Three fields a surface computes something from — an elapsed time, a card's
    // header word, a sentence — so a translation that dropped one would show a row
    // that looks complete and says the wrong thing.
    expect(
      toTranscriptEntryDto({ _tag: "Tool", name: "Agent", kind: "Task", backgrounded: true }),
    ).toStrictEqual({ _tag: "Tool", name: "Agent", kind: "Task", backgrounded: true })
    expect(toTranscriptEntryDto({ _tag: "Spawned", pid: 7, at: 1000 })).toStrictEqual({
      _tag: "Spawned",
      pid: 7,
      at: 1000,
    })
    expect(
      toTranscriptEntryDto({ _tag: "ApiRetry", attempt: 2, of: 5, status: "429", waitedMs: 1200 }),
    ).toStrictEqual({ _tag: "ApiRetry", attempt: 2, of: 5, status: "429", waitedMs: 1200 })
    expect(toTranscriptEntryDto({ _tag: "ApiRetry", attempt: 1, of: 5 })).toStrictEqual({
      _tag: "ApiRetry",
      attempt: 1,
      of: 5,
    })
  })
})

const envelope = '```json\n{"type":"artifact","sections":{"Summary":"done"}}\n```'
const said = (text: string): TranscriptEntry => ({ _tag: "Text", text })

/** A row for a trak something is driving, so the line it is showing is the subject. */
const rowFor = (history: readonly Event[], activity: TranscriptEntry) =>
  toSummaryDto({
    trak: { ...emptyTrak(TrakId.make("t1")), description: "d" },
    history,
    running: true,
    activity: [activity],
  })

/** A turn read at its last call: the counts are the spend, `held` is what the window had. */
const read = (cacheReadTokens: number, contextWindow?: number) => ({
  ...noUsage,
  inputTokens: 2,
  outputTokens: 40,
  cacheReadTokens,
  context: { inputTokens: 2, outputTokens: 1, cacheReadTokens, cacheWriteTokens: 0 },
  ...(contextWindow === undefined ? {} : { contextWindow }),
})

/** A trak two `work` steps long, standing at `state`. */
const twoWork = (state: TrakState): Trak => ({
  ...planned([
    { agent: "work", instruction: "do it" },
    { agent: "work", instruction: "again" },
  ]),
  state,
})

/** The record's turn at `step`, having read `cacheReadTokens` against `contextWindow`. */
const inFlightAt = (
  step: number | undefined,
  cacheReadTokens: number,
  contextWindow?: number,
): InFlightTurn => ({
  step,
  sessionId: sid,
  agentPid: undefined,
  agentStart: undefined,
  usage: read(cacheReadTokens, contextWindow),
  estimate: noEstimate,
})

describe("toSummaryDto — how full the window is where the trak stands", () => {
  const contextOf = (trak: Trak, history: readonly Event[], inFlight?: InFlightTurn) =>
    toSummaryDto({ trak, history, running: inFlight !== undefined, inFlight, lib: LIB }).context

  const readAtZero = [
    Events.trakCreated("d"),
    Events.agentReturned(0, sid, artifact({ S: "v1" }), read(90_000)),
  ]

  it("reads the turn in flight over any ending, against the window its provider reported", () => {
    expect(
      contextOf(
        twoWork(TrakState.AgentWorking({ step: 1 })),
        readAtZero,
        inFlightAt(1, 83_327, 200_000),
      ),
    ).toStrictEqual({
      held: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 83_327, cacheWriteTokens: 0 },
      window: 200_000,
    })
  })

  it("reads the last ending at the same position where nothing is in flight, against the table's window", () => {
    // Parked at the gate after step 0: the reading is step 0's, and the window is
    // `models.yaml`'s for `work`'s model, because that ending reported none.
    expect(
      contextOf(twoWork(TrakState.AwaitingHuman({ step: 0, kind: "approval" })), readAtZero),
    ).toStrictEqual({
      held: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 90_000, cacheWriteTokens: 0 },
      window: 1_000_000,
    })
  })

  it("carries none at a position nothing has read, whatever an earlier step read", () => {
    // Step 1 has just started and said nothing; step 0's figure would draw a full ring
    // for an agent that has spent nothing.
    expect(contextOf(twoWork(TrakState.AgentWorking({ step: 1 })), readAtZero)).toBeUndefined()
    // In flight and unread is the same answer: the record holds a turn with no reading.
    expect(
      contextOf(twoWork(TrakState.AgentWorking({ step: 1 })), readAtZero, {
        ...inFlightAt(1, 0),
        usage: noUsage,
      }),
    ).toBeUndefined()
  })

  it("carries none on a trak that has ended, whatever its log read", () => {
    for (const state of [
      TrakState.Merged({ sha }),
      TrakState.Finished(),
      TrakState.Closed(),
      TrakState.Abandoned({ reason: "enough" }),
    ]) {
      expect(contextOf(twoWork(state), readAtZero)).toBeUndefined()
    }
  })

  it("reads the composer's own ending at the plan gate, with no window where the table has none", () => {
    // `LIB.models.composer` is `haiku`, which the table gives no window for: the reading
    // goes out bare, and the list draws nothing rather than a ring against a guess.
    const composed = [Events.trakCreated("d"), Events.composerReturned(sid, stepProp, read(30_000))]
    expect(
      contextOf(
        {
          ...planned([{ agent: "work", instruction: "do it" }]),
          state: TrakState.AwaitingProposal(),
        },
        composed,
      ),
    ).toStrictEqual({
      held: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 30_000, cacheWriteTokens: 0 },
    })
  })
})

describe("toDetailDto — the turn in flight", () => {
  const working = twoWork(TrakState.AgentWorking({ step: 1 }))
  const detailWith = (inFlight: InFlightTurn | undefined, outage?: Outage) =>
    toDetailDto({
      trak: working,
      events: [],
      transcript: [],
      holder: { pid: 7, startedAt: 42 },
      inFlight,
      ...(outage === undefined ? {} : { outage }),
      asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: LIB },
    })

  const down: Outage = {
    kind: "unreachable",
    said: "could not reach the provider's API",
    since: 1_000,
    spent: false,
  }

  it("says the turn is reattaching while its sandbox is out of reach, before it has reported anything too", () => {
    expect(detailWith({ ...inFlightAt(1, 0), usage: undefined }, down).inFlight).toStrictEqual({
      step: 1,
      reattaching: {
        kind: "unreachable",
        said: "could not reach the provider's API",
        since: 1_000,
      },
    })
    expect(detailWith(inFlightAt(1, 0), down).inFlight?.reattaching?.kind).toBe("unreachable")
  })

  it("says nothing of an outage once the sandbox answers, a caller gave up on it, or no turn is in flight", () => {
    expect(detailWith(inFlightAt(1, 0)).inFlight).not.toHaveProperty("reattaching")
    expect(detailWith(inFlightAt(1, 0), { ...down, spent: true }).inFlight).not.toHaveProperty(
      "reattaching",
    )
    expect("inFlight" in detailWith(undefined, down)).toBe(false)
  })

  it("carries the record's turn whole, the estimate beside the provider's figure", () => {
    const turn = { ...inFlightAt(1, 83_327), estimate: { ...noEstimate, cacheReadTokens: 83_327 } }
    expect(detailWith(turn).inFlight).toStrictEqual({
      step: 1,
      usage: { ...read(83_327), tools: {} },
      estimate: { ...noEstimate, cacheReadTokens: 83_327 },
    })
  })

  it("carries none where nothing is in flight, or the turn has reported nothing yet", () => {
    expect("inFlight" in detailWith(undefined)).toBe(false)
    expect("inFlight" in detailWith({ ...inFlightAt(1, 0), usage: undefined })).toBe(false)
  })
})

describe("toSummaryDto — the envelope inside the activity line", () => {
  // The list has no log to read the slice off, so the row is sent it beside the entry.
  // Joined by containment against the newest turn that reported one, which is the same
  // join a surface makes: the entry is written while the stream flows and the event only
  // once the turn is over, so position cannot pair them.
  it("sends the slice the newest turn reported, when the line holds it", () => {
    const history = [Events.agentReturned(0, sid, artifact({ S: "v1" }), undefined, envelope)]
    expect(rowFor(history, said("Filed it.\n\n" + envelope)).envelope).toBe(envelope)
  })

  it("sends the composer's on the same rule", () => {
    const history = [Events.composerReturned(sid, stepProp, undefined, envelope)]
    expect(rowFor(history, said(envelope)).envelope).toBe(envelope)
  })

  it("omits the key where the line is not the words that carried it", () => {
    // The turn after has written its first line, so the row is showing something else and
    // an envelope beside it would be a claim about a different entry.
    const history = [Events.agentReturned(0, sid, artifact({ S: "v1" }), undefined, envelope)]
    expect("envelope" in rowFor(history, said("Reading the plan."))).toBe(false)
  })

  it("omits the key for a turn that reported none, and for a line that is not text", () => {
    const none = [Events.agentReturned(0, sid, artifact({ S: "v1" }))]
    expect("envelope" in rowFor(none, said(envelope))).toBe(false)
    const history = [Events.agentReturned(0, sid, artifact({ S: "v1" }), undefined, envelope)]
    expect("envelope" in rowFor(history, { _tag: "Note", text: envelope })).toBe(false)
  })
})

/** A call in the stretch — the agent's own, or a subagent's under `parent`. */
const call = (name: string, parent?: string): TranscriptEntry => ({
  _tag: "Tool",
  name,
  kind: "Read",
  ...(parent === undefined ? {} : { parent }),
})

describe("latestStretch — the part of the running turn a row summarises", () => {
  it("starts at the agent's last words, so a run after them is whole", () => {
    // `Read 2 files` needs both calls, and nothing before the words can join a row after them.
    const transcript = [call("Grep"), said("Now the mapper."), call("Read"), call("Read")]
    expect(latestStretch(transcript)).toStrictEqual(transcript.slice(1))
  })

  it("starts at the turn when the agent has not spoken in it", () => {
    const spawned: TranscriptEntry = { _tag: "Spawned", pid: 7 }
    const transcript = [said("Done."), spawned, call("Read")]
    expect(latestStretch(transcript)).toStrictEqual([spawned, call("Read")])
  })

  it("ends at the stamp where a turn wrote no spawn", () => {
    const before: TranscriptEntry = { ...call("Grep"), position: 0 }
    const after: TranscriptEntry = { ...call("Read"), position: 1 }
    expect(latestStretch([before, after])).toStrictEqual([after])
  })

  it("leaves out a subagent's lines whose delegation opened before the stretch", () => {
    // In the log they sit inside that delegation's card; here they would count as the
    // agent's own calls.
    const opened: TranscriptEntry = { _tag: "Subagent", call: "t1" }
    const own: TranscriptEntry = { _tag: "Subagent", call: "t2" }
    const transcript = [opened, said("Waiting."), own, call("Read", "t1"), call("Read", "t2")]
    expect(latestStretch(transcript)).toStrictEqual([said("Waiting."), own, call("Read", "t2")])
  })
})

describe("toSummaryDto — the checkout a row subtracts from a path", () => {
  it("sends the worktree's path, which is what makes the activity line readable", () => {
    // The row has no worktree of its own to strip against — `TrakDetailDto` carries one
    // and a summary did not, so an absolute path was drawn whole and truncated to prefix.
    const trak = { ...emptyTrak(TrakId.make("t1")), description: "d", worktree: wt() }
    expect(toSummaryDto({ trak, history: [], running: true }).worktreePath).toBe("/tmp/wk")
  })

  it("omits the key before the checkout exists", () => {
    // The composer runs before any worktree does, and a row with no root draws whole.
    expect("worktreePath" in summaryOf([])).toBe(false)
  })

  /**
   * The branch rides with the path and for a different reason: it is the only thing that
   * ties a row to one of the forge's, which answers about branches and knows nothing about
   * traks. Nothing draws it — a row already says what the work is in words a person wrote.
   */
  it("sends the branch, which is what matches a row to what the forge said", () => {
    const trak = { ...emptyTrak(TrakId.make("t1")), description: "d", worktree: wt() }
    expect(toSummaryDto({ trak, history: [], running: true }).branch).toBe(wt().branch)
  })

  it("omits the branch before the checkout exists, like the path beside it", () => {
    expect("branch" in summaryOf([])).toBe(false)
  })
})

/**
 * The one thing the list cannot work out for itself, and the only field on this summary a
 * *pile* is chosen by. The detail page counts the same fact off the log it already holds;
 * the last case here is what keeps the two from disagreeing.
 */
describe("toSummaryDto — whether anything was kept on the branch", () => {
  it("is false before anything has run, which is true rather than unknown", () => {
    // Required rather than optional, and this is why it can be: nothing has been
    // committed, so `false` is the answer and not an absence somebody has to interpret.
    expect(summaryOf([]).branchMoved).toBe(false)
  })

  it("is true once one commit event carries a sha", () => {
    expect(summaryOf([Events.workCommitted(sha, 1)]).branchMoved).toBe(true)
  })

  /**
   * **The hash, never the event.** `CommitWork` is issued at every step boundary whether or
   * not anything landed, and `committed()` reports no sha when the branch tip is still where
   * the checkout started — so a plan of read-only steps reaches its ending with a
   * `WorkCommitted` per step and not one hash. This repository's own store holds such a
   * trak, and counting events would call it plenty of commits.
   */
  it("reads a commit event carrying no sha as nothing committed", () => {
    const readOnly = [
      Events.workCommitted(undefined, 0),
      Events.workCommitted(undefined, 1),
      Events.workCommitted(undefined),
    ]
    expect(summaryOf(readOnly).branchMoved).toBe(false)
  })

  /**
   * **The client's `commitsIn` counts distinct shas and this asks whether one exists**, and
   * they have to be the same predicate: a set is non-empty exactly when one element exists.
   * Asserted over the shape that makes the difference — a re-runnable commit reporting the
   * same branch tip twice, which is why the client de-duplicates and this does not have to.
   */
  it("agrees with the count the detail page draws, over the same log", () => {
    const twice = [Events.workCommitted(sha, 1), Events.workCommitted(sha, 2)]
    const distinct = new Set(
      twice.flatMap((e) => (e._tag === "WorkCommitted" && e.sha !== undefined ? [e.sha] : [])),
    ).size
    expect(distinct).toBe(1)
    expect(summaryOf(twice).branchMoved).toBe(distinct > 0)
    expect(summaryOf([]).branchMoved).toBe(false)
  })
})

describe("toDetailDto — the skip switch and a run a person ended", () => {
  const workingPastAGate = {
    ...emptyTrak(TrakId.make("t1")),
    description: "d",
    state: TrakState.AgentWorking({ step: 0 }),
  }

  it("carries whether a skip is pending, straight across", () => {
    expect(
      toDetailDto({
        trak: { ...workingPastAGate, skippingChecks: true },
        events: [],
        transcript: [],
        asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: LIB },
      }).skippingChecks,
    ).toBe(true)
  })

  it("carries a run's verdict as the engine reported it, cancel included", () => {
    const ended = toDetailDto({
      trak: workingPastAGate,
      events: [],
      transcript: [],
      check: {
        step: 1,
        name: "verify",
        command: "bash /repo/.orkestra/checks/verify.sh",
        limit: 300,
        startedAt: 1_000,
        output: "compiling\n",
        chunks: 1,
        finished: { verdict: "cancelled", at: 73_000 },
      },
      asked: { nextChecks: [], deployScript: false, handOffBase: undefined, lib: LIB },
    }).check
    expect(ended?.finished).toStrictEqual({ verdict: "cancelled", at: 73_000 })
  })
})

describe("toEventDto — the two presses on a check, and the pass that names what it skipped", () => {
  it("ChecksPassed carries `skipped` where the switch was honoured, and no key where it ran", () => {
    expect(toEventDto(Events.checksPassed(1, [], ["verify"]))).toStrictEqual({
      _tag: "ChecksPassed",
      step: 1,
      ran: [],
      skipped: ["verify"],
    })
    expect(toEventDto(Events.checksPassed(1, ["verify"]))).toStrictEqual({
      _tag: "ChecksPassed",
      step: 1,
      ran: ["verify"],
    })
  })

  it("ChecksPassed carries `reused` where an earlier pass was taken, beside what ran", () => {
    expect(toEventDto(Events.checksPassed(1, ["lint"], undefined, ["verify"]))).toStrictEqual({
      _tag: "ChecksPassed",
      step: 1,
      ran: ["lint"],
      reused: ["verify"],
    })
  })

  it("ChecksCancelled with and without the name — absent key, not present-and-undefined", () => {
    expect(toEventDto(Events.checksCancelled(1, "verify"))).toStrictEqual({
      _tag: "ChecksCancelled",
      step: 1,
      name: "verify",
    })
    expect(toEventDto(Events.checksCancelled(1))).toStrictEqual({
      _tag: "ChecksCancelled",
      step: 1,
    })
  })

  it("SkipChecksChanged", () => {
    expect(toEventDto(Events.skipChecksChanged(true))).toStrictEqual({
      _tag: "SkipChecksChanged",
      skipping: true,
    })
  })

  it("AutoMergeChanged", () => {
    expect(toEventDto(Events.autoMergeChanged(false))).toStrictEqual({
      _tag: "AutoMergeChanged",
      on: false,
    })
  })
})

describe("toGoalDto — an escalation from a log written while one question was asked", () => {
  const log = [
    { _tag: "GoalAsked", asked: "Make search work", modes: ["smart"] },
    { _tag: "Escalated", call: "c1", question: "Which?", answers: ["this", "that"] },
    { _tag: "GoalTurnEnded", sessionId: "00000000-0000-4000-8000-000000000001", read: 0 },
  ].map((line) => Schema.decodeUnknownSync(GoalEvent)(line))
  const asked = [{ question: "Which?", options: [{ label: "this" }, { label: "that" }] }]

  it("draws as one question whose answers are its options", () => {
    const goal = replayGoal(GoalId.make("old"), log)
    const [, escalated] = log
    if (goal === undefined || escalated === undefined) throw new Error("the log replays")
    expect(toGoalDto(goal, false).escalation).toEqual({ questions: asked })
    expect(toGoalLogDto([escalated])).toMatchObject([{ _tag: "Escalated", questions: asked }])
  })

  it("reads its answer as one answer of the list", () => {
    const answered = Schema.decodeUnknownSync(GoalEvent)({
      _tag: "GoalActed",
      action: { _tag: "Answer", answer: "this" },
    })
    expect(toGoalLogDto([answered])).toEqual([
      { _tag: "GoalActed", action: { _tag: "Answer", answers: ["this"] } },
    ])
  })
})

const decoded = (line: unknown) => Schema.decodeUnknownSync(GoalEvent)(line)

describe("toGoalLogDto — the lines the page has no use for", () => {
  it("leaves out an old Redraft, which the wire does not name", () => {
    const log = [
      decoded({ _tag: "GoalAsked", asked: "Make search work", modes: ["smart"] }),
      decoded({ _tag: "GoalActed", at: 5, action: { _tag: "Redraft" } }),
      decoded({ _tag: "GoalActed", at: 6, action: { _tag: "Chat", message: "shorter" } }),
    ]
    expect(toGoalLogDto(log)).toEqual([
      { _tag: "GoalAsked", asked: "Make search work" },
      { _tag: "GoalActed", at: 6, action: { _tag: "Chat", message: "shorter" } },
    ])
  })

  it("leaves out a waiting message and its delivery, and keeps a stop", () => {
    const log = [
      GoalEvents.messageWaiting("k1", "also the docs"),
      GoalEvents.messageHeard("k1"),
      GoalEvents.turnStopped(undefined),
    ]
    expect(toGoalLogDto(log)).toEqual([{ _tag: "GoalTurnStopped" }])
  })
})

const planEntry = (title: string) => ({ title, description: `do ${title}`, mode: "smart" as const })

describe("toGoalDto — progress never counts more landed than planned", () => {
  const session = SessionId.make("00000000-0000-4000-8000-000000000001")
  const spec = { file: "g", title: "G", line: "l", finished: "done", limits: {} }
  const progress = (...events: readonly GoalEvent[]) => {
    const goal = replayGoal(GoalId.make("g-1"), [GoalEvents.started(spec), ...events])
    if (goal === undefined) throw new Error("a started log replays to a goal")
    const { landed, planned: ofPlan } = toGoalDto(goal, false)
    return { landed, ofPlan }
  }
  const A = TrakId.make("a")
  const B = TrakId.make("b")
  const opened = [
    GoalEvents.planProposed("c1", [planEntry("A"), planEntry("B")], undefined),
    GoalEvents.turnEnded(session, 0, undefined),
    GoalEvents.acted({ _tag: "Approve" }),
    GoalEvents.trakOpened("c2", A, "A", "smart"),
    GoalEvents.turnEnded(session, 0, undefined),
    GoalEvents.trakWoke(A, "landed", 2),
  ] as const

  // The brief tells the composer to `replan` "with the whole list as it now stands" after
  // each landing; a list of what is still to do leaves the landed trak off `plan`.
  it("after a replan that lists only the traks still to land", () => {
    const { landed, ofPlan } = progress(
      ...opened,
      GoalEvents.replanned("c3", [planEntry("B")], "A landed"),
      GoalEvents.trakOpened("c4", B, "B", "smart"),
      GoalEvents.trakWoke(B, "landed", 2),
    )
    expect({ landed, ofPlan }).toEqual({ landed: 2, ofPlan: 2 })
  })

  it("with a planned trak still running, which counts as still to land", () => {
    const { landed, ofPlan } = progress(...opened, GoalEvents.trakOpened("c3", B, "B", "smart"))
    expect({ landed, ofPlan }).toEqual({ landed: 1, ofPlan: 2 })
  })

  // `open_trak` takes any title: a trak opened for a hand-off, or a review trak, lands
  // without ever having been an entry of `plan`.
  it("after a trak lands that the plan never listed", () => {
    const C = TrakId.make("c")
    const { landed, ofPlan } = progress(
      ...opened,
      GoalEvents.trakOpened("c3", C, "Fix the hand-off", "smart"),
      GoalEvents.trakWoke(C, "landed", 2),
      GoalEvents.trakOpened("c4", B, "B", "smart"),
      GoalEvents.trakWoke(B, "landed", 2),
    )
    expect({ landed, ofPlan }).toEqual({ landed: 3, ofPlan: 3 })
  })
})

describe("toSummaryDto — which agent is taking a turn", () => {
  const agentOf = (state: TrakState, running: boolean) =>
    toSummaryDto({ trak: twoWork(state), history: [], running }).agent

  it("names the agent while something carries its turn", () => {
    expect(agentOf(TrakState.AgentWorking({ step: 1 }), true)).toBe("work")
  })

  /** A turn whose process died: the list draws it as stopped, and a face would say working. */
  it("names nobody once nothing carries the turn", () => {
    expect(agentOf(TrakState.AgentWorking({ step: 1 }), false)).toBeUndefined()
  })

  it("names nobody at a position no agent is running at", () => {
    expect(agentOf(TrakState.CheckRunning({ step: 1 }), true)).toBeUndefined()
  })
})

describe("a runner verb's failure", () => {
  const runner = {
    kind: "limited" as const,
    said: "five starts a minute",
    file: ".orkestra/runner.sh",
    verb: "create",
    stderr: "refused (429)",
  }

  it("rides WorktreeFailed", () => {
    expect(toEventDto(Events.worktreeFailed("oh no", { runner }))).toStrictEqual({
      _tag: "WorktreeFailed",
      reason: "oh no",
      runner,
    })
  })

  it("rides the Failed state, and is absent where no runner failed", () => {
    const failed = { error: "boom", kind: "worktree" as const, apiKind: undefined }
    expect(toStateDto(TrakState.Failed({ ...failed, runner }))).toStrictEqual({
      _tag: "Failed",
      error: "boom",
      kind: "worktree",
      runner,
    })
    expect(toStateDto(TrakState.Failed(failed))).not.toHaveProperty("runner")
  })
})

describe("a refusal by the runners-only guard", () => {
  it("rides the Failed state, and is absent where nothing was refused", () => {
    const failed = { error: "boom", kind: "provider" as const, apiKind: undefined }
    const runnersOnly = "--runners-only refuses `claude` on this host"
    expect(toStateDto(TrakState.Failed({ ...failed, runnersOnly }))).toStrictEqual({
      _tag: "Failed",
      error: "boom",
      kind: "provider",
      runnersOnly,
    })
    expect(toStateDto(TrakState.Failed(failed))).not.toHaveProperty("runnersOnly")
  })
})

describe("a remake that left the uncommitted changes behind", () => {
  it("rides the Failed state as the ref, and is absent where nothing was left", () => {
    const failed = { error: "boom", kind: "worktree" as const, apiKind: undefined }
    const carried = "refs/orkestra/carried/t1"
    expect(toStateDto(TrakState.Failed({ ...failed, carried }))).toStrictEqual({
      _tag: "Failed",
      error: "boom",
      kind: "worktree",
      carried,
    })
    expect(toStateDto(TrakState.Failed(failed))).not.toHaveProperty("carried")
  })
})

describe("a setup that failed", () => {
  it("rides the Failed state as what the script printed, and is absent on every other failure", () => {
    const failed = {
      error: "setup failed in /w:\nno lockfile",
      kind: "worktree" as const,
      apiKind: undefined,
    }
    expect(toStateDto(TrakState.Failed({ ...failed, setup: "no lockfile" }))).toStrictEqual({
      _tag: "Failed",
      error: failed.error,
      kind: "worktree",
      setup: "no lockfile",
    })
    expect(toStateDto(TrakState.Failed(failed))).not.toHaveProperty("setup")
  })
})

describe("a trak's preparation on the stream", () => {
  it("maps every preparation, the runner's own words on a sandbox's, and none to no field", () => {
    const id = TrakId.make("t1")
    const runner: Runner = {
      description: "Runs each trak in a sandbox.",
      secret: undefined,
      pass: [],
      idleMinutes: undefined,
      settings: {},
      path: "/nowhere/runner.sh",
    }
    const framed = (phase: PreparingPhase) =>
      toFrameDto(Frame.Preparing({ id, phase }), LIB, runner.description)
    expect(framed(PreparingPhase.Checkout())).toStrictEqual({
      _tag: "Preparing",
      trak: "t1",
      preparing: { _tag: "Checkout" },
    })
    for (const phase of [
      PreparingPhase.Creating(),
      PreparingPhase.Resuming(),
      PreparingPhase.Rebuilding(),
    ]) {
      expect(framed(phase)).toMatchObject({
        preparing: { _tag: phase._tag, runner: runner.description },
      })
      // A runner file gone from under it leaves the line out rather than inventing one.
      expect(toFrameDto(Frame.Preparing({ id, phase }), LIB)).toStrictEqual({
        _tag: "Preparing",
        trak: "t1",
        preparing: { _tag: phase._tag },
      })
    }
    expect(framed(PreparingPhase.Copying({ sent: 2, total: 5 }))).toMatchObject({
      preparing: { _tag: "Copying", sent: 2, total: 5 },
    })
    for (const phase of [
      PreparingPhase.Seeding(),
      PreparingPhase.SettingUp(),
      PreparingPhase.SetupBeside(),
    ]) {
      expect(framed(phase)).toStrictEqual({
        _tag: "Preparing",
        trak: "t1",
        preparing: { _tag: phase._tag },
      })
    }
    expect(
      toFrameDto(Frame.Preparing({ id, phase: undefined }), LIB, runner.description),
    ).toStrictEqual({
      _tag: "Preparing",
      trak: "t1",
    })
  })
})

describe("the action at the seam, on the wire", () => {
  const id = TrakId.make("t1")
  it("sends the status whole, and the frame bare once the action ends", () => {
    const lastError = { kind: "lost", said: "ssh: connection refused" } as const
    const status = { action: "stop", phase: "waiting", attempt: 2, since: 5, lastError } as const
    expect(toFrameDto(Frame.SeamStatus({ id, status }), LIB)).toStrictEqual({
      _tag: "SeamStatus",
      trak: "t1",
      seam: { action: "stop", phase: "waiting", attempt: 2, since: 5, lastError },
    })
    expect(toFrameDto(Frame.SeamStatus({ id, status: undefined }), LIB)).toStrictEqual({
      _tag: "SeamStatus",
      trak: "t1",
    })
  })
})

describe("where work ran, on the wire", () => {
  const there = Places.remote("Runs each trak in a sandbox.", "sbx-1", "exec-1")
  const wire = {
    _tag: "Remote",
    runner: "Runs each trak in a sandbox.",
    sandbox: "sbx-1",
    exec: "exec-1",
  }

  it("carries a turn's place on its Spawned line, and none where it ran here before it was kept", () => {
    expect(toTranscriptEntryDto({ _tag: "Spawned", pid: 7, place: there })).toStrictEqual({
      _tag: "Spawned",
      pid: 7,
      place: wire,
    })
    expect(toTranscriptEntryDto({ _tag: "Spawned", pid: 7, place: Places.local() })).toStrictEqual({
      _tag: "Spawned",
      pid: 7,
      place: { _tag: "Local" },
    })
  })

  it("carries a check's place on its failure and each check's on a pass, by name", () => {
    expect(
      toEventDto(Events.checkFailed(1, "verify", "2 problems", "bash v.sh", 1, { place: there })),
    ).toMatchObject({ _tag: "CheckFailed", place: wire })
    expect(
      toEventDto(Events.checksPassed(1, ["verify"], undefined, undefined, { verify: there })),
    ).toMatchObject({ _tag: "ChecksPassed", places: { verify: wire } })
  })

  it("leaves out a sandbox the runner gave no id for, and a checkout's place with no exec", () => {
    const unnamed = Places.remote("A runner.", undefined, "exec-2")
    expect(
      toEventDto(Events.checkFailed(1, "verify", "x", undefined, undefined, { place: unnamed })),
    ).toMatchObject({ place: { _tag: "Remote", runner: "A runner.", exec: "exec-2" } })
    const checkout = Places.remote("A runner.", "sbx-1")
    expect(
      toEventDto(Events.checkFailed(1, "verify", "x", undefined, undefined, { place: checkout })),
    ).not.toHaveProperty("place")
  })

  it("carries a running check's and a process's place", () => {
    const run = toFrameDto(
      Frame.CheckStarted({
        id: TrakId.make("t1"),
        run: {
          step: 1,
          name: "verify",
          command: "bash v.sh",
          limit: 60,
          startedAt: 1,
          output: "",
          chunks: 0,
          place: there,
        },
      }),
      LIB,
    )
    expect(run).toMatchObject({ run: { place: wire } })
    expect(
      toHostedProcessDto({
        name: "dev",
        description: "The dev server.",
        page: true,
        readySeconds: 30,
        run: 1,
        state: HostedState.NotStarted(),
        log: "",
        chunks: 0,
        place: there,
      }),
    ).toMatchObject({ place: wire })
  })

  it("marks a row sandboxed by the newest WorktreeReady's place, and a local one not", () => {
    const remote = Events.worktreeReady(wt(), Places.remote("A runner.", "sbx-1"))
    const local = Events.worktreeReady(wt(), Places.local())
    expect(summaryOf([remote]).sandboxed).toBe(true)
    expect(summaryOf([remote, local])).not.toHaveProperty("sandboxed")
  })
})

/** Each event as its stored JSON line, read back the way the store reads one. */
const asStored = (events: readonly Event[]): readonly Event[] =>
  events.map((e) =>
    Schema.decodeUnknownSync(Event)(JSON.parse(JSON.stringify(Schema.encodeSync(Event)(e)))),
  )

describe("a log written before places were recorded", () => {
  const id = TrakId.make("t1")
  const there = Places.remote("A runner.", "sbx-1", "exec-1")
  const before = asStored([
    Events.trakCreated("d"),
    Events.worktreeReady(wt()),
    Events.setupStarted(),
    Events.setupPassed(),
  ])
  const after = asStored([
    Events.trakCreated("d"),
    Events.worktreeReady(wt(), Places.remote("A runner.", "sbx-1")),
    Events.setupStarted(Places.remote("A runner.", "sbx-1")),
    Events.setupPassed(),
  ])

  it("replays to the state a log with places replays to: the place moves nothing", () => {
    expect(replayHistory(id, before)).toStrictEqual(replayHistory(id, after))
  })

  it("draws no place anywhere it would be drawn", () => {
    expect(summaryOf(before)).not.toHaveProperty("sandboxed")
    const failed = asStored([Events.checkFailed(1, "verify", "x", "bash v.sh", 1)])
    const passed = asStored([Events.checksPassed(1, ["verify"])])
    expect(failed.map(toEventDto)[0]).not.toHaveProperty("place")
    expect(passed.map(toEventDto)[0]).not.toHaveProperty("places")
    const line = Schema.decodeUnknownSync(TranscriptEntry)({
      _tag: "Spawned",
      pid: 7,
      execId: "exec-1",
    })
    expect(toTranscriptEntryDto(line)).toStrictEqual({
      _tag: "Spawned",
      pid: 7,
    })
    // The same line written today keeps where it ran.
    expect(
      Events.checkFailed(1, "verify", "x", undefined, undefined, { place: there }),
    ).toHaveProperty("place")
  })
})
