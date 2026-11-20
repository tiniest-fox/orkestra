/**
 * Tier 1: the map's rows, with no React and no fetch.
 *
 * The plan *is* the sequence now, so most of what this file used to assert has moved
 * into the engine — where a composer run sits, why it was asked, which entry was at a
 * position when a turn ran. What is left is the part that is still this file's: that a
 * row is handed its own turns and nobody else's, that a compose reads as a compose, and
 * that a selection survives the poll.
 */

import {
  AlarmClock,
  CircleDashed,
  CircleMinus,
  Flag,
  Hand,
  ListRestart,
  ListTree,
  Split,
} from "lucide-react"
import { describe, expect, it } from "vitest"
import type {
  ComposerOutputDto,
  EventDto,
  PlanDto,
  TranscriptEntryDto,
  TrakStateDto,
  MarkDto,
  WaitingDto,
} from "../../../api/types"
import {
  makeAgent,
  makeAgentReturned,
  makeAgentStep,
  makeBackground,
  makeCheckFailed,
  makeComposerReturned,
  makeHumanActed,
  makePlan,
  makeSession,
  makeSpawned,
  makeStopped,
  makeTool,
  makeTurnFailed,
  makeWaiting,
  makeWorkCommitted,
} from "../../../fixtures"
import { glyphFor } from "../../../format/glyph"
import { mapRows, opensAt } from "./rows"
import { splitTurns } from "../turns/turns"

const step = (agent: string): PlanDto["steps"][number] =>
  makeAgentStep({ agent, instruction: `do ${agent}` })

/** One spawn entry, one piece per agent named, each piece a plan of one step. */
const spawnOf = (...agents: readonly string[]): PlanDto["steps"][number] => ({
  type: "spawn",
  instruction: "in parallel",
  children: agents.map((agent) => [{ agent, instruction: `do ${agent}` }]),
})

/** The shape the engine writes: what ran, in order, its composes among it. */
const plan = (...steps: PlanDto["steps"]): PlanDto => makePlan({ steps })

const composed = (sessionId: string): EventDto => makeComposerReturned({ sessionId })

const returned = (at: number, sessionId: string): EventDto =>
  makeAgentReturned({ step: at, sessionId })

/** A step ending on something other than an artifact — what opens a gate that still parks. */
const filed = (at: number, kind: "stuck" | "questions"): EventDto =>
  makeAgentReturned({
    step: at,
    output:
      kind === "stuck"
        ? { type: "stuck", tried: "", happened: "", diagnosis: "" }
        : {
            type: "questions",
            questions: [],
          },
  })

/** What the composer files when it asks something before it has a plan to propose. */
const questions: ComposerOutputDto = {
  type: "questions",
  questions: [{ question: "one service or two?", options: [{ label: "one" }, { label: "two" }] }],
}

const approved = (at: number): EventDto => makeHumanActed({ step: at, action: { _tag: "Approve" } })
const skipped = (at: number): EventDto => makeHumanActed({ step: at, action: { _tag: "Skip" } })
const said = (at: number, message: string): EventDto =>
  makeHumanActed({ step: at, action: { _tag: "Chat", message } })
const answered = (at: number): EventDto =>
  makeHumanActed({ step: at, action: { _tag: "AnswerQuestions", answers: ["the first one"] } })

/** A turn as the engine writes one: every line stamped with the position it ran for. */
const turn = (
  pid: number,
  session: string,
  position: number | "composer",
  detail?: string,
): TranscriptEntryDto[] => [
  makeSpawned({ pid, position }),
  makeSession({ id: session, position }),
  ...(detail === undefined ? [] : [makeTool({ detail, position })]),
]

/** A trak somebody stood at every gate of, which is every trak on `manual`. */
const READ: readonly MarkDto[] = []

/** Midday, local — what a clock's words are read against. `new Date`, never an epoch. */
const NOW = new Date(2026, 8, 17, 12, 0).getTime()

const working = (at: number): TrakStateDto => ({ _tag: "AgentWorking", step: at })
const keys = (rows: readonly { readonly key: string }[]): readonly string[] =>
  rows.map((r) => r.key)

/** compose, a step, the re-compose that followed it, and the step it proposed. */
const recut: PlanDto = plan(
  { type: "compose" },
  step("research"),
  {
    type: "compose",
    why: {
      _tag: "Raised",
      step: 1,
      requirements: ["a Redis store", "a limit"],
      corrections: [],
    },
  },
  step("build"),
)
const log = [composed("s-plan"), returned(1, "s-1"), composed("s-plan-2")]
const transcript = [
  ...turn(1, "s-plan", "composer", "first-compose.ts"),
  ...turn(2, "s-1", 1, "step-one.ts"),
  ...turn(3, "s-plan-2", "composer", "second-compose.ts"),
]
/** Rows of a trak somebody read every gate of, with no library behind the marks. */
const rowsOf = (
  state: TrakStateDto,
  events: readonly EventDto[],
  p: PlanDto | undefined,
  turns: ReturnType<typeof splitTurns>,
  waiting?: WaitingDto,
) =>
  mapRows(
    state,
    events,
    p,
    turns,
    READ,
    [],
    waiting === undefined ? undefined : { at: waiting, now: NOW },
  )
const rows = rowsOf(working(3), log, recut, splitTurns(transcript, log))

