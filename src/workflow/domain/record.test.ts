// Pure tier: a log in, a record out. No store, no clock, no engine.

import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { SessionId } from "../../agent/types/session.js"
import type { Usage } from "../../agent/types/usage.js"
import { BranchName, CommitSha, WorktreePath } from "../../vcs/index.js"
import { type Event, Events, type Landed, stamped } from "./event.js"
import { Actions } from "./human-action.js"
import { Artifact, artifact } from "./outputs/artifact.js"
import { stuck } from "./outputs/stuck.js"
import { proposal } from "./outputs/proposal.js"
import {
  keptInCorpus,
  record,
  recordFiles,
  recordText,
  relatedTraks,
  type Related,
} from "./record.js"
import { replayHistory } from "./replay.js"
import { TrakId } from "./trak.js"

const id = TrakId.make("t1")
const sid = SessionId.make("00000000-0000-4000-8000-000000000001")

const plan = proposal("A JSON flag for the list command", [
  { agent: "discovery", instruction: "Plan it." },
  { agent: "build", instruction: "Do it." },
])

const worktree = {
  path: WorktreePath.make("/tmp/wt"),
  branch: BranchName.make("trak/t1"),
  base: CommitSha.make("base000"),
}

const spend = (costUsd: number, tools: Record<string, number> = {}): Usage => ({
  inputTokens: 2,
  outputTokens: 100,
  cacheReadTokens: 30_000,
  cacheWriteTokens: 4000,
  costUsd,
  tools,
})

/**
 * A trak that went the ordinary way, as *seconds from the start* paired with what
 * happened — so the arithmetic the tests assert reads off the page, and the same
 * list can be replayed with the times taken off.
 *
 * The two things a record exists for are in it: a human who typed instead of
 * approving, and a step that had to run twice.
 */
const turns: readonly (readonly [number, Event])[] = [
  [0, Events.trakCreated("Add a --json flag")],
  [1, Events.worktreeReady(worktree)],
  [5, Events.composerReturned(sid, plan, spend(0.2, { Read: 3 }))],
  [65, Events.humanActed(1, Actions.chat("smaller please"))],
  [70, Events.composerReturned(sid, plan, spend(0.1))],
  [80, Events.humanActed(1, Actions.approve())],
  [110, Events.agentReturned(1, sid, artifact({ Summary: "found it" }), spend(0.5, { Read: 10 }))],
  [115, Events.checksPassed(1, ["verify"])],
  [175, Events.humanActed(1, Actions.approve())],
  // Approving keeps step 0's own work before step 1 starts — see `keepStep` in
  // decide.ts — and this commit is step-less on purpose: the fixture is not
  // about the new per-step attribution, so it stays out of `stepOf`'s reach the
  // way the tail's own catch-all commit always has.
  [175, Events.workCommitted(undefined)],
  // Its effects run at the same boundary, and this fixture's agents declare none.
  [175, Events.effectsRan(1, [])],
  [200, Events.agentReturned(2, sid, artifact({ Summary: "v1" }), spend(1.5, { Grep: 40 }))],
  [205, Events.checkFailed(2, "verify", "2 problems")],
  [230, Events.agentReturned(2, sid, artifact({ Summary: "v2" }), spend(0.7, { Grep: 2 }))],
  [232, Events.checksPassed(2, [])],
  [240, Events.humanActed(2, Actions.approve())],
  // Stamped with its step, unlike step 0's — this is the one commit in the fixture
  // that per-step attribution actually has to place, and the second below it lands
  // on step 1's own account rather than falling into overhead.
  [241, Events.workCommitted(undefined, 2)], // step 1's own work kept
  [241, Events.effectsRan(2, [])], // and its effects run, of which it declares none
  [245, Events.workCommitted(CommitSha.make("abc1234"))], // Integrating's catch-all, what settles Finished
]

const history: readonly Event[] = turns.map(([seconds, e]) => stamped(e, seconds * 1000))
const at = (seconds: number, e: Event): Event => stamped(e, seconds * 1000)

/**
 * The same trak, merged — which is the only shape that reaches the corpus.
 *
 * `at` is seconds from an epoch of zero, so the merge lands on 1970-01-01 and the
 * folder's day is a value a test can write down. The hour between the ending and
 * the merge is the branch sitting there waiting for a person.
 */
const landed: readonly Event[] = [
  ...history,
  // An hour before the `Merged`, which is a person deciding and not the engine
  // working — the gap that used to be counted as an hour of work costing nothing.
  at(3600, Events.merged()),
  at(3605, Events.workMerged(CommitSha.make("abc1234"))),
  at(3610, Events.worktreeRemoved()),
]

