// Tier-1: which two commits a slice of the work sits between.
//
// The interesting half of the changes route. Everything a person will notice
// being wrong — a step showing the step before it, a retried step showing only
// its retry — is decided here, off the log alone.

import { describe, expect, it } from "vitest"
import { BranchName, CommitSha, Worktree, WorktreePath } from "../vcs/index.js"
import { type Event, Events } from "../workflow/domain/event.js"
import { emptyTrak, type Trak, TrakId } from "../workflow/domain/trak.js"
import { rangeFor, requestedAt } from "./changes.js"

const BASE = CommitSha.make("base0000")
const sha = (s: string): CommitSha => CommitSha.make(s)

const worktree = Worktree.make({
  path: WorktreePath.make("/tmp/wk"),
  branch: BranchName.make("trak/t1"),
  base: BASE,
})

const trakWith = (log: readonly Event[]): { trak: Trak; log: readonly Event[] } => ({
  trak: { ...emptyTrak(TrakId.make("t1")), worktree },
  log,
})

/** One piece of a spawn coming back, with the commit it kept on its own branch. */
const landed = (step: number, child: number, kept: CommitSha): Event =>
  Events.childLanded({
    step,
    child,
    id: TrakId.make(`t1-${String(child)}`),
    branch: BranchName.make(`trak/t1-${String(child)}`),
    sha: kept,
    artifacts: [],
    decisions: [],
    handUp: undefined,
  })

describe("what the at parameter is allowed to say", () => {
  it("reads the three forms the picker offers", () => {
    expect(requestedAt("all")).toBe("all")
    expect(requestedAt("uncommitted")).toBe("uncommitted")
    expect(requestedAt("3")).toBe(3)
  })

  it("takes an absent parameter as the whole branch", () => {
    // The one slice every trak can answer, and what a caller with nothing
    // particular in mind means.
    expect(requestedAt(undefined)).toBe("all")
  })

  it("refuses anything else, rather than guessing a slice", () => {
    // A 400, and deliberately not an empty answer: *I do not know what you asked
    // for* and *there is nothing there* are different sentences, and only one of
    // them is about the work.
    expect(requestedAt("HEAD~1")).toBeUndefined()
    expect(requestedAt("-1")).toBeUndefined()
    expect(requestedAt("2.5")).toBeUndefined()
    expect(requestedAt("")).toBeUndefined()
  })
})

describe("the whole branch, and what is not on it yet", () => {
  it("is the recorded base against the branch, with no merge-base asked", () => {
    // The exact fork commit is already written down, which is why no branch name
    // is stored anywhere and no merge-base runs.
    const { trak, log } = trakWith([])
    expect(rangeFor(trak, log, "all")).toEqual({ _tag: "Branch", worktree })
  })

  it("asks the checkout for the uncommitted slice, and nothing else does", () => {
    const { trak, log } = trakWith([])
    expect(rangeFor(trak, log, "uncommitted")).toEqual({ _tag: "Uncommitted", worktree })
  })

  it("has nothing to read at all for a trak that never got a checkout", () => {
    const trak: Trak = emptyTrak(TrakId.make("t1"))
    expect(rangeFor(trak, [], "all")).toBeUndefined()
    expect(rangeFor(trak, [], 1)).toBeUndefined()
  })
})