describe("mapRows", () => {
  it("draws the plan in the order the engine wrote it", () => {
    expect(keys(rows)).toEqual(["compose:0", "step:1", "compose:2", "step:3"])
    expect(rows.map((r) => r.kind)).toEqual(["compose", "step", "recompose", "step"])
  })

  it("captions the first compose with the plan and a re-compose with why it was asked", () => {
    // Read off the entry, not inferred from the log: the engine wrote the reason down
    // when the run landed, so there is nothing here that can disagree with it.
    expect(rows[0]?.caption).toBe("Add a read-only client")
    expect(rows[2]?.caption).toBe("a Redis store · a limit")
  })

  it("hands each row its own turns and no other row's", () => {
    // Every composer turn stamps its lines `"composer"`, so anything asking for *the
    // composer's* turns gets all of them at once. This is what that cannot happen.
    const details = (key: string): readonly (string | undefined)[] =>
      rows
        .find((r) => r.key === key)
        ?.turns.flatMap((t) => t.entries)
        .filter((e) => e._tag === "Tool")
        .map((e) => e.detail) ?? []

    expect(details("compose:0")).toEqual(["first-compose.ts"])
    expect(details("compose:2")).toEqual(["second-compose.ts"])
    expect(details("step:1")).toEqual(["step-one.ts"])
  })

  it("always draws a composer row, even with no plan to draw", () => {
    const bare = rowsOf({ _tag: "Composing" }, [], undefined, [])
    expect(keys(bare)).toEqual(["compose:0"])
    expect(bare[0]?.caption).toBe("Working out what to do")
  })

  it("draws a compose the composer scheduled for itself, captioned with its own words", () => {
    // The one entry that is a row before it is a run. A compose that has landed is
    // never last — the steps it proposed follow it — so the last entry being one is
    // the composer's own re-cut, still to come, and it must not read as `done` off a
    // state that is describing somewhere else entirely.
    const stops = plan({ type: "compose" }, step("research"), {
      type: "compose",
      instruction: "one service or two, once the discovery lands",
    })
    const drawn = mapRows(working(1), [composed("s-plan")], stops, [], READ, [], undefined)
    expect(keys(drawn)).toEqual(["compose:0", "step:1", "compose:2"])
    expect(drawn[2]?.caption).toBe("one service or two, once the discovery lands")
    expect(drawn[2]?.status).toBe("todo")
  })

  it("stands the plan gate on the run that proposed it, not on the re-cut still to come", () => {
    // The whole of a first plan that stops short: the run that wrote it, its steps, and
    // the re-compose it scheduled for later. `DrawerPane` hangs the approval on the row
    // whose status is `gate`, so reading the state onto the entry nothing has run left a
    // trak that could not be approved from this surface at all.
    const stops = plan({ type: "compose" }, step("research"), {
      type: "compose",
      instruction: "one service or two, once the discovery lands",
    })
    const drawn = rowsOf({ _tag: "AwaitingProposal" }, [composed("s-plan")], stops, [])
    expect(drawn[0]?.status).toBe("gate")
    expect(drawn[2]?.status).toBe("todo")
  })

  it("draws the turn something asked for as the one running, before it has a line", () => {
    // The engine writes the entry when the ask is made, so the row is here for the
    // whole of the turn rather than appearing when it lands. Nothing else may read as
    // the live one meanwhile: an earlier compose that is `running` is the map saying
    // the trak went backwards.
    const asking = plan({ type: "compose" }, step("research"), {
      type: "compose",
      why: { _tag: "Replanned", step: 1, reason: "split this in two" },
    })
    const asked = [composed("s-plan"), returned(1, "s-1")]
    const drawn = rowsOf({ _tag: "Composing" }, asked, asking, [])
    expect(drawn[2]?.kind).toBe("recompose")
    expect(drawn[2]?.caption).toBe("split this in two")
    expect(drawn[2]?.status).toBe("running")
    expect(drawn[0]?.status).toBe("done")
  })

  /**
   * The ending, as a row with no plan entry behind it. It is a `MapRow` so that `focus`,
   * the bar and the map need no vocabulary for it — what it does not have is a
   * `StepStatus`, because that says how an *entry* went and this is not one.
   */
  it("puts the trak's ending on the end of the plan, once the plan has run out", () => {
    const kept = [...log, makeWorkCommitted({ step: 1, sha: "abc1234" })]
    const done = rowsOf({ _tag: "Finished" }, kept, recut, [])
    expect(keys(done)).toEqual(["compose:0", "step:1", "compose:2", "step:3", "end"])

    const end = done.at(-1)
    expect(end?.kind).toBe("end")
    expect(end?.status).toBeUndefined()
    // Its caption is the state's own words, straight off `trakLabel` — one place decides
    // what a finished trak is called.
    expect(end?.title).toBe("Finished")
    expect(end?.caption).toBe("Ready to merge")
    expect(end?.tone).toBe("waiting")
  })

  it("keeps the row after the ending, in the ending's own tone", () => {
    const merged = rowsOf({ _tag: "Merged", sha: "9f31c07" }, log, recut, []).at(-1)
    expect(merged?.title).toBe("Merged")
    expect(merged?.tone).toBe("neutral")
    // The merge commit, in the slot a step's own commit takes.
    expect(merged?.sha).toBe("9f31c07")

    const closed = rowsOf({ _tag: "Closed" }, log, recut, []).at(-1)
    expect(closed?.title).toBe("Closed")
    expect(closed?.tone).toBe("neutral")
    expect(closed?.sha).toBeUndefined()
  })

  it("draws no such row at a trak that was abandoned or that failed mid-plan", () => {
    for (const state of [
      { _tag: "Abandoned", reason: "changed my mind" },
      { _tag: "Failed", kind: "engine", error: "nope" },
      { _tag: "AgentWorking", step: 3 },
    ] as const) {
      expect(rowsOf(state, log, recut, []).some((r) => r.kind === "end")).toBe(false)
    }
  })

  it("still ends a trak whose composer never returned a plan", () => {
    // The placeholder row and the ending, which is the one shape the two branches of
    // `mapRows` could disagree about.
    expect(keys(rowsOf({ _tag: "Closed" }, [], undefined, []))).toEqual(["compose:0", "end"])
  })

  it("reports a step's commit, and that a composer run has none", () => {
    const kept = [...log, makeWorkCommitted({ step: 1, sha: "abc1234" })]
    const withSha = mapRows(working(3), kept, recut, [], READ, [], undefined)
    expect(withSha[0]?.sha).toBeUndefined()
    expect(withSha[1]?.sha).toBe("abc1234")
  })
})