/** What a step sent back files twice: the same artifact, requirements and all. */
const filedTwice = artifact(
  { Summary: "done" },
  [{ text: "the admin view is out of scope", source: "stated" }],
  [{ at: "0-discovery", text: "no offline case" }],
)

// ---------------------------------------------------------------- a spawn

const kidA = TrakId.make("kid-a")
const kidB = TrakId.make("kid-b")

const splitPlan = proposal("A JSON flag for the list command", [
  { agent: "discovery", instruction: "Plan it." },
  {
    type: "spawn",
    instruction: "Two lenses.",
    children: [
      { agent: "review", instruction: "Look at the schema." },
      { agent: "review", instruction: "Look at the output." },
    ],
  },
])

const branchOf = (kid: TrakId): BranchName => BranchName.make(`trak/${kid}`)

/** One child coming back with its branch in and nothing to say about it. */
const landing = (child: number, kid: TrakId): Landed => ({
  step: 2,
  child,
  id: kid,
  branch: branchOf(kid),
  sha: CommitSha.make("kid0000"),
  artifacts: [],
  decisions: [],
  handUp: undefined,
})

/** A parent whose one spawn position broke into two children, both landed. */
const spawnHistory: readonly Event[] = [
  at(0, Events.trakCreated("Add a --json flag")),
  at(1, Events.worktreeReady(worktree)),
  at(2, Events.composerReturned(sid, splitPlan, spend(0.2))),
  at(3, Events.humanActed(1, Actions.approve())),
  at(10, Events.agentReturned(1, sid, artifact({ Summary: "found it" }))),
  at(20, Events.humanActed(1, Actions.approve())),
  at(20, Events.childrenSpawned(2, [kidA, kidB])),
  // Ten seconds of the parent's own wall clock, with both children inside it.
  at(30, Events.childLanded(landing(0, kidA))),
  at(30, Events.childLanded(landing(1, kidB))),
]

/** One child, born holding its parent's requirements, filing plainly and merging. */
const childHistory: readonly Event[] = [
  at(
    0,
    Events.trakCreated("Add a --json flag", {
      parent: { id, step: 1, child: 0, depth: 1 },
      plan: proposal("Look at the schema.", [
        { agent: "review", instruction: "Look at the schema." },
      ]),
      decisions: [{ text: "the admin view is out of scope", source: "stated", at: "1-discovery" }],
      base: undefined,
      artifacts: [],
      split: {
        instruction: "two halves",
        pieces: [
          { name: "1.0-review", instruction: "Look at the schema." },
          { name: "1.1-review", instruction: "Look at the client." },
        ],
      },
    }),
  ),
  at(1, Events.worktreeReady({ ...worktree, branch: branchOf(kidA) })),
  at(10, Events.agentReturned(0, sid, artifact({ Summary: "flat" }), spend(1.5))),
  at(15, Events.checksPassed(0, [])),
  at(20, Events.humanActed(0, Actions.approve())),
  at(21, Events.workCommitted(undefined, 0)), // the step's own work kept
  at(21, Events.effectsRan(0, [])), // and its effects, of which it declares none
  at(22, Events.workCommitted(CommitSha.make("kid0000"))), // Integrating's, settling Finished
  at(25, Events.merged()),
  at(26, Events.workMerged(CommitSha.make("kid0000"))),
  at(27, Events.worktreeRemoved()),
]

/** The same, spending what the roll-up has to find. */
const childBHistory: readonly Event[] = childHistory.map((e) =>
  e._tag === "AgentReturned"
    ? at(10, Events.agentReturned(0, sid, artifact({ Summary: "wide" }), spend(1.5)))
    : e,
)

/**
 * The same child, having also settled something of its own.
 *
 * It stops at the plan gate rather than merging, and that is the point: a requirement
 * sends the plan back to the composer at the commit boundary, so a child that files one
 * has a round to run before it can come to rest. What a record says about a trak's own
 * channel does not wait for that.
 */
const childSettled: readonly Event[] = [
  ...childHistory.slice(0, 2),
  at(
    10,
    Events.agentReturned(
      0,
      sid,
      artifact({ Summary: "flat" }, [{ text: "the schema stays flat", source: "assumed" }]),
      spend(1.5),
    ),
  ),
]

const kids: Related = new Map([
  [kidA, childHistory],
  [kidB, childBHistory],
])

// ------------------------------------------- the three ways a child can end

const kidC = TrakId.make("kid-c")

