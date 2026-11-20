/**
 * Tier 1 (`testing-tiers`): the projection alone — no React, no transport.
 *
 * What it is written to catch is a trak that is in no section or in two, and an
 * ordering that reads plausibly on a fixture and inverts on a real list.
 */

import { describe, expect, it } from "vitest"
import type { TrakStateDto, TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { rememberedByBranch } from "../../forgeMemory"
import {
  makeDeploy,
  makeListing,
  makePullRequestSummary,
  makeParent,
  makeTrak,
  makeWaiting,
} from "../../fixtures"
import {
  ASKING,
  forgeBranches,
  pullRung,
  rungsOf,
  UNASKED,
  type Rung,
  type Rungs,
} from "./pullRung"
import { SECTION_ORDER, asSections, fileOf, sectionOf, type Section } from "./sections"
import { rowMark, rowWords } from "./waitingRow"

/** Positional because every case here is about the state, and the rest is scenery. */
const trak = (
  id: string,
  state: TrakStateDto,
  extra: Partial<TrakSummaryDto> = {},
): TrakSummaryDto => makeTrak({ id, description: id, state, ...extra })

/**
 * The list as the page files it. The forge's answers default to none, which is what every
 * case below is about but the last two: a trak nothing has answered for is filed by its
 * own state, which is what the list did before there was a rung at all.
 */
const filed = (traks: readonly TrakSummaryDto[], rungs: Rungs = new Map()): readonly Section[] =>
  asSections(traks, rungs)

/** One trak's answer, as the map `asSections` takes. */
const answered = (id: string, pull: Parameters<typeof pullRung>[0]): Rungs =>
  new Map([[id, pullRung(pull)]])

/** A rename, kept because these cases read as *where this answer files a row*. */
const rungFor = (pull: Parameters<typeof pullRung>[0]): Rung => pullRung(pull)

const from = (id: string, child: number): TrakSummaryDto["parent"] => makeParent({ id, child })

/** The three piles no state on its own can produce: only the forge's answer — or its
 *  absence — files a row under *In review*, *Has issues* or *Finished*, so the order test
 *  needs one of each in hand. */
const FORGE_ONLY: Rungs = new Map([
  ["out", rungFor(makePullRequestSummary({ decision: "reviewRequired" }))],
  ["stuck", rungFor(makePullRequestSummary({ merging: "conflicting" }))],
  ["unasked", UNASKED],
  // MERGED is the fourth pile no state alone produces: the rung's override is the only
  // way in, so the order test needs one in hand too.
  ["landed", rungFor(makePullRequestSummary({ state: "merged" }))],
])

/**
 * Every state the wire has, one of each — the input for "no trak is unfiled".
 *
 * Hand-written, and nothing checks that it is complete: `sectionOf` is a switch with a
 * declared return type, so a state the union grows is a compile error there, while this
 * array being one member short compiles and simply stops proving anything about it.
 * A state added to `TrakStateDto` has to be added here by hand.
 */
const EVERY_STATE: readonly TrakStateDto[] = [
  { _tag: "Preparing" },
  { _tag: "Composing" },
  { _tag: "AwaitingProposal" },
  { _tag: "AwaitingComposerAnswers" },
  { _tag: "AgentWorking", step: 0 },
  { _tag: "CheckRunning", step: 0 },
  { _tag: "ConditionRunning", step: 0 },
  { _tag: "AwaitingHuman", step: 0, kind: "approval" },
  { _tag: "AwaitingHuman", step: 0, kind: "answers" },
  { _tag: "AwaitingHuman", step: 0, kind: "checks" },
  { _tag: "AwaitingHuman", step: 0, kind: "stuck" },
  { _tag: "AwaitingHuman", step: 0, kind: "conversation" },
  { _tag: "Spawning", step: 0 },
  { _tag: "HandingOff", step: 0 },
  { _tag: "AwaitingChildren", step: 0 },
  { _tag: "Joining", step: 0 },
  { _tag: "Committing", step: 0 },
  { _tag: "Effecting", step: 0 },
  { _tag: "Integrating" },
  { _tag: "Abandoning", reason: "done with it" },
  { _tag: "Merging" },
  { _tag: "Closing" },
  { _tag: "Finished" },
  { _tag: "Merged", sha: "abc1234" },
  { _tag: "Closed" },
  { _tag: "Abandoned", reason: "done with it" },
  { _tag: "Failed", kind: "provider", error: "the CLI exited 1" },
]

describe("sectionOf", () => {
  it("puts every gate a person stands at in the top section", () => {
    const gated = EVERY_STATE.filter((state) => sectionOf(state, true) === "attention").map(
      (state) => state._tag,
    )
    expect(new Set(gated)).toEqual(
      new Set(["AwaitingProposal", "AwaitingComposerAnswers", "AwaitingHuman"]),
    )
  })

  /**
   * The one state whose work is not in this checkout, and it still reads as progress:
   * a person scanning the list wants *is anybody owed something* and the answer is no —
   * the gate that authorised the send is behind it, and nothing is being asked.
   * `sectionOf` is where that is decided; the count test below only proves it is
   * somewhere.
   */
  it("files a trak whose work is leaving the checkout under progress like any other", () => {
    expect(sectionOf({ _tag: "Effecting", step: 0 }, true)).toBe("progress")
  })

  it("files the three endings as one archived pile", () => {
    // Three states on the log — the corpus tells them apart — and one pile on the page:
    // every one of them is put away, and that is the whole of what the pile says.
    expect(sectionOf({ _tag: "Merged", sha: "abc1234" }, true)).toBe("archived")
    expect(sectionOf({ _tag: "Closed" }, true)).toBe("archived")
    expect(sectionOf({ _tag: "Abandoned", reason: "done with it" }, true)).toBe("archived")
  })

  /**
   * From the moment the press lands, not from the moment the checkout is gone: the
   * engine reports `Closing` and `Abandoning` for the seconds an archive takes, and a
   * row filed under *In progress* for them moved up the page to say work was starting.
   * A merge is the one ending step that stays up there — it is a landing, and the trak
   * enters `Closing` once it is in.
   */
  it("files a trak being archived under the archive from the moment it starts", () => {
    expect(sectionOf({ _tag: "Closing" }, true)).toBe("archived")
    expect(sectionOf({ _tag: "Abandoning", reason: "done with it" }, true)).toBe("archived")
    expect(sectionOf({ _tag: "Merging" }, true)).toBe("progress")
  })

  it("brings an archive that failed back out under errors", () => {
    // `decide` settles a git error in `Closing` or `Abandoning` as `Failed{archive}`, so
    // the same switch that put the row under the archive's lid files it with every other
    // failure — where the row offers `Retry`.
    expect(
      sectionOf({ _tag: "Failed", kind: "archive", error: "git worktree remove: locked" }, true),
    ).toBe("errors")
  })

  /** The rung wins where there is one, and where there is none the switch is untouched —
   *  which is what keeps every state but `Finished` filed exactly as it was. */
  it("files by the forge's answer where there is one, and by the state where there is not", () => {
    // *Ready to merge* is where a branch nobody has answered for goes, and it is what the
    // bottom rung says too — nothing is stopping either of them.
    expect(sectionOf({ _tag: "Finished" }, true)).toBe("ready")
    expect(
      sectionOf({ _tag: "Finished" }, true, pullRung(makePullRequestSummary({ state: "merged" }))),
    ).toBe("merged")
    // Closed on the forge is not the archived pile: that pile starts shut and means the
    // trak was put away, and this one is still holding its checkout.
    expect(
      sectionOf({ _tag: "Finished" }, true, pullRung(makePullRequestSummary({ state: "closed" }))),
    ).toBe("issues")
    // And the forge nobody could reach is the one absence that does *not* land here.
    expect(sectionOf({ _tag: "Finished" }, true, UNASKED)).toBe("finished")
  })

  /** The finished work is three piles now, and which one a row lands in is the ladder's
   *  answer to *what is in the way* rather than a second reading of the wire. */
  it("splits the finished work into what can land, what is out, and what is stuck", () => {
    const state: TrakStateDto = { _tag: "Finished" }
    expect(sectionOf(state, true, rungFor(makePullRequestSummary({ decision: "approved" })))).toBe(
      "ready",
    )
    expect(
      sectionOf(state, true, rungFor(makePullRequestSummary({ decision: "reviewRequired" }))),
    ).toBe("review")
    expect(sectionOf(state, true, rungFor(makePullRequestSummary({ isDraft: true })))).toBe(
      "review",
    )
    expect(
      sectionOf(state, true, rungFor(makePullRequestSummary({ merging: "conflicting" }))),
    ).toBe("issues")
  })

  /**
   * The fifth pile, and the one outside the ladder: a plan that ran out having kept nothing
   * on its branch. It is the same state as the four above and a different question — there
   * is no merge for anything to be in the way of.
   */
  it("files a finished trak that kept nothing on its branch in a pile of its own", () => {
    expect(sectionOf({ _tag: "Finished" }, false)).toBe("resolved")
    expect(sectionOf({ _tag: "Finished" }, true)).toBe("ready")
  })

  /** It sits below every pile the forge classifies and above the endings, so a page with
   *  both reads: what can land, what is out, what is stuck, what nobody could ask about,
   *  then what has nowhere to land. It was above the failures too until `errors` moved to
   *  the top of the finished work, which is where a `Retry` a person owes belongs — the
   *  half of this claim that was about the ladder is the half that survived. */
  it("puts that pile below the four the forge files and above MERGED and the archive", () => {
    expect(SECTION_ORDER.indexOf("resolved")).toBeGreaterThan(SECTION_ORDER.indexOf("finished"))
    expect(SECTION_ORDER.indexOf("resolved")).toBeLessThan(SECTION_ORDER.indexOf("merged"))
    expect(SECTION_ORDER.indexOf("merged")).toBeLessThan(SECTION_ORDER.indexOf("archived"))
  })

  /** Every other state ignores it, which is what keeps this one arm of the switch and not
   *  a second axis through the whole map. */
  it("reads the branch at `Finished` and nowhere else", () => {
    const differs = EVERY_STATE.filter(
      (state) => sectionOf(state, false) !== sectionOf(state, true),
    ).map((state) => state._tag)
    expect(differs).toEqual(["Finished"])
  })
})

/**
 * One trak for every pile: a state each, the four the forge's answer files, the one a
 * branch nothing was committed to files, and the two the wire's `waiting` files ahead of
 * the state and the rung — the second by the wait's name being the deploy's.
 */
const EVERY_PILE: readonly TrakSummaryDto[] = [
  ...EVERY_STATE.map((state, i) => trak(`t${i}`, state)),
  trak("out", { _tag: "Finished" }),
  trak("stuck", { _tag: "Finished" }),
  trak("unasked", { _tag: "Finished" }),
  trak("landed", { _tag: "Finished" }),
  trak("nothing-landed", { _tag: "Finished" }, { branchMoved: false }),
  trak("held", { _tag: "Finished" }, { waiting: makeWaiting() }),
  trak("deploying", { _tag: "Finished" }, { waiting: makeWaiting({ name: "deployed" }) }),
]

describe("asSections", () => {
  it("puts every trak in exactly one section, in the order the page reads", () => {
    const traks = EVERY_PILE
    const sections = filed(traks, FORGE_ONLY)

    expect(sections.map((s) => s.key)).toEqual(SECTION_ORDER)
    const ids = sections.flatMap((s) => s.rows.map((r) => r.trak.id))
    expect([new Set(ids).size, ids.length]).toEqual([traks.length, traks.length])
  })

  it("draws no section for a state nothing is in", () => {
    // The ordinary weekday: nothing waiting, nothing failed. The page starts at
    // "In progress" with no hole above it.
    const sections = filed([trak("a", { _tag: "AgentWorking", step: 0 }, { running: true })])
    expect(sections.map((s) => s.key)).toEqual(["progress"])
  })

  it("orders a section by the most recent human touch", () => {
    const sections = filed([
      trak("old", { _tag: "AwaitingProposal" }, { touched: 100 }),
      trak("newest", { _tag: "AwaitingProposal" }, { touched: 300 }),
      trak("middle", { _tag: "AwaitingProposal" }, { touched: 200 }),
    ])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["newest", "middle", "old"])
  })

  it("sorts a trak nobody has measured last, keeping store order among them", () => {
    // A log written before events carried `at`. Absent is *we do not know*, which is
    // the bottom of the section rather than the top of it.
    const sections = filed([
      trak("unknown-first", { _tag: "Closed" }),
      trak("touched", { _tag: "Closed" }, { touched: 1 }),
      trak("unknown-second", { _tag: "Closed" }),
    ])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual([
      "touched",
      "unknown-first",
      "unknown-second",
    ])
  })

  it("files a group under its gated piece, with the parent still heading it", () => {
    const sections = filed([
      trak("parent", { _tag: "AwaitingChildren", step: 0 }, { description: "add a client" }),
      trak(
        "child",
        { _tag: "AwaitingHuman", step: 0, kind: "answers" },
        { parent: from("parent", 0) },
      ),
    ])

    // One section, not two: the piece does not go up on its own, the group goes up
    // around it — and the parent heads it however far up its piece dragged it.
    expect(sections.map((s) => s.key)).toEqual(["attention"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["parent"])
    expect(sections[0]?.rows[0]?.band.map((t) => t.id)).toEqual(["child"])
  })

  it("keeps a child on its parent's band where the two are in the same section", () => {
    const sections = filed([
      trak("second", { _tag: "Finished" }, { parent: from("parent", 1) }),
      trak("parent", { _tag: "Finished" }),
      trak("first", { _tag: "Finished" }, { parent: from("parent", 0) }),
    ])
    // One row, not three: the pieces are on the band, in plan order rather than the
    // order the store handed them over in.
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["parent"])
    expect(sections[0]?.rows[0]?.band.map((t) => t.id)).toEqual(["first", "second"])
  })

  it("reads SECTION_ORDER literally, so a failed parent with a finished piece is an error", () => {
    // The rule biting the other way now that `errors` sits above the forge's piles: the
    // group goes to the failure a person can retry, and the piece's own plate on the
    // band says the rest. It is also why moving `errors` moved the constant rather than
    // sorting `asSections`' result — this placement reads the constant directly.
    const sections = filed([
      trak("parent", { _tag: "Failed", kind: "provider", error: "the CLI exited 1" }),
      trak("child", { _tag: "Finished" }, { parent: from("parent", 0) }),
    ])
    expect(sections.map((s) => s.key)).toEqual(["errors"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["parent"])
  })

  it("takes a landed piece off the list rather than filing it as a row of its own", () => {
    // A merged piece *is* the parent now, so there is nothing outstanding to place —
    // and `Merged` is a section this list therefore does not draw at all here.
    const sections = filed([
      trak("parent", { _tag: "AwaitingChildren", step: 0 }),
      trak("landed", { _tag: "Merged", sha: "a91c04e" }, { parent: from("parent", 0) }),
      trak("out", { _tag: "AgentWorking", step: 0 }, { parent: from("parent", 1) }),
    ])
    expect(sections.map((s) => s.key)).toEqual(["progress"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["parent"])
    expect(sections[0]?.rows[0]?.band.map((t) => t.id)).toEqual(["out"])
  })

  it("orders a group by the newest touch anywhere in it, not by the parent's own", () => {
    // A group pulled up by a piece answered a minute ago sorts on that piece, not on a
    // parent touch hours old.
    const sections = filed([
      trak("parent", { _tag: "AwaitingChildren", step: 0 }, { touched: 100 }),
      trak(
        "piece",
        { _tag: "AwaitingHuman", step: 0, kind: "answers" },
        { parent: from("parent", 0), touched: 300 },
      ),
      trak("alone", { _tag: "AwaitingProposal" }, { touched: 200 }),
    ])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["parent", "alone"])
  })

  it("shows a child whose parent the list does not hold, as a row of its own", () => {
    // A wiped parent, and the one exception to "never on its own". The alternative is a
    // trak that exists and is listed nowhere.
    const sections = filed([
      trak("orphan", { _tag: "AwaitingProposal" }, { parent: from("gone", 0) }),
    ])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["orphan"])
  })
})