describe("a recompose that raced what the step sent back", () => {
  it("captions the re-compose with both, the person's words first", () => {
    // The row is the one place the trak says both were asked: the reason a person
    // typed, then the requirement and the complaint the step filed, in the words each
    // reason already captions with on its own.
    const asking = plan({ type: "compose" }, step("research"), {
      type: "compose",
      why: {
        _tag: "Replanned",
        step: 1,
        reason: "split this in two",
        displaced: {
          _tag: "Raised",
          step: 1,
          requirements: ["a Redis store"],
          corrections: [{ at: "0-plan", text: "no offline case" }],
        },
      },
    })
    const drawn = rowsOf(
      { _tag: "Composing" },
      [composed("s-plan"), returned(1, "s-1")],
      asking,
      [],
    )
    expect(drawn[2]?.caption).toBe("split this in two · a Redis store · 0-plan: no offline case")
  })
})

describe("mapRows: a merge git refused", () => {
  const refused: TrakStateDto = { _tag: "Failed", kind: "merge", error: "exited 2" }

  it("ends the trak on a row captioned as refused, and opens there", () => {
    const kept = [...log, makeWorkCommitted({ step: 1, sha: "abc1234" })]
    const drawn = rowsOf(refused, kept, recut, [])
    const end = drawn.at(-1)
    expect(end?.kind).toBe("end")
    expect(end?.title).toBe("Finished")
    expect(end?.caption).toBe("merge refused")
    expect(end?.tone).toBe("bad")
    expect(opensAt(drawn, refused)).toBe(drawn.length - 1)
  })
})

/** The ending row carries the composer's hand-up; `finished.test.ts` covers reading it. */
describe("mapRows: what the ending row carries for the parent", () => {
  it("carries what the composer handed up on the ending row, and says so in the caption", () => {
    const handed = [
      ...log,
      makeComposerReturned({
        output: { type: "finished", reason: "done", handUp: "the icons need building first" },
      }),
    ]
    const end = rowsOf({ _tag: "Merged", sha: "9f31c07" }, handed, recut, []).at(-1)
    expect(end?.handUp).toBe("the icons need building first")
    // The deck below the seam draws the caption and no badge, so the words carry it there.
    expect(end?.caption).toBe("Merged · handed work up")
    // The title and the tone are the ending's own, untouched.
    expect(end?.title).toBe("Merged")
    expect(end?.tone).toBe("neutral")

    const quiet = rowsOf({ _tag: "Merged", sha: "9f31c07" }, log, recut, [])
    expect(quiet.at(-1)?.handUp).toBeUndefined()
    expect(quiet.at(-1)?.caption).toBe("Merged")
    expect(quiet.every((r) => r.kind === "end" || r.handUp === undefined)).toBe(true)
  })
})

/**
 * The one row built without a plan entry behind it, which is the branch above it in the
 * file and answers from nothing the others read. Its own describe for that: *no entries*
 * is not the empty end of a range the tests above walk, it is a separate return.
 */
/**
 * The ending row's caption is the state's words *and* the branch's, which is the one place
 * the map reads something off the log rather than off the state. It is what keeps the
 * caption under the step bar from saying *Ready to merge* over a pane saying there is
 * nothing to merge — the two are a hand's width apart on one screen.
 */
describe("mapRows, on a trak that ran its plan out having kept nothing", () => {
  it("reads the ending's caption off the branch as well as the state", () => {
    const end = rowsOf({ _tag: "Finished" }, log, recut, []).at(-1)
    expect(end?.title).toBe("Finished")
    expect(end?.caption).toBe("Finished — nothing to merge")
    expect(end?.tone).toBe("good")
  })
})

describe("mapRows, on a trak whose composer has not landed a plan", () => {
  it("hands that row the composer's turns, which such a trak still has", () => {
    // The composer's first run asked a question instead of proposing one: no entries, and
    // a whole turn behind them. The row was handed an empty list, which drew *Nothing has
    // run here yet* over a transcript that exists — and, because the question card rides
    // in a turn, left the composer's own gate with no form to answer it in.
    const asking = [makeComposerReturned({ sessionId: "s-plan", output: questions })]
    const lines = turn(1, "s-plan", "composer", "first-compose.ts")
    const bare = rowsOf(
      { _tag: "AwaitingComposerAnswers" },
      asking,
      undefined,
      splitTurns(lines, asking),
    )

    expect(keys(bare)).toEqual(["compose:0"])
    expect(bare[0]?.status).toBe("gate")
    expect(
      bare[0]?.turns
        .flatMap((t) => t.entries)
        .filter((e) => e._tag === "Tool")
        .map((e) => e.detail),
    ).toEqual(["first-compose.ts"])
  })
})

/**
 * The plan a composer that answered *the work is already done* leaves: its own entry
 * last, with nothing after it — which is exactly what an entry nobody has run yet looks
 * like. Its own describe because each assertion is a different predicate's, and none of
 * them is checked against the wire union.
 */