const threePlan = proposal("A JSON flag for the list command", [
  { agent: "discovery", instruction: "Plan it." },
  {
    type: "spawn",
    instruction: "Three lenses.",
    children: [
      { agent: "review", instruction: "Look at the schema." },
      { agent: "review", instruction: "Look at the output." },
      { agent: "review", instruction: "Look at the errors." },
    ],
  },
])

/**
 * A spawn whose children ended the three ways they can: one merged, one dropped by
 * a person, one still going.
 *
 * A drop is a landing with no sha — `landOnParent` files exactly that for a child
 * somebody closed — and a child still going has no landing at all.
 */
const threeWays: readonly Event[] = [
  at(0, Events.trakCreated("Add a --json flag")),
  at(1, Events.worktreeReady(worktree)),
  at(2, Events.composerReturned(sid, threePlan, spend(0.2))),
  at(3, Events.humanActed(1, Actions.approve())),
  at(10, Events.agentReturned(1, sid, artifact({ Summary: "found it" }))),
  at(20, Events.humanActed(1, Actions.approve())),
  at(20, Events.childrenSpawned(2, [kidA, kidB, kidC])),
  at(30, Events.childLanded(landing(0, kidA))),
  at(30, Events.childLanded({ ...landing(1, kidB), sha: undefined })),
]

/** The dropped child's own log: it finished, and a person closed it rather than merging. */
const droppedHistory: readonly Event[] = [
  // Everything up to the ending it did not take: the three events of a merge come
  // off, and what is left is a finished child. Counted from the end rather than by
  // index, because the boundary before it is two events now and would be three next.
  ...childHistory.slice(0, -3),
  at(25, Events.closed()),
  at(27, Events.worktreeRemoved()),
]

/**
 * A child that only reported: its plan ran out with nothing on its branch, so the
 * archive was the only press on offer. The same log as the drop but for the sha —
 * which is the whole of what tells the two apart.
 */
const reportedHistory: readonly Event[] = droppedHistory.map((e) =>
  e._tag === "WorkCommitted" ? at(22, Events.workCommitted(undefined)) : e,
)

/** The one still going: its agent is working and nobody has decided anything. */
const runningHistory: readonly Event[] = childHistory.slice(0, 2)

const threeKids: Related = new Map([
  [kidA, childHistory],
  [kidB, droppedHistory],
  [kidC, runningHistory],
])

// ------------------------------- ids too long for a prefix to be a name of one
//
// Every fixture above is named `t1` or `kid-a`, which is what makes them readable
// and also what makes them silent about truncation: eight characters of `kid-a`
// is `kid-a`. These are the shape a trak is actually given.

const crab = TrakId.make("keen-olive-crab")
const otter = TrakId.make("witty-jade-otter")
const lion = TrakId.make("brave-teal-lion")

/** `spawnHistory`, with the children renamed and nothing else changed. */
const namedSpawn: readonly Event[] = [
  ...spawnHistory.filter((e) => e._tag !== "ChildrenSpawned" && e._tag !== "ChildLanded"),
  at(20, Events.childrenSpawned(2, [otter, lion])),
  at(30, Events.childLanded(landing(0, otter))),
  at(30, Events.childLanded(landing(1, lion))),
]

/** `childHistory`, born of a parent whose id is long enough to be cut. */
const bornOfCrab: readonly Event[] = childHistory.map((e) =>
  e._tag === "TrakCreated" && e.parent !== undefined
    ? { ...e, parent: { ...e.parent, id: crab } }
    : e,
)