/**
 * The deploy wait: above WAITING, filed off the sweep's answer rather than the state or the
 * rung, and a failed deploy stays in it rather than moving to *Has issues*.
 */
describe("asSections — a parent at rest", () => {
  it("files a parent at rest by its own state, not by a piece that failed under it", () => {
    // The harbor trak: merged and put away, with a child whose log replays as `Failed`
    // under today's engine. `errors` sits above `archived`, so counting the piece would
    // bring the whole group back out as an error nobody can retry from the parent.
    const sections = filed([
      trak("parent", { _tag: "Merged", sha: "a91c04e" }),
      trak(
        "ghost",
        { _tag: "Failed", kind: "engine", error: "unexpected ChildLanded" },
        { parent: from("parent", 0) },
      ),
    ])
    expect(sections.map((s) => s.key)).toEqual(["archived"])
    expect(sections[0]?.rows[0]?.band.map((t) => t.id)).toEqual(["ghost"])
  })

  it("still lets a piece place the group while the parent is going", () => {
    // `Failed` is stopped, not at rest, so the failed parent with a piece at a gate files
    // under the gate — the rule above is about a parent that is over.
    const sections = filed([
      trak("parent", { _tag: "Failed", kind: "provider", error: "the CLI exited 1" }),
      trak(
        "piece",
        { _tag: "AwaitingHuman", step: 0, kind: "answers" },
        { parent: from("parent", 0) },
      ),
    ])
    expect(sections.map((s) => s.key)).toEqual(["attention"])
  })
})