describe("mapRows, on a trak the composer brought to rest", () => {
  const ended: PlanDto = plan({ type: "compose" }, step("research"), {
    type: "compose",
    why: { _tag: "Reentered", what: "CI failed on main: the auth test is flaky" },
  })
  const endedLog: readonly EventDto[] = [
    composed("s-plan"),
    returned(1, "s-1"),
    makeComposerReturned({
      sessionId: "s-plan-2",
      output: { type: "finished", reason: "the flaky test is main's own" },
    }),
  ]
  const endedTurns = [
    ...turn(1, "s-plan", "composer"),
    ...turn(2, "s-1", 1),
    ...turn(3, "s-plan-2", "composer"),
  ]

  it("draws the run that ended it as one that happened, not one still to come", () => {
    const drawn = rowsOf({ _tag: "Finished" }, endedLog, ended, splitTurns(endedTurns, endedLog))
    // Nothing still to come: the ending follows the entry that ended it.
    expect(keys(drawn)).toEqual(["compose:0", "step:1", "compose:2", "end"])
    expect(drawn[2]?.status).toBe("done")
    // And it is handed its own run rather than the first compose's.
    expect(drawn[2]?.turns.map((t) => t.session)).toEqual(["s-plan-2"])
  })
})

describe("mapRows, on the mark each row wears", () => {
  it("marks a step with its own agent's glyph, and a spawn with the split", () => {
    // The whole of what the row's `mark` is for, and the two halves of the rule:
    // an agent takes its own, and a spawn cannot take one — it names as many agents as it
    // has pieces, so picking the first would be a claim about the others.
    //
    // `unblock` is here because it is one of the two a person cannot start a trak with:
    // the route used to send only the startable ones, so a plan running it had no icon
    // any surface could reach and it drew the fallback.
    const agents = [
      makeAgent({ name: "build", icon: "blocks" }),
      makeAgent({ name: "unblock", icon: "life-buoy", start: false }),
    ]
    const drawn = mapRows(
      working(1),
      [composed("s-plan")],
      plan({ type: "compose" }, step("build"), step("unblock"), spawnOf("review", "review")),
      [],
      READ,
      agents,
      undefined,
    )

    expect(drawn.map((r) => r.mark)).toEqual([
      ListTree,
      glyphFor("blocks"),
      glyphFor("life-buoy"),
      Split,
    ])
  })

  it("marks a step whose agent the library does not hold without inventing one", () => {
    // Three absences that mean the same thing — the query is out, the plan names an agent
    // the library no longer holds, the icon is a typo — and one answer for all of them.
    const drawn = mapRows(
      working(1),
      [composed("s-plan")],
      plan(step("build")),
      [],
      READ,
      [],
      undefined,
    )
    expect(drawn[0]?.mark).toBe(glyphFor(undefined))
  })
})

describe("mapRows, on a re-entry that carries more than a sentence", () => {
  /**
   * **The first line, which is the sentence a person wrote.** A re-entry sent from the
   * finished pane's pull-request half is composed — the sentence, then a block per ticked
   * thing with its text quoted verbatim — so drawing it whole put a `>` quoted review
   * comment and a check's link into a caption that is one line by construction.
   */
  it("captions a re-entry with its first line, however long the body is", () => {
    const body = [
      "Fix the checks and address the comment.",
      "",
      "The verify check is failing on pull request #41.",
      "https://github.com/o/r/actions/runs/9",
      "",
      "reviewer left a comment on pull request #41.",
      "client/src/features/trak-detail/controls.ts:41",
      "> This composes outside the switch, doesn't it?",
    ].join("\n")
    const asking = plan({ type: "compose" }, step("build"), {
      type: "compose",
      why: { _tag: "Reentered", what: body },
    })
    const drawn = rowsOf(
      { _tag: "Composing" },
      [composed("s-plan"), returned(1, "s-1")],
      asking,
      [],
    )

    expect(drawn[2]?.caption).toBe("Fix the checks and address the comment.")
  })
})

describe("mapRows, on which rows nobody read", () => {
  const fix: MarkDto = { _tag: "Uneventful", at: 3, ambiguity: "none" }
  /** The re-cut that planned the fix, on its own account — the plan gate asks about it. */
  const recut2: MarkDto = { _tag: "Mode", at: 2 }

  it("marks the entry the wire named, and no other", () => {
    // The plan ran out: `build` returned, which `Finished` no longer says on its own.
    const ran = [...log, returned(3, "s-3")]
    const drawn = mapRows(
      { _tag: "Finished" },
      ran,
      recut,
      splitTurns(transcript, ran),
      [fix, recut2],
      [],
      undefined,
    )
    expect(drawn.slice(0, 4).map((r) => r.atGate?._tag)).toEqual([
      undefined,
      undefined,
      "Mode",
      "Uneventful",
    ])
    expect(drawn[3]?.atGate).toBe(fix)
  })

  it("marks nothing at all where the trak stood at every gate", () => {
    expect(rows.every((r) => r.atGate === undefined)).toBe(true)
  })

  /**
   * The half of the fact the wire cannot answer. The rule takes the gate in front of every
   * entry on `auto`, including entries nothing has run — and a mark there would say a
   * person was skipped before anything existed for them to read.
   */
  it("leaves a row the trak has not got past unmarked, whatever the rule says", () => {
    const everything: readonly MarkDto[] = [0, 1, 2, 3].map((at) => ({ _tag: "Mode", at }))
    const drawn = mapRows(
      working(3),
      log,
      recut,
      splitTurns(transcript, log),
      everything,
      [],
      undefined,
    )
    // Row 3 is the one the trak is standing at and reads `running`; the three behind it
    // are `done`.
    expect(drawn.map((r) => r.status)).toEqual(["done", "done", "done", "running"])
    expect(drawn.map((r) => r.atGate !== undefined)).toEqual([true, true, true, false])
  })

  it("never marks the ending, which has no gate anybody could have been asked at", () => {
    const everything: readonly MarkDto[] = [-1, 0, 1, 2, 3].map((at) => ({
      _tag: "Mode",
      at,
    }))
    const drawn = mapRows({ _tag: "Finished" }, log, recut, [], everything, [], undefined)
    expect(drawn.at(-1)?.kind).toBe("end")
    expect(drawn.at(-1)?.atGate).toBeUndefined()
  })
})