describe("record", () => {
  it("splits a trak's time into the work and the waiting", () => {
    const r = record(id, history)
    expect(r.timed).toBe(true)
    // Step 0 ran for 35s and then sat at its gate for a minute. A total alone
    // would say 95s and leave a reader guessing which half was the agent.
    expect(r.steps[1]?.elapsed).toEqual({ working: 35_000, waiting: 60_000 })
    // The extra second here, against the same second missing from overhead below, is
    // step 1's stamped commit: the interval it closes lands on its own step now that
    // the event names one, rather than in the trak's overhead.
    expect(r.steps[2]?.elapsed).toEqual({ working: 58_000, waiting: 8000 })
    // Reading a plan is the trak's overhead, not its first step's — `parkedAt`
    // records `step: 0` at the plan gate because a plan has no index.
    expect(r.overhead.elapsed).toEqual({ working: 14_000, waiting: 70_000 })
    expect(r.elapsed).toEqual({ working: 107_000, waiting: 138_000 })
  })

  it("puts cost beside the step that spent it, and the tools beside that", () => {
    const r = record(id, history)
    // The disagreement is the finding: step 1 cost four times step 0 and needed
    // two runs to do it, which is the sentence the composer's plan should be read
    // against.
    expect(r.steps[1]?.usage.costUsd).toBeCloseTo(0.5)
    expect(r.steps[2]?.usage.costUsd).toBeCloseTo(2.2)
    expect(r.overhead.usage.costUsd).toBeCloseTo(0.3)
    expect(r.usage.costUsd).toBeCloseTo(3)
    expect(r.usage.tools).toEqual({ Read: 13, Grep: 42 })
  })

  it("counts the runs and names the checks that failed", () => {
    const r = record(id, history)
    expect(r.steps[1]).toMatchObject({ name: "discovery", iterations: 1, checkFailures: [] })
    expect(r.steps[2]).toMatchObject({ name: "build", iterations: 2, checkFailures: ["verify"] })
    // Every step that is a step. The compose at index 0 files nothing — the plan it
    // wrote is its output, and that is in the log rather than in `artifacts`.
    expect(r.steps.slice(1).every((s) => s.filed)).toBe(true)
    expect(r.steps[0]).toMatchObject({ name: "compose", filed: false })
  })

  it("quotes what a human typed, and says where they were standing", () => {
    // The one part of a record no computed count can stand in for. Approving is
    // the ordinary answer and says nothing; typing is the correction.
    expect(record(id, history).said).toEqual([{ step: undefined, text: "smaller please" }])
  })

  /**
   * The note is the one thing a person types that answers no question, and the join is
   * what would lose that: `" · "` separates answers in the order the questions were
   * asked, so a note inside the sequence reads as the answer to the last one. Its own
   * entry keeps it, and keeps it unattributed.
   */
  it("keeps a note sent with the answers, out of the sequence they are joined in", () => {
    const answered = [
      at(0, Events.trakCreated("Add a --json flag")),
      at(1, Events.humanActed(2, Actions.answer(["list only", "no"], "we ship on Friday"))),
    ]
    expect(record(id, answered).said).toEqual([
      { step: 2, text: "list only · no" },
      { step: 2, text: "we ship on Friday" },
    ])
  })

  it("says how it came to rest", () => {
    expect(record(id, history).outcome).toBe("finished")
    expect(record(id, history.slice(0, 3)).outcome).toBe("still going — AwaitingProposal")
  })

  it("quotes an abandonment's reason, and says `abandoned` alone when there is none", () => {
    // Ending an agent's turn never required an explanation, so the reason is
    // routinely empty — and a separator with nothing after it reads as a reason the
    // record lost rather than one nobody gave.
    const ended = (reason: string): readonly Event[] => [
      ...history.slice(0, 3),
      Events.abandoned(reason),
      Events.workCommitted(undefined),
      Events.worktreeRemoved(),
    ]
    expect(record(id, ended("the API moved under it")).outcome).toBe(
      "abandoned — the API moved under it",
    )
    expect(record(id, ended("")).outcome).toBe("abandoned")
  })

  it("reports counts and no durations for a log written before there were times", () => {
    // Every trak that ran before phase 6. Saying nothing about how long it took is
    // the honest answer; a zero would read as a trak that took no time.
    const r = record(
      id,
      turns.map(([, e]) => e),
    )
    expect(r.timed).toBe(false)
    expect(r.elapsed).toEqual({ working: 0, waiting: 0 })
    expect(r.steps[2]?.iterations).toBe(2)
    expect(r.usage.costUsd).toBeCloseTo(3)
  })

  it("keeps a stuck account whole, whatever a person decided about it", () => {
    const gaveUp = [
      ...history.slice(0, 7),
      at(120, Events.agentReturned(1, sid, stuck("three things", "none worked", "the lock"))),
    ]
    const [first] = record(id, gaveUp).stuck
    expect(first?.step).toBe(1)
    expect(first?.account).toContain("three things")
    expect(first?.account).toContain("none worked")
  })
})

/**
 * The record's watch-list, which is its own `describe` because it has three cases
 * and `record`'s block is at the line limit without them.
 */