describe("asSections — a wait on the deploy", () => {
  it("files a waiting trak the script has answered for above the other waits", () => {
    const sections = filed(
      [
        trak("held", { _tag: "Finished" }, { waiting: makeWaiting() }),
        trak(
          "deploying",
          { _tag: "Finished" },
          { waiting: makeWaiting({ name: "deployed" }), deploy: makeDeploy() },
        ),
        trak(
          "failed",
          { _tag: "Finished" },
          { waiting: makeWaiting({ name: "deployed" }), deploy: makeDeploy({ answer: "gave-up" }) },
        ),
      ],
      answered("deploying", makePullRequestSummary({ state: "merged" })),
    )
    expect(sections.map((s) => s.key)).toEqual(["deploying", "waiting"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["deploying", "failed"])
    expect(sections[1]?.rows.map((r) => r.trak.id)).toEqual(["held"])
  })

  it("files a deploy wait the script has not answered for there too, from the moment it starts", () => {
    // Before the branch has merged the wire carries no `deploy` — the script has never
    // run — and the wait's name is what files the row. A wait on a project's own script
    // stays under Waiting whatever `deploy` happens to say.
    const sections = filed([
      trak("early", { _tag: "Finished" }, { waiting: makeWaiting({ name: "deployed" }) }),
      trak("held", { _tag: "Finished" }, { waiting: makeWaiting(), deploy: makeDeploy() }),
    ])
    expect(sections.map((s) => s.key)).toEqual(["deploying", "waiting"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["early"])
  })
})

/**
 * The one wait that does not lead: `merged` and `deployed` cannot pass until the pull
 * request merges, so while the forge says it has not, the row files by the pull request —
 * and goes back to its wait's pile the moment the forge says merged.
 */
describe("fileOf — a wait on the branch going in", () => {
  const onDeploy = trak("d", { _tag: "Finished" }, { waiting: makeWaiting({ name: "deployed" }) })
  const onMerged = trak("m", { _tag: "Finished" }, { waiting: makeWaiting({ name: "merged" }) })
  const onScript = trak("s", { _tag: "Finished" }, { waiting: makeWaiting() })

  it("files by the pull request across every family of rung that says the branch is out", () => {
    const cases: readonly [Parameters<typeof pullRung>[0], string][] = [
      [makePullRequestSummary({ merging: "conflicting" }), "issues"],
      [makePullRequestSummary(), "ready"],
      [makePullRequestSummary({ merging: "unknown" }), "review"],
      [makePullRequestSummary({ state: "closed" }), "issues"],
    ]
    for (const [pull, pile] of cases) {
      expect(fileOf(onDeploy, rungFor(pull))).toBe(pile)
      expect(fileOf(onMerged, rungFor(pull))).toBe(pile)
      // A project's own script has nothing to do with the branch.
      expect(fileOf(onScript, rungFor(pull))).toBe("waiting")
    }
  })

  it("returns the row to the wait's pile once the forge says merged", () => {
    const merged = rungFor(makePullRequestSummary({ state: "merged" }))
    expect(fileOf(onDeploy, merged)).toBe("deploying")
    expect(fileOf(onMerged, merged)).toBe("waiting")
  })

  /** A forge that could not be asked, or has not answered, is no claim about the branch —
   *  a `gh` that is not installed must not move every held trak under *Finished*. */
  it("leaves a waiting trak where it was on either nothing", () => {
    for (const rung of [UNASKED, ASKING, undefined]) {
      expect(fileOf(onDeploy, rung)).toBe("deploying")
      expect(fileOf(onMerged, rung)).toBe("waiting")
    }
  })
})

/** What the forge's answer does to where a row is filed — the ladder itself is
 *  `pullRung.test.ts`; this is the half `asSections` owns. */
describe("asSections — the forge's answer", () => {
  it("puts a merged pull request in MERGED, apart from a merged trak already archived", () => {
    // MERGED is the chore pile — the work is in and the checkout is still here — where a
    // trak in the `Merged` state has nothing on disk and files under the archive's lid.
    const sections = filed(
      [trak("on-the-forge", { _tag: "Finished" }), trak("locally", { _tag: "Merged", sha: "a91" })],
      answered("on-the-forge", makePullRequestSummary({ state: "merged" })),
    )
    expect(sections.map((s) => s.key)).toEqual(["merged", "archived"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["on-the-forge"])
    expect(sections[1]?.rows.map((r) => r.trak.id)).toEqual(["locally"])
  })

  it("leaves a branch the forge had nothing to say about exactly where it was", () => {
    // The one absence that is a fact: the forge was asked about this branch by name and
    // has no pull request on it. Nothing is stopping it, which is what the pile says. The
    // entry reaches the row through the store, which is the only path an answer has now.
    const done = [trak("t", { _tag: "Finished" }, { branch: "trak/t" })]
    const asked = makeListing({ entries: [{ branch: "trak/t" }] })
    const memory = rememberedByBranch([{ answer: asked, at: 1 }], 1)
    expect(
      filed(done, rungsOf(done, asked, forgeBranches(done), memory)).map((s) => s.key),
    ).toEqual(["ready"])
  })

  /**
   * The two absences that are not facts, and the reason `rungsOf` may not return an empty
   * map for either: this line is where *nothing was said* becomes *nothing is in the way*.
   * An answer to a different set of branches has not looked at this one, and an answer that
   * has not arrived has looked at nothing at all — the rows word those differently and both
   * land in the same pile, which is the part that matters here.
   */
  it("takes a finished trak nobody vouched for out of the landable pile", () => {
    const done = [trak("t", { _tag: "Finished" }, { branch: "trak/t" })]
    for (const listing of [makeListing(), undefined])
      expect(
        filed(done, rungsOf(done, listing, forgeBranches(done), new Map())).map((s) => s.key),
      ).toEqual(["finished"])
  })

  it("takes a finished trak the forge could not be asked about out of the landable pile", () => {
    // The third absence, and the one that used to sit with the other two. *We could not
    // look* must not be counted under a header that says what a person can land.
    const done = [trak("t", { _tag: "Finished" }, { branch: "trak/t" })]
    const sections = filed(
      done,
      rungsOf(done, { _tag: "ForgeUnavailable", why: "no gh" }, forgeBranches(done), new Map()),
    )
    expect(sections.map((s) => s.key)).toEqual(["finished"])
  })

  /**
   * The second override, and it beats the first: a trak holding a step behind a condition
   * is not done however its pull request stands, so it leaves *Merged* for a pile of its
   * own — above the failures, because nobody owes it a press.
   */
  it("files a held trak under WAITING, over what the forge said about its branch", () => {
    const sections = filed(
      [
        trak("held", { _tag: "Finished" }, { waiting: makeWaiting() }),
        trak("plain", { _tag: "Finished" }),
      ],
      new Map([
        ["held", rungFor(makePullRequestSummary({ state: "merged" }))],
        ["plain", rungFor(makePullRequestSummary({ state: "merged" }))],
      ]),
    )
    expect(sections.map((s) => s.key)).toEqual(["waiting", "merged"])
    expect(sections[0]?.rows.map((r) => r.trak.id)).toEqual(["held"])
    expect(SECTION_ORDER.indexOf("waiting")).toBeLessThan(SECTION_ORDER.indexOf("errors"))
    expect(SECTION_ORDER.indexOf("waiting")).toBeGreaterThan(SECTION_ORDER.indexOf("progress"))
  })

  it("lets a held piece place its group, like any other member", () => {
    // A parent that failed is stopped rather than over, so its held piece still counts —
    // and `waiting` sits above `errors`, so the wait is where the group goes.
    const sections = filed([
      trak("parent", { _tag: "Failed", kind: "provider", error: "the CLI exited 1" }),
      trak("piece", { _tag: "Finished" }, { parent: from("parent", 0), waiting: makeWaiting() }),
    ])
    expect(sections.map((s) => s.key)).toEqual(["waiting"])
    expect(sections[0]?.rows[0]?.band.map((t) => t.id)).toEqual(["piece"])
  })

  it("files a group on the parent's own pull request once the parent is at rest", () => {
    // A parent is `Finished` only once every piece has landed, so a piece still drawn
    // under one has nothing left to say about where the group goes: the parent's rung
    // places it, whatever the piece's own rung — or the absence of one — would have said.
    const group = [
      trak("parent", { _tag: "Finished" }),
      trak("piece", { _tag: "Finished" }, { parent: from("parent", 0) }),
    ]
    const merged = rungFor(makePullRequestSummary({ state: "merged" }))

    const alone = filed(group, new Map([["parent", merged]]))
    expect(alone.map((s) => s.key)).toEqual(["merged"])
    expect(alone[0]?.rows[0]?.band.map((t) => t.id)).toEqual(["piece"])
  })
})

/**
 * A trak whose engine died mid-turn replays to `AgentWorking` with nobody holding it —
 * `running: false` on the wire. The detail page reads that pair as stopped and offers
 * Resume (`runInterrupted`); the list must not read it as work in flight.
 */
describe("fileOf — an interrupted turn after the engine reloads", () => {
  const interrupted = trak("i", { _tag: "AgentWorking", step: 0 }, { running: false })

  it("files the row under Errors rather than In progress", () => {
    expect(fileOf(interrupted, undefined)).toBe("errors")
  })

  it("does not run the moving segment on its mark", () => {
    expect(rowMark(interrupted, undefined).running).toBe(false)
  })

  it("says it stopped, in the tone of a trak that stopped", () => {
    expect(rowWords(interrupted, undefined)).toEqual({
      label: "stopped",
      tone: "bad",
      aside: undefined,
    })
  })

  /** The other half of the pair: the same state with something carrying it is busy. */
  it("leaves a trak something is carrying under In progress, moving", () => {
    const held = trak("h", { _tag: "AgentWorking", step: 0 }, { running: true })
    expect(fileOf(held, undefined)).toBe("progress")
    expect(rowMark(held, undefined).running).toBe(true)
    expect(rowWords(held, undefined).label).toBe("Working…")
  })

  /** A parent waiting on its pieces holds no drive of its own, and is not stopped. */
  it("leaves a parent waiting on its children under In progress", () => {
    expect(fileOf(trak("p", { _tag: "AwaitingChildren", step: 1 }), undefined)).toBe("progress")
  })
})

/** A section's rows, by id, in the order they are drawn. */
const ids = (section: Section | undefined): readonly string[] =>
  (section?.rows ?? []).map((row) => row.trak.id)

describe("asSections — idle groups", () => {
  const gate: TrakStateDto = { _tag: "AwaitingHuman", step: 0, kind: "approval" }

  it("sinks idle groups below the live ones in their own section, newest activity first", () => {
    const sections = filed([
      trak("old", gate, { idle: true, active: 1_000, touched: 9_000 }),
      trak("live", gate, { touched: 1 }),
      trak("new", gate, { idle: true, active: 5_000 }),
      trak("unknown", gate, { idle: true }),
    ])
    expect(sections.map((s) => s.key)).toEqual(["attention"])
    expect(ids(sections[0])).toEqual(["live", "new", "old", "unknown"])
  })

  it("keeps a group live while any piece is live, and idle once every member is", () => {
    const parent: TrakStateDto = { _tag: "AwaitingChildren", step: 1 }
    const piece = (id: string, idle: boolean): TrakSummaryDto =>
      trak(id, gate, { parent: from("p", 0), ...(idle ? { idle: true } : {}) })
    const mixed = filed([
      trak("p", parent, { idle: true }),
      piece("a", true),
      piece("b", false),
      trak("lone", gate, { idle: true }),
    ])
    expect(ids(mixed[0])).toEqual(["p", "lone"])

    const whole = filed([
      trak("p", parent, { idle: true, active: 9_000 }),
      piece("a", true),
      trak("lone", gate, { idle: true, active: 1_000 }),
    ])
    expect(ids(whole[0])).toEqual(["p", "lone"])
  })
})