/**
 * The third fact, and the one the wire cannot give. `auto` takes the plan gate and a filed
 * artifact's approval gate and no others, so an unattended trak still parks at four — and
 * a document a person read and approved at one of them was drawn as one nobody read, with
 * the map's bolt against it.
 *
 * Every case is `Finished` with every entry warranted, which is what `auto` reports: what
 * differs between them is the log alone, so each says exactly which press changes the
 * answer and which does not.
 */
describe("mapRows, on a gate a person actually stood at", () => {
  const all: readonly MarkDto[] = [0, 1, 2, 3].map((at) => ({ _tag: "Mode", at }))
  // `build` returned last in every case: a plan that has run out has a log that says so.
  const marks = (events: readonly EventDto[]): readonly boolean[] =>
    mapRows(
      { _tag: "Finished" },
      [...events, returned(3, "s-3")],
      recut,
      [],
      all,
      [],
      undefined,
    ).map((r) => r.atGate !== undefined)

  it("draws no mark where a person approved at a failing-checks gate", () => {
    expect(
      marks([composed("s-plan"), makeCheckFailed({ step: 1 }), approved(1), composed("s-plan-2")]),
    ).toEqual([true, false, true, true, false])
  })

  it("draws no mark where a person skipped a step that gave up", () => {
    expect(
      marks([
        composed("s-plan"),
        returned(1, "s-1"),
        composed("s-plan-2"),
        filed(3, "stuck"),
        skipped(3),
      ]),
    ).toEqual([true, true, true, false, false])
  })

  it("draws no mark on the compose whose plan a person approved", () => {
    // The plan gate records a nominal `step: 0`, and the entry it lets through is the one
    // after — so this is the compose row's own mark, and the step's is untouched.
    expect(
      marks([composed("s-plan"), approved(0), returned(1, "s-1"), composed("s-plan-2")]),
    ).toEqual([false, true, true, true, false])
  })

  it("keeps the mark where a person only talked, which takes no gate", () => {
    // A prose reply hands back the same gate with the same press still on offer, so
    // somebody who argued and then let the step re-file has approved nothing.
    expect(
      marks([
        composed("s-plan"),
        makeCheckFailed({ step: 1 }),
        said(1, "try the other route"),
        returned(1, "s-1"),
        composed("s-plan-2"),
      ]),
    ).toEqual([true, true, true, true, false])
  })

  it("keeps the mark where a person only answered a step's questions", () => {
    // The answers settle a *question*; the approval gate that followed really was the
    // engine's. This is the case that makes *a person touched this position* the wrong
    // fact to ask for.
    expect(
      marks([
        composed("s-plan"),
        filed(1, "questions"),
        answered(1),
        returned(1, "s-1"),
        composed("s-plan-2"),
      ]),
    ).toEqual([true, true, true, true, false])
  })

  it("follows the gate a stop opens, at both ends", () => {
    // A stopped re-compose parks at the plan gate, which no `ComposerReturned` opened —
    // so the approval there belongs to the compose entry and not to the step that
    // returned last, whose mark it used to blank.
    expect(marks([composed("s-plan"), returned(1, "s-1"), makeStopped(), approved(0)])).toEqual([
      true,
      true,
      false,
      true,
      false,
    ])
    // The mirror: a stopped turn parks at its step's own gate, which offers `Skip`. The
    // composer's gate is closed by then and must not swallow the press.
    expect(
      marks([composed("s-plan"), makeStopped({ step: 1 }), skipped(1), composed("s-plan-2")]),
    ).toEqual([true, false, true, true, false])
  })

  it("keeps every mark where a person only answered the composer", () => {
    // A composer gate records the same nominal `step: 0`, so reading that number alone
    // would blank the mark on plan entry zero because somebody answered a question.
    expect(
      marks([
        makeComposerReturned({ sessionId: "s-plan", output: { type: "questions", questions: [] } }),
        answered(0),
        composed("s-plan"),
        returned(1, "s-1"),
        composed("s-plan-2"),
      ]),
    ).toEqual([true, true, true, true, false])
  })
})