describe("what a record says sent the plan back", () => {
  it("names the steps, which is the symptom worth watching", () => {
    // Every entry buys a planning turn and a decision. Nothing else in a record
    // would show a channel being filled out of diligence — the work all succeeded.
    const found = [
      ...history.slice(0, 7),
      at(
        120,
        Events.agentReturned(
          1,
          sid,
          artifact({ Summary: "done" }, undefined, [
            { at: "0-discovery", text: "no offline case" },
          ]),
        ),
      ),
    ]
    expect(record(id, found).corrected).toEqual([
      { step: 1, items: ["`0-discovery` — no offline case"] },
    ])
    expect(record(id, history).corrected).toEqual([])
  })

  it("reads a log written before the channels merged, under the heading they share", () => {
    // `uncovered_work` bought the same composer round a correction buys and landed
    // nowhere else, so the record shows it in the same section. Decoded from raw
    // JSON rather than built, because the constructor cannot write the old key —
    // which is the whole of what a stored log has that a fixture does not.
    const stored = [
      ...history.slice(0, 7),
      at(
        120,
        Events.agentReturned(
          1,
          sid,
          Schema.decodeUnknownSync(Artifact)({
            type: "artifact",
            sections: { Summary: "done" },
            uncovered_work: ["and a mockup first"],
          }),
        ),
      ),
    ]
    const r = record(id, stored)
    expect(r.corrected).toEqual([{ step: 1, items: ["and a mockup first"] }])
    expect(recordText(r)).toContain("- **step 1** — and a mockup first")
  })

  it("reads a step that ran twice as one account, not two", () => {
    // A step sent back files its whole artifact again, so the raw log repeats every
    // requirement and every correction verbatim. The requirements are unioned by
    // replay, which every live turn reads too; the corrections collapse here.
    const twice = [
      ...history.slice(0, 7),
      at(120, Events.agentReturned(1, sid, filedTwice)),
      at(180, Events.agentReturned(1, sid, filedTwice)),
    ]
    const r = record(id, twice)
    expect(r.decisions).toEqual([
      {
        text: "the admin view is out of scope",
        source: "stated",
        at: "1-discovery",
        id: "1-discovery.1",
      },
    ])
    expect(r.corrected).toEqual([{ step: 1, items: ["`0-discovery` — no offline case"] }])
    // One heading, not one per filing.
    expect(recordText(r).match(/## What sent the plan back/g)).toHaveLength(1)
  })
})

describe("a record joined to the traks around it", () => {
  it("adds what a spawn's children spent, and never what they took", () => {
    // Cost adds; time does not. The children ran at the same time as each other,
    // inside the parent's own wait — counting both put a two-day trak at 32 hours.
    const r = record(id, spawnHistory, kids)
    // The plan is [compose, discovery, spawn] — `applyEvent` splices the composer's
    // own position in at the head.
    const split = r.steps[2]
    expect(split?.usage.costUsd).toBeCloseTo(3)
    expect(split?.elapsed).toEqual({ working: 10_000, waiting: 0 })
    // The parent's own log says $0 at that position: every dollar here is a child's.
    expect(record(id, spawnHistory).steps[2]?.usage.costUsd).toBe(0)
    expect(r.usage.costUsd).toBeCloseTo(3.2)
  })

  it("files a trak under the day it merged, named for its title and its id", () => {
    expect(record(id, landed).folder).toBe("1970-01-01/a-json-flag-for-the-list-command-t1")
  })

  it("writes a trak's id whole everywhere the corpus names one", () => {
    // Four sites, one rule. A trak is named with three words, so eight characters
    // of one is a fragment of its adjective: it matches nothing under
    // `.orkestra/.database/traks/`, and `ork resume` takes no partial phrase. The
    // ids written as UUIDs are long and are shown whole too — one rule cannot tell
    // the two forms apart and nothing here should have to.
    const r = record(crab, namedSpawn, new Map([[otter, bornOfCrab]]))
    // The folder a day's listing shows, and the one line a cross-trak grep reads.
    expect(r.folder).toBe("1970-01-01/a-json-flag-for-the-list-command-keen-olive-crab")
    const text = recordText(r)
    expect(text).toContain("`keen-olive-crab` ·")
    // Each child in the spawn's row: one with a folder at the other end, one without,
    // where the id is the only route back to it.
    expect(text).toContain("witty-jade-otter")
    expect(text).toContain("brave-teal-lion")
    // And the pointer a child keeps up to its parent.
    expect(recordText(record(otter, bornOfCrab, new Map([[crab, namedSpawn]])))).toContain(
      "a piece of step 1 of `keen-olive-crab`",
    )
  })

  it("names a child after its parent, and shows only the requirements it reached itself", () => {
    const r = record(kidA, childHistory, new Map([[id, spawnHistory]]))
    // `childPlan` makes the whole of the first step's instruction the plan title, so a
    // child's own title is unusable as a heading. Its parent's plus which piece is not.
    expect(r.headline).toBe("A JSON flag for the list command · piece 1")
    expect(r.folder).toBe("1970-01-01/a-json-flag-for-the-list-command-piece-1-kid-a")
    expect(r.piece).toBe("Look at the schema.")
    // It was born holding its parent's, which stay in the parent's record — so a child
    // that settled nothing of its own shows nothing at all.
    expect(r.decisions).toEqual([])
    expect(record(kidA, childSettled, new Map([[id, spawnHistory]])).decisions).toEqual([
      { text: "the schema stays flat", source: "assumed", at: "0-review", id: "0-review.1" },
    ])
  })

  it("names a child's own entry as every other reader does, when its key is also an inherited one", () => {
    // The parent filed at `0-review` and so does the child's own step 0. The trak,
    // the prompt and the wire number over the whole list, so the child's entry is
    // `0-review.2` — and a record numbering after it slices the inherited entries
    // off would call it `0-review.1`, a name that folds the wrong row.
    const created = childSettled[0]
    const colliding = [
      created?._tag === "TrakCreated"
        ? {
            ...created,
            decisions: [{ text: "the parent's", source: "stated", at: "0-review" }] as const,
          }
        : created,
      ...childSettled.slice(1),
    ].filter((e) => e !== undefined)
    const r = record(kidA, colliding, new Map([[id, spawnHistory]]))
    expect(r.decisions).toEqual([
      { text: "the schema stays flat", source: "assumed", at: "0-review", id: "0-review.2" },
    ])
    expect(recordText(r)).toContain("*0-review.2*")
  })

  it("links each child's folder from the row that spawned it", () => {
    const r = record(id, spawnHistory, kids)
    expect(r.steps[2]?.children).toEqual([
      {
        id: kidA,
        outcome: "merged",
        folder: "1970-01-01/a-json-flag-for-the-list-command-piece-1-kid-a",
      },
      {
        id: kidB,
        outcome: "merged",
        folder: "1970-01-01/a-json-flag-for-the-list-command-piece-2-kid-b",
      },
    ])
    // Both folders are siblings of this one, so the link walks out of the day too.
    expect(recordText(r)).toContain(
      "../../1970-01-01/a-json-flag-for-the-list-command-piece-1-kid-a/record.md",
    )
  })
})

describe("how a child's ending reads on its parent's record", () => {
  it("tells a child that merged from one that was dropped and one still going", () => {
    // A folder is written for a trak whose checkout is gone and for nothing else, so
    // linking on *its log exists* would point a child still going at a path nothing
    // has created. The drop has one: its work was thrown away, its documents were not.
    const r = record(id, threeWays, threeKids)
    expect(r.steps[2]?.children).toEqual([
      {
        id: kidA,
        outcome: "merged",
        folder: "1970-01-01/a-json-flag-for-the-list-command-piece-1-kid-a",
      },
      {
        id: kidB,
        outcome: "dropped",
        folder: "1970-01-01/a-json-flag-for-the-list-command-piece-2-kid-b",
      },
      { id: kidC, outcome: "still going", folder: undefined },
    ])
    const text = recordText(r)
    expect(text).toContain(
      "[kid-a](../../1970-01-01/a-json-flag-for-the-list-command-piece-1-kid-a/record.md)",
    )
    expect(text).toContain(
      "[kid-b (dropped)](../../1970-01-01/a-json-flag-for-the-list-command-piece-2-kid-b/record.md)",
    )
    expect(text).toContain("kid-c (still going)")
    // The only ids without a link are the ones with no folder at the other end.
    expect(text).not.toContain("kid-c/record.md")
  })

  it("reads a child closed with nothing on its branch as reported, not dropped", () => {
    // A survey or a research piece writes documents and no code, so its branch never
    // moves and the archive is the only door off its ending. The closing press is the
    // same one a drop takes; the child's own log is what tells them apart.
    const r = record(id, threeWays, new Map([...threeKids, [kidB, reportedHistory]]))
    expect(r.steps[2]?.children[1]).toEqual({
      id: kidB,
      outcome: "reported",
      folder: "1970-01-01/a-json-flag-for-the-list-command-piece-2-kid-b",
    })
    expect(recordText(r)).toContain("[kid-b (reported)]")
  })

  it("falls back to the drop for a closed child whose log is gone", () => {
    // The landing carries no sha for a report and none for a drop — the sha is where
    // the work landed on the parent, and neither landed any — so without the log there
    // is nothing to read the difference off.
    const r = record(id, threeWays, new Map([[kidA, childHistory]]))
    expect(r.steps[2]?.children[1]).toEqual({ id: kidB, outcome: "dropped", folder: undefined })
  })

  it("still counts what a dropped child spent, because it was spent", () => {
    // The work did not go in; the money did go out. A row that hid it would report
    // a fan-out that ruled two approaches out as though it had cost one.
    const r = record(id, threeWays, threeKids)
    expect(r.steps[2]?.usage.costUsd).toBeCloseTo(3)
  })

  it("counts the wait for a person to merge as waiting, not as work", () => {
    // Every gap with no step used to be work, and the wait before someone clicks
    // Merge is one of them — a row that spends nothing and claims an hour is wrong.
    const r = record(id, landed)
    expect(r.overhead.elapsed).toEqual({ working: 24_000, waiting: 3_425_000 })
    // The rendered row is overhead minus the composer's own, which gets a row of
    // its own — 9s and a minute of it here.
    expect(recordText(r)).toContain("| — | setting up, integrating | — | 15s / 55m |")
  })

  it("names the traks whose logs it wants beside this one", () => {
    expect(relatedTraks(id, spawnHistory)).toEqual([kidA, kidB])
    expect(relatedTraks(kidA, childHistory)).toEqual([id])
  })
})

describe("keptInCorpus", () => {
  it("keeps a trak whose checkout is gone, and never one still holding it", () => {
    // `Finished` holds a checkout and can go on to merge, and a folder is dated by
    // the merge — so filing at both moments is one trak under two days.
    const finished = childHistory.slice(0, -3)
    expect(keptInCorpus(replayHistory(kidA, finished))).toBe(false)
    expect(keptInCorpus(replayHistory(kidA, childHistory))).toBe(true)
    expect(keptInCorpus(replayHistory(kidB, droppedHistory))).toBe(true)
    expect(keptInCorpus(replayHistory(kidB, reportedHistory))).toBe(true)
    const abandoned = [
      ...runningHistory,
      at(5, Events.abandoned("no")),
      at(6, Events.worktreeRemoved()),
    ]
    expect(keptInCorpus(replayHistory(kidC, abandoned))).toBe(true)
  })
})

describe("recordFiles", () => {
  it("opens a superseded document with the note the worktree showed, so the corpus agrees", () => {
    // Step 1's second turn files the same document with the entry beside it.
    const last = history.findLastIndex((e) => e._tag === "AgentReturned")
    const superseded = [
      ...history.slice(0, last),
      at(
        230,
        Events.agentReturned(
          2,
          sid,
          artifact({ Summary: "v2" }, [
            {
              text: "the flag is on `list` only",
              source: "assumed",
              kind: "constraint",
              supersedes: ["1-discovery"],
            },
          ]),
        ),
      ),
      ...history.slice(last + 1),
    ]
    const files = recordFiles(record(id, superseded))
    expect(files.get("01-discovery.md")).toBe(
      "> **Superseded by `2-build.1`** — the flag is on `list` only\n\n## Summary\n\nfound it\n",
    )
  })

  it("lands a child's supersedes on the parent's key for the document it named", () => {
    // The child wrote its own keys: `0-review` for what it filed, and
    // `from-parent/1-discovery` for what it was born holding. Neither is a key of
    // this trak's, and a note left under either would land on no file — or, worse,
    // on this trak's own `0-review`.
    const joined = [
      ...spawnHistory.slice(0, -1),
      at(
        30,
        Events.childLanded({
          ...landing(1, kidB),
          artifacts: [["0-review", artifact({ Summary: "the schema holds" })]],
          decisions: [
            { text: "it holds", source: "assumed", supersedes: ["0-review"] },
            { text: "no it was not", source: "assumed", supersedes: ["from-parent/1-discovery"] },
          ],
        }),
      ),
      at(40, Events.childrenJoined(2, [])),
    ]
    expect(record(id, joined).decisions).toEqual([
      {
        text: "it holds",
        source: "assumed",
        at: "2.1-review",
        id: "2.1-review.1",
        supersedes: ["2.1-review/0-review"],
      },
      {
        text: "no it was not",
        source: "assumed",
        at: "2.1-review",
        id: "2.1-review.2",
        supersedes: ["1-discovery"],
      },
    ])
    const files = recordFiles(record(id, joined))
    expect(files.get("02.1-review/00-review.md")).toContain(
      "> **Superseded by `2.1-review.1`** — it holds",
    )
    expect(files.get("01-discovery.md")).toContain(
      "> **Superseded by `2.1-review.2`** — no it was not",
    )
  })

  it("is the record plus one file per document, padded into plan order", () => {
    const files = recordFiles(record(id, landed))
    expect([...files.keys()]).toEqual(["record.md", "01-discovery.md", "02-build.md"])
    expect(files.get("01-discovery.md")).toContain("found it")
    expect(files.get("record.md")).toBe(recordText(record(id, landed)))
  })

  it("keeps a piece's documents in a folder named for the piece, padded alike", () => {
    // The piece's folder and each document in it sort the same way the top level
    // does — one rule, applied to every segment of the key.
    const joined = [
      ...spawnHistory.slice(0, -1),
      at(
        30,
        Events.childLanded({
          ...landing(1, kidB),
          artifacts: [["0-review", artifact({ Summary: "the schema holds" })]],
        }),
      ),
      at(40, Events.childrenJoined(2, [])),
    ]
    const files = recordFiles(record(id, joined))
    expect([...files.keys()]).toEqual(["record.md", "01-discovery.md", "02.1-review/00-review.md"])
    expect(files.get("02.1-review/00-review.md")).toContain("the schema holds")
  })
})

describe("recordText", () => {
  it("leads with the title and how it ended, then the request", () => {
    const text = recordText(record(id, history))
    expect(text.startsWith("# A JSON flag for the list command\n")).toBe(true)
    expect(text).toContain("finished")
    expect(text).toContain("Add a --json flag")
  })

  it("gives every step a row, with what happened to it", () => {
    const text = recordText(record(id, history))
    // The composer gets a row of its own now, which is the whole point: composing
    // used to be folded into the trak's overhead beside worktree setup.
    expect(text).toContain("| 0 | compose |")
    expect(text).toContain("| 1 | discovery |")
    expect(text).toContain("2 runs; **verify failed**")
    expect(text).toContain("Grep ×42")
  })

  it("counts a check that failed repeatedly rather than naming it again", () => {
    // Four `verify`s in a row is one finding with a number on it. Printed as four
    // names it reads as four different things going wrong.
    const flapping = [
      ...history.slice(0, 7),
      at(120, Events.checkFailed(1, "verify", "timed out")),
      at(130, Events.checkFailed(1, "verify", "timed out")),
      at(140, Events.checkFailed(1, "fmt", "unformatted")),
    ]
    expect(recordText(record(id, flapping))).toContain("**verify ×2, fmt failed**")
  })

  it("links each step's document, named for its key and padded so a folder sorts", () => {
    // `3-build` before `10-build` is the whole reason for the padding, and the
    // filename in the table has to be the one on disk or the link is a dead end.
    const text = recordText(record(id, history))
    expect(text).toContain("[01-discovery.md](01-discovery.md)")
    expect(text).toContain("[02-build.md](02-build.md)")
  })

  it("points at the branch, the log and the turns, and keeps the sha off the head line", () => {
    const text = recordText(record(id, landed))
    const [, , head] = text.split("\n")
    expect(head).toContain("`t1` · merged ·")
    expect(head).not.toContain("abc1234")
    expect(text).toContain("- branch `trak/t1` → merged as `abc1234`")
    expect(text).toContain("- log `.orkestra/.database/traks/t1/log.jsonl`")
    expect(text).toContain("transcript.jsonl")
  })

  it("carries no caveat where nothing spawned, since each turn's usage is its own", () => {
    // Every turn's tokens and cost are that turn's alone, resumed sessions included,
    // so a total across turns over-counts nothing and the record has nothing to warn
    // about. The one caveat left is the spawn row's clock, and only a spawn earns it.
    expect(recordText(record(id, history))).not.toContain("## Caveats")
  })

  it("rounds cost to cents, and to four places only where a cent would hide it", () => {
    // A column of costs is read by comparing it, so one format beats precision
    // nobody uses — until the reading is that the turn cost almost nothing.
    expect(recordText(record(id, history))).toContain("$0.50")
    const cheap = [
      at(0, Events.trakCreated("a small thing")),
      at(1, Events.worktreeReady(worktree)),
      at(2, Events.composerReturned(sid, plan, spend(0.0031))),
    ]
    expect(recordText(record(id, cheap))).toContain("$0.0031")
  })

  it("has no empty sections", () => {
    // A heading whose section says "none" is the beginning of skipping the ones
    // that matter — the rule `trak.md` already follows.
    const bare = recordText(record(id, [at(0, Events.trakCreated("Add a --json flag"))]))
    expect(bare).not.toContain("## Decisions")
    expect(bare).not.toContain("## What a human said")
    expect(bare).not.toContain("## Tools")
  })
})