describe("one step's work, between the commits either side of it", () => {
  it("runs from the base for the first position that committed", () => {
    const { trak, log } = trakWith([Events.workCommitted(sha("aaa"), 1)])
    expect(rangeFor(trak, log, 1)).toEqual({ _tag: "Commits", from: BASE, to: sha("aaa") })
  })

  it("runs from the previous position's commit for every one after", () => {
    const { trak, log } = trakWith([
      Events.workCommitted(sha("aaa"), 1),
      Events.workCommitted(sha("bbb"), 2),
    ])
    expect(rangeFor(trak, log, 2)).toEqual({ _tag: "Commits", from: sha("aaa"), to: sha("bbb") })
  })

  it("is an empty range for a step that changed nothing", () => {
    // `Vcs.commitWork` reads its answer off the branch rather than off what it
    // just committed, so a step that wrote nothing reports the sha the step
    // before it did. Skipping back to the last *different* sha would show that
    // earlier step's work under this one's name; the previous position's sha
    // gives `from === to`, which is an empty diff — what actually happened.
    const { trak, log } = trakWith([
      Events.workCommitted(sha("aaa"), 1),
      Events.workCommitted(sha("aaa"), 2),
    ])
    expect(rangeFor(trak, log, 2)).toEqual({ _tag: "Commits", from: sha("aaa"), to: sha("aaa") })
  })

  it("covers a retried step whole, rather than only its second attempt", () => {
    // A restart commits again under the same index, so the log carries two.
    // Diffing against the first would show the retry alone and hide everything
    // the failed attempt had already kept.
    const { trak, log } = trakWith([
      Events.workCommitted(sha("aaa"), 1),
      Events.workCommitted(sha("bbb"), 2),
      Events.workCommitted(sha("ccc"), 2),
    ])
    expect(rangeFor(trak, log, 2)).toEqual({ _tag: "Commits", from: sha("aaa"), to: sha("ccc") })
  })

  it("counts a commit with no position as a commit like any other", () => {
    // The composer's, which the log records with no `step` — it is still work on
    // the branch, so the step after it starts where it left off.
    const { trak, log } = trakWith([
      Events.workCommitted(sha("aaa")),
      Events.workCommitted(sha("bbb"), 1),
    ])
    expect(rangeFor(trak, log, 1)).toEqual({ _tag: "Commits", from: sha("aaa"), to: sha("bbb") })
  })

  it("spans every piece's merge at a spawn whose children have joined", () => {
    // A spawn keeps its work like any other position: `ChildrenJoined` decides
    // `keepStep` at the spawn's own index, so `CommitWork` runs there and the sha
    // it reports is the parent's branch tip once all three merges have landed.
    // The near end is still the *previous position's* commit, which is what makes
    // the range the join rather than whichever merge went last.
    //
    // The spawn and the landings are written out because they are what a reader
    // checks the fixture against — `keptIn` ignores them, so a case with only the
    // `WorkCommitted` could not be told from the agent turn above. They also carry
    // shas of their own, and none of them is an end of this range: a piece's
    // commit is on the piece's branch, and only the merge of it is on this one.
    const { trak, log } = trakWith([
      Events.workCommitted(sha("aaa"), 1),
      Events.workCommitted(sha("bbb"), 2),
      Events.childrenSpawned(3, [TrakId.make("t1-0"), TrakId.make("t1-1")]),
      landed(3, 0, sha("piece0")),
      landed(3, 1, sha("piece1")),
      Events.childrenJoined(3, [sha("merge0"), sha("merge1")]),
      Events.workCommitted(sha("tip"), 3),
    ])
    expect(rangeFor(trak, log, 3)).toEqual({ _tag: "Commits", from: sha("bbb"), to: sha("tip") })
  })

  it("has nothing at a spawn whose children have not joined", () => {
    // The same log with the join and the commit cut off it, which is what a spawn
    // being watched looks like. There is no sha for the position yet, so the
    // picker offers it no row and the route answers empty rather than reaching
    // for a piece's own commit.
    const { trak, log } = trakWith([
      Events.workCommitted(sha("bbb"), 2),
      Events.childrenSpawned(3, [TrakId.make("t1-0"), TrakId.make("t1-1")]),
      landed(3, 0, sha("piece0")),
    ])
    expect(rangeFor(trak, log, 3)).toBeUndefined()
  })

  it("has nothing for a position that kept nothing", () => {
    // A compose has no sha of its own, and neither has a step whose commit came
    // back empty — nor a position the plan never reached. An empty answer, not a
    // failure. The un-joined spawn is the case above, which is a different log
    // rather than another reading of this one.
    const { trak, log } = trakWith([
      Events.workCommitted(undefined, 1),
      Events.workCommitted(sha("bbb"), 2),
    ])
    expect(rangeFor(trak, log, 1)).toBeUndefined()
    expect(rangeFor(trak, log, 7)).toBeUndefined()
  })
})