describe("opensAt", () => {
  it("points at where the trak is, at the newest composer run, and at the work it finished", () => {
    // Which of those three applies is the whole of this projection; where the *family*
    // map then stands is `family.test.ts`, because a spawn's band has no row of its own.
    expect(opensAt(rows, working(3))).toBe(3)
    expect(opensAt(rows, { _tag: "Composing" })).toBe(2)
    expect(opensAt(rows, { _tag: "Finished" })).toBe(3)
  })

  /**
   * Not the last step. Once the plan has run out the position with something to ask is the
   * ending — the last entry is a step that finished, and there is nothing to do there.
   * Where the arrows reach it from is `family.test.ts`, which owns the walk.
   */
  it("opens on the ending once the plan has run out", () => {
    const done = rowsOf({ _tag: "Finished" }, log, recut, [])
    expect(done[opensAt(done, { _tag: "Finished" })]?.key).toBe("end")
  })

  it("opens on the run holding the plan, not on the re-cut it scheduled for later", () => {
    const stops = plan({ type: "compose" }, step("research"), {
      type: "compose",
      instruction: "one service or two, once the discovery lands",
    })
    const drawn = rowsOf({ _tag: "AwaitingProposal" }, [composed("s-plan")], stops, [])
    expect(opensAt(drawn, { _tag: "AwaitingProposal" })).toBe(0)
  })

  it("points at the turn something asked for as soon as the entry exists", () => {
    const asking = plan({ type: "compose" }, step("research"), {
      type: "compose",
      why: { _tag: "Replanned", step: 1, reason: "split this in two" },
    })
    const drawn = rowsOf(
      { _tag: "Composing" },
      [composed("s-plan"), returned(1, "s-1")],
      asking,
      [],
    )
    expect(opensAt(drawn, { _tag: "Composing" })).toBe(2)
  })

  it("opens a failed trak on the entry it died at, not on the last one in the plan", () => {
    // `Failed` carries no step, so this fell through to *the last step row* — and a trak
    // that stopped at step 1 of 5 opened on step 4, with the explanation and its restart
    // drawn against a position nothing had run at.
    const died: TrakStateDto = { _tag: "Failed", kind: "provider", error: "connection closed" }
    const drawn = rowsOf(
      died,
      [composed("s-plan"), makeTurnFailed({ step: 1, reason: "connection closed" })],
      plan({ type: "compose" }, step("research"), step("build")),
      [],
    )
    expect(drawn[opensAt(drawn, died)]?.key).toBe("step:1")
  })

  it("leaves a failure that blames no entry where the plan left off", () => {
    // A `worktree` or `engine` failure names no position — `failedStep` reaches none of
    // its three events — so there is no row reading `failed` and nothing to point at.
    const died: TrakStateDto = { _tag: "Failed", kind: "worktree", error: "fatal: exists" }
    const drawn = rowsOf(
      died,
      [composed("s-plan")],
      plan({ type: "compose" }, step("research")),
      [],
    )
    expect(drawn[opensAt(drawn, died)]?.key).toBe("step:1")
  })

  it("opens a trak whose archive failed on its ending, not on the last step it ran", () => {
    // The plan ran out and a person pressed Close, so `Closed` is on the log and the trak
    // was `Closing` when `runTeardown` wrote `WorktreeFailed`. The failure blames no entry,
    // so this fell through to the last step row: the notice and its restart were drawn on
    // a step that had finished cleanly, against that step's turns.
    const died: TrakStateDto = {
      _tag: "Failed",
      kind: "archive",
      archiving: "closed",
      error: "teardown failed in /repo/.orkestra/.worktrees/x:\ndatabase is in use",
    }
    const drawn = rowsOf(
      died,
      [
        ...log,
        returned(3, "s-3"),
        makeWorkCommitted({ sha: "abc1234" }),
        { _tag: "Closed" },
        { _tag: "WorktreeFailed", reason: died.error },
      ],
      recut,
      [],
    )
    expect(drawn[opensAt(drawn, died)]?.key).toBe("end")
  })

  it("opens an abandon whose archive failed on an ending titled for the abandon", () => {
    // The plan did not run out — step 3 never ran — so the ending row is the only place
    // the press that abandoned it was made, and it must not read *Finished*.
    const died: TrakStateDto = {
      _tag: "Failed",
      kind: "archive",
      archiving: "abandoned",
      error: "teardown failed in /repo/.orkestra/.worktrees/x:\ndatabase is in use",
    }
    const drawn = rowsOf(
      died,
      [
        ...log,
        { _tag: "Abandoned", reason: "not needed" },
        { _tag: "WorktreeFailed", reason: died.error },
      ],
      recut,
      [],
    )
    const opened = drawn[opensAt(drawn, died)]
    expect(opened?.key).toBe("end")
    expect(opened?.title).toBe("Abandoned")
  })
})

/**
 * The other outcome from the marks above, read the same way: straight off the wire.
 * Which entry a hold was spent at is the engine's to say — an entry a hold held and one
 * the mode took look alike from the log — so nothing here walks the log for it.
 */
describe("mapRows, on an entry a hold held until it was accepted", () => {
  const two = plan({ type: "compose" }, step("research"), step("build"))
  const heldRows = (held: readonly number[], state: TrakStateDto = { _tag: "Finished" }) =>
    mapRows(
      state,
      [composed("s-plan"), returned(1, "s-1"), returned(2, "s-2")],
      two,
      [],
      held.map((at) => ({ _tag: "Held", at })),
      [],
      undefined,
    ).map((r) => r.atGate?._tag === "Held")

  it("marks the entry the wire named, and no other", () => {
    expect(heldRows([1])).toEqual([false, true, false, false])
  })

  it("marks the gate a reader is standing at, not only the ones behind", () => {
    expect(heldRows([1], { _tag: "AwaitingHuman", step: 1, kind: "approval" })).toEqual([
      false,
      true,
      false,
    ])
  })

  it("leaves a row the trak has not reached unmarked, whatever the wire says", () => {
    expect(heldRows([2], { _tag: "AgentWorking", step: 2 })).toEqual([false, false, false])
  })

  it("never marks the ending, which has no entry behind it", () => {
    const drawn = mapRows(
      { _tag: "Finished" },
      [],
      two,
      [],
      [{ _tag: "Held", at: -1 }],
      [],
      undefined,
    )
    expect(drawn.at(-1)?.kind).toBe("end")
    expect(drawn.at(-1)?.atGate).toBeUndefined()
  })

  it("keeps the mark where the person then approved, which is how a hold ordinarily ends", () => {
    // The third fact subtracts the *engine's* marks on a gate a person took, and a hold
    // is the person's own press — standing at the gate and then approving is the whole
    // point of pressing Hold, so the band has to survive it. Now that both outcomes are
    // one union on one map, the only thing keeping the two apart is the `_tag` test in
    // `marksBy`, and without this nothing fails when it goes.
    const drawn = mapRows(
      { _tag: "Finished" },
      [composed("s-plan"), returned(1, "s-1"), approved(1), returned(2, "s-2")],
      two,
      [],
      [{ _tag: "Held", at: 1 }],
      [],
      undefined,
    )
    expect(drawn.map((r) => r.atGate?._tag === "Held")).toEqual([false, true, false, false])
  })
})

/** A level the engine stored for a position: the set of background tasks alive at `at`. */
const level = (position: number, at: number, ...ids: string[]): TranscriptEntryDto =>
  makeBackground({ position, at, tasks: ids.map((id) => ({ id })) })

describe("mapRows, on the background work a position holds open", () => {
  it("counts the newest turn's level and never an earlier turn's", () => {
    // A turn killed with `dead-1` outstanding, then the position resumed on a turn that
    // backgrounds nothing — and emits no level at all, so nothing supersedes the first.
    const stops = [composed("s-plan"), returned(1, "s-1"), returned(1, "s-1b")]
    const lines = [
      ...turn(1, "s-plan", "composer"),
      ...turn(2, "s-1", 1),
      level(1, 3, "dead-1"),
      ...turn(4, "s-1b", 1, "again.ts"),
    ]
    const drawn = rowsOf(
      working(1),
      stops,
      plan({ type: "compose" }, step("build")),
      splitTurns(lines, stops),
    )
    expect(drawn.map((r) => r.outstanding)).toEqual([0, 0])
  })

  it("counts what the newest turn itself left running", () => {
    const stops = [composed("s-plan"), returned(1, "s-1")]
    const lines = [...turn(1, "s-plan", "composer"), ...turn(2, "s-1", 1), level(1, 3, "b1", "b2")]
    const drawn = rowsOf(
      working(1),
      stops,
      plan({ type: "compose" }, step("build")),
      splitTurns(lines, stops),
    )
    expect(drawn.map((r) => r.outstanding)).toEqual([0, 2])
  })
})

describe("continues", () => {
  /** A step told to pick the experiment's conversation up, as the composer writes it. */
  const joined = plan(
    { type: "compose" },
    step("experiment"),
    makeAgentStep({ agent: "experiment", instruction: "correct it", continues: "1-experiment" }),
  )
  const ran = [composed("s-plan"), returned(1, "s-1")]

  it("resolves to the position whose session this one's turn is in — the splice", () => {
    const drawn = rowsOf(
      working(2),
      ran,
      joined,
      splitTurns(
        [
          ...turn(1, "s-plan", "composer"),
          ...turn(2, "s-1", 1, "one.ts"),
          // The same session at a second position — `--resume`, as the transcript
          // records it.
          ...turn(3, "s-1", 2, "two.ts"),
        ],
        ran,
      ),
    )
    expect(drawn[2]?.continues).toEqual({ key: "1-experiment", to: "step:1", fresh: false })
    // The position that owns the conversation carries no marker: it continues nothing.
    expect(drawn[1]?.continues).toBeUndefined()
  })

  it("claims nothing while the step has no session to compare", () => {
    const drawn = rowsOf(
      working(2),
      ran,
      joined,
      splitTurns([...turn(1, "s-plan", "composer"), ...turn(2, "s-1", 1)], ran),
    )
    expect(drawn[2]?.continues).toEqual({ key: "1-experiment", to: undefined, fresh: false })
  })

  it("reads a step that ran under its own session as fresh, whatever the key names", () => {
    // The entry the key names is real and its row is on the map — it just never ran, so
    // there was no conversation to join and the engine started fresh. The wrong-string
    // and spawn keys below read the same way, which mirrors the engine's `sessionOf`.
    const forward = plan(
      { type: "compose" },
      makeAgentStep({ agent: "build", instruction: "build it", continues: "2-verify" }),
      step("verify"),
    )
    const events = [composed("s-plan")]
    const drawn = rowsOf(
      working(1),
      events,
      forward,
      splitTurns([...turn(1, "s-plan", "composer"), ...turn(2, "s-1", 1)], events),
    )
    expect(drawn[2]?.key).toBe("step:2")
    expect(drawn[1]?.continues).toEqual({ key: "2-verify", to: undefined, fresh: true })
  })

  it("reads a key naming a spawn as fresh — its position holds no conversation", () => {
    const overSpawn = plan(
      { type: "compose" },
      spawnOf("a", "b"),
      makeAgentStep({ agent: "build", instruction: "build it", continues: "1-spawn" }),
    )
    const events = [composed("s-plan")]
    const drawn = rowsOf(
      working(2),
      events,
      overSpawn,
      splitTurns([...turn(1, "s-plan", "composer"), ...turn(2, "s-2", 2)], events),
    )
    expect(drawn[2]?.continues).toEqual({ key: "1-spawn", to: undefined, fresh: true })
  })
})

describe("mapRows, on a trak parked at a wait", () => {
  /** compose · four steps, the last two never reached: the trak is held at step 3. */
  const five = plan(
    { type: "compose" },
    step("research"),
    step("build"),
    step("operator"),
    step("review"),
  )
  const ranTwo = [
    composed("s-plan"),
    returned(1, "s-1"),
    returned(2, "s-2"),
    makeWorkCommitted({ step: 2, sha: "abc1234" }),
  ]
  const deployed = makeWaiting({ step: 3, name: "deployed" })
  const parked = rowsOf({ _tag: "Finished" }, ranTwo, five, [], deployed)

  it("stands the ending before the entry the wait holds, and leaves the tail unrun", () => {
    // It was appended after `review`, with both unrun steps green under it.
    expect(keys(parked)).toEqual(["compose:0", "step:1", "step:2", "end", "step:3", "step:4"])
    expect(parked.map((r) => r.status)).toEqual(["done", "done", "done", undefined, "todo", "todo"])
  })

  it("rewords the ending as held, in the wait's own words, in the wait's tone", () => {
    const end = parked[3]
    expect(end?.kind).toBe("end")
    expect(end?.title).toBe("Held")
    expect(end?.caption).toBe("held on deployed")
    // `working`, not `trakLabel`'s: that answers `good` for a trak with nothing to merge,
    // which drew a green Held row over entries nothing had reached.
    expect(end?.tone).toBe("working")
    const uncommitted = rowsOf(
      { _tag: "Finished" },
      [composed("s-plan"), returned(1, "s-1")],
      five,
      [],
      deployed,
    )
    expect(uncommitted[3]?.tone).toBe("working")
    expect(end?.mark).toBe(Flag)
    expect(end?.waiting).toEqual(deployed)
  })

  it("badges the held entry with the wait's glyph and tone, and no other row", () => {
    expect(parked.map((r) => r.badge !== undefined)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ])
    expect(parked[4]?.badge).toEqual({
      glyph: CircleDashed,
      tone: "working",
      says: "held — deployed is not met yet",
    })
  })

  it("words a clock as the instant, read against now", () => {
    const six = new Date(2026, 8, 18, 6, 0).getTime()
    const clock = makeWaiting({ step: 3, name: "wait_until", until: six })
    const drawn = rowsOf({ _tag: "Finished" }, ranTwo, five, [], clock)
    expect(drawn[3]?.caption).toBe("held on 06:00 tomorrow")
    expect(drawn[4]?.badge).toEqual({
      glyph: AlarmClock,
      tone: "working",
      says: "held — 06:00 tomorrow is when the step runs",
    })
  })

  /**
   * `bad`, not the neutral this first shipped with: a wait that has stopped asking reads
   * *Gave up* in `bad` everywhere it is drawn, and the ending row and the badge take
   * `waitTone`'s answer rather than one of their own.
   */
  it("goes bad where the condition gave up, as every other surface draws one", () => {
    const gaveUp = makeWaiting({ step: 3, name: "staging-ready", stopped: true })
    const drawn = rowsOf({ _tag: "Finished" }, ranTwo, five, [], gaveUp)
    expect(drawn[3]?.tone).toBe("bad")
    expect(drawn[4]?.badge).toEqual({
      glyph: CircleMinus,
      tone: "bad",
      says: "held — staging-ready gave up — will not be asked again",
    })
  })

  it("opens on the ending where it stands, not at the foot", () => {
    expect(opensAt(parked, { _tag: "Finished" })).toBe(3)
  })

  it("puts an ending the plan cannot place at the foot, rather than dropping it", () => {
    const stale = makeWaiting({ step: 9, name: "deployed" })
    expect(keys(rowsOf({ _tag: "Finished" }, ranTwo, five, [], stale)).at(-1)).toBe("end")
  })

  it("leaves a trak with no wait exactly as it was", () => {
    const drawn = rowsOf({ _tag: "Finished" }, ranTwo, five, [])
    expect(keys(drawn).at(-1)).toBe("end")
    expect(drawn.at(-1)?.title).toBe("Finished")
    expect(drawn.at(-1)?.waiting).toBeUndefined()
  })
})

describe("mapRows, on the compose entry a step's raised work bought", () => {
  /** What the engine writes at the step's own gate: the ask stands in the plan, unrun. */
  const bought = plan(
    { type: "compose" },
    step("plan"),
    {
      type: "compose",
      why: {
        _tag: "Raised",
        step: 1,
        requirements: ["the footer wants designing first"],
        corrections: [],
      },
    },
    step("work"),
  )
  const atGate: TrakStateDto = { _tag: "AwaitingHuman", step: 1, kind: "approval" }
  const drawn = rowsOf(atGate, [composed("s-plan"), returned(1, "s-1")], bought, [])

  it("draws the ask as not started while the person is still at the step's gate", () => {
    // It read `done` off the first compose having landed — green, before anyone had
    // decided to buy the turn. The gate stays on the step, which is what `DrawerPane`
    // hangs the approval on.
    expect(drawn.map((r) => r.status)).toEqual(["done", "gate", "todo", "todo"])
  })

  it("marks the ask apart from a re-cut the composer scheduled — same plate, same word", () => {
    expect(drawn[2]?.title).toBe("re-compose")
    expect(drawn[2]?.mark).toBe(ListRestart)
    expect(drawn[2]?.badge).toEqual({
      glyph: Hand,
      tone: "waiting",
      says: "something asked for this",
    })
    const scheduled = rowsOf(
      working(1),
      [composed("s-plan")],
      plan({ type: "compose" }, step("research"), { type: "compose", instruction: "re-cut" }),
      [],
    )
    expect(scheduled[2]?.badge).toBeUndefined()
  })
})
