// Where a child of a spawn branches from, and what landing it on its parent does: a
// merge, a drop, a conflict, and a child that never comes back. The rest of the spawn
// is `spawn.test.ts`.

import { seedLog } from "../support/seed.js"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  afterConflict,
  afterReplan,
  child,
  childStep,
  composer,
  onGit,
  spawn,
  step,
} from "../support/flow.js"
import { commitOnHost, git, inWorktree, repoOf, worktreeOf, writeWork } from "../support/git.js"
import {
  approveAll,
  createAndStart,
  human,
  interrupted,
  restartsOn,
  act,
} from "../support/scenario.js"
import { library } from "../support/library.js"
import { forgeSaying } from "../support/forge.js"
import { onResume, reply } from "../support/scripted-agent.js"
import { ForgeAnswer } from "../../src/vcs/index.js"
import { SessionId } from "../../src/agent/types/session.js"
import { slotAt, type Trak, type TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { driveChild } from "../../src/workflow/runtime.js"
import { Events } from "../../src/workflow/domain/event.js"
import { current, dropChild, lenses, mergeChild } from "../support/spawn.js"

// The subject here is git, so every flow runs on it.
const { runFlow } = onGit

/** What the join recorded it merged, off the parent's own log. */
const mergedShas = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const log = yield* store.events(id)
    return log.flatMap((e) => (e._tag === "ChildrenJoined" ? e.merged : []))
  })

/** The session a child's turn was using when the process driving it was killed. */
const CUT_OFF = SessionId.make("00000000-0000-4000-8000-0000000000ff")

/**
 * Two pieces of one change, and a human keeps one and drops the other. `review`
 * rather than an agent that sounds like it writes code, because what a test can
 * script is the reply — `writeWork` stands in for the edits.
 */
const pieces = spawn(child("review", "the handler"), child("review", "the client"))

const piecesFlow = [
  composer("work", pieces, "plan"),
  step(1, "work", reply.artifact("the change")),
  childStep("review", "the handler", reply.artifact("handler done")),
  childStep("review", "the client", reply.artifact("client done")),
  step(3, "plan", reply.artifact("both in")),
]

describe("where a child branches from", () => {
  it("hands every child the parent's branch, never the main line", () =>
    runFlow(piecesFlow, (id) =>
      Effect.gen(function* () {
        // No `standalone` bit chooses between these two: a piece that ships on
        // its own still has to come back, or the parent is building against a
        // world that moved. Where it *goes out* is a pull request, which is an
        // action at closing rather than a branch base.
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        const repoDir = repoOf(worktreeOf(parked).path)

        // The host's line moves on after the parent branched off it, which is
        // what makes a base assertion mean anything at all: until something
        // commits, the parent's branch and `HEAD` are the same commit.
        commitOnHost(repoDir, "shipped.ts", "export const shipped = true\n")

        // Not a branch name comparison: what a base *means* is what the agent
        // opens the directory and finds.
        for (const i of [0, 1]) {
          expect(inWorktree(worktreeOf(yield* driveChild(parked, 2, i)), "shipped.ts")).toBe(false)
        }
      }),
    ))

  it("hands a child what the parent's own earlier step already committed", () =>
    runFlow(piecesFlow, (id) =>
      Effect.gen(function* () {
        // Per-step auto-commit is what makes this true: a child branches from
        // the parent's branch, and before it the parent had only ever committed
        // once, at the very end — so at spawn time its own earlier step's edits
        // were sitting uncommitted in the checkout, invisible to a branch. See
        // the closed TODO entry this test replaces.
        const worktree = worktreeOf(yield* createAndStart(id, "Rate-limit the public API"))
        writeWork(worktree, "handler.ts", "export const handler = true\n")
        const parked = yield* act(id, 1, human.approve())

        expect(inWorktree(worktreeOf(yield* driveChild(parked, 2, 0)), "handler.ts")).toBe(true)
      }),
    ))
})

describe("the verdict a human gives a finished child", () => {
  it("merges one into the parent when it lands, and leaves a dropped one on its branch", () =>
    runFlow(piecesFlow, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        const parent = worktreeOf(parked)
        const repoDir = repoOf(parent.path)

        const kept = yield* driveChild(parked, 2, 0)
        writeWork(worktreeOf(kept), "handler.ts", "export const handler = true\n")
        yield* mergeChild(yield* approveAll(kept.id, kept))

        // **Already in, before the join.** The merge is what a human asked for,
        // so it happens when they ask rather than being promised for later.
        expect(inWorktree(parent, "handler.ts")).toBe(true)

        const dropped = yield* driveChild(parked, 2, 1)
        const droppedBranch = worktreeOf(dropped).branch
        writeWork(worktreeOf(dropped), "client.ts", "export const client = true\n")
        yield* dropChild(yield* approveAll(dropped.id, dropped))

        // The step after the spawn is standing on the work that was kept and
        // beside the work that was not — which is the whole of what a verdict is.
        expect(inWorktree(parent, "client.ts")).toBe(false)
        expect(yield* mergedShas(id)).toHaveLength(1)

        // The drop is an archive: the branch goes with the checkout, so what a
        // dropped piece leaves is its artifact and decisions on the parent — the
        // confirmation on the press is what stood between a person and this.
        expect(git(repoDir, "branch", "--list", droppedBranch)).toBe("")
        expect(git(repoDir, "log", "-1", "--format=%s", parent.branch)).toContain("Merge trak/")
      }),
    ))

  it("lands a piece whose pull request merged as landed, not dropped", () =>
    runFlow(
      piecesFlow,
      (id) =>
        Effect.gen(function* () {
          // The person presses the drop — but the archive asks GitHub on the way, and
          // the answer says this piece's work went in over there. `Closed` is literally
          // the word the parent reads as *dropped*, so the sha is what keeps a merged
          // piece from reporting as work that vanished.
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())

          const run = yield* driveChild(parked, 2, 0)
          yield* dropChild(yield* approveAll(run.id, run))

          expect((yield* current(run.id)).state).toEqual({
            _tag: "Merged",
            sha: "9f31c07aa11",
          })
          const landing = slotAt(yield* current(id), 2).children[0]?.landing
          expect(landing?.sha).toBe("9f31c07aa11")
        }),
      undefined,
      undefined,
      forgeSaying(
        ForgeAnswer.Found({
          pullRequest: {
            number: 14,
            url: "https://forge/pr/14",
            title: "the piece",
            state: "merged",
            mergeCommit: "9f31c07aa11",
            isDraft: false,
            merging: "unknown",
            rollup: "passed",
            checks: [],
            reviews: [],
            conversation: [],
            truncated: [],
            mergeMethods: [],
          },
        }),
      ),
    ))

  it("merges into the parent cleanly, because the parent's own earlier step is already committed", () =>
    runFlow(piecesFlow, (id) =>
      Effect.gen(function* () {
        // The refusal this closes needs a parent checkout dirty with its own
        // earlier step's edits — exactly what a merge into it conflicts with.
        const worktree = worktreeOf(yield* createAndStart(id, "Rate-limit the public API"))
        writeWork(worktree, "handler.ts", "export const handler = true\n")
        const parked = yield* act(id, 1, human.approve())

        const kept = yield* driveChild(parked, 2, 0)
        writeWork(worktreeOf(kept), "the-piece.ts", "export const piece = true\n")
        yield* mergeChild(yield* approveAll(kept.id, kept))

        // One child of two is back — still parked, not `Failed{worktree}`.
        const parent = yield* current(id)
        expect(parent.state).toEqual({ _tag: "AwaitingChildren", step: 2 })
        expect(inWorktree(worktreeOf(parent), "handler.ts")).toBe(true)
        expect(inWorktree(worktreeOf(parent), "the-piece.ts")).toBe(true)
      }),
    ))

  it("folds a dropped child's artifact and decisions onto the parent anyway", () =>
    runFlow(piecesFlow, (id) =>
      Effect.gen(function* () {
        // The asymmetry someone will later "fix". A ruled-out approach is often
        // the most valuable thing a dropped piece produces.
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())

        for (const i of [0, 1]) {
          const run = yield* driveChild(parked, 2, i)
          yield* dropChild(yield* approveAll(run.id, run))
        }

        const done = yield* current(id)
        expect([...done.artifacts.keys()]).toContain("2.0-review/0-review")
        expect([...done.artifacts.keys()]).toContain("2.1-review/0-review")
        expect(yield* mergedShas(id)).toHaveLength(0)
      }),
    ))
})

describe("a spawn planned from the middle of a conversation", () => {
  it("merges a child into the parent cleanly, because the conversation's edits were kept first", () =>
    runFlow(
      [
        composer({ agent: "work", conversational: true }),
        step(1, "work", reply.prose("Here is a first study.")),
        afterReplan(pieces),
        childStep("review", "the handler", reply.artifact("handler done")),
      ],
      (id) =>
        Effect.gen(function* () {
          // `blank-white-booby`: a conversational step edited the checkout and filed
          // nothing, and the person replanned into a spawn from the conversation. A
          // tool both it and the child ran rewrote the same file, so the parent's
          // copy is still uncommitted when the child's committed one comes back.
          const talking = yield* createAndStart(id, "Rate-limit the public API")
          writeWork(worktreeOf(talking), "vendored.md", "rewritten by the tool\n")
          yield* act(id, 1, human.replan("split it in two"))
          const parked = yield* act(id, 2, human.approve())
          expect(parked.state).toEqual({ _tag: "AwaitingChildren", step: 3 })

          const kept = yield* driveChild(parked, 3, 0)
          writeWork(worktreeOf(kept), "vendored.md", "rewritten by the tool\n")
          writeWork(worktreeOf(kept), "the-piece.ts", "export const piece = true\n")
          yield* mergeChild(yield* approveAll(kept.id, kept))

          // Not `Failed{merge}` — git refusing to overwrite the parent's
          // uncommitted copy.
          expect((yield* current(kept.id)).state).toMatchObject({ _tag: "Merged" })
          expect(inWorktree(worktreeOf(yield* current(id)), "the-piece.ts")).toBe(true)
        }),
    ))
})

describe("a merge that conflicts", () => {
  const clashing = spawn(child("review", "the handler"), child("review", "the client"))

  it("stops the child rather than the parent, with both branches intact", () =>
    runFlow(
      [
        composer("work", clashing, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "the handler", reply.artifact("handler done")),
        childStep("review", "the client", reply.artifact("client done")),
        afterConflict("review"),
        step(3, "plan", reply.artifact("both in")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())
          const parent = worktreeOf(parked)
          const repoDir = repoOf(parent.path)

          // Both branch from the same tip and both write the same file
          // differently. Nothing else in this system can conflict.
          const branches: string[] = []
          const settled: Trak[] = []
          for (const i of [0, 1]) {
            const run = yield* driveChild(parked, 2, i)
            branches.push(worktreeOf(run).branch)
            writeWork(worktreeOf(run), "notes.md", `written by child ${i}\n`)
            settled.push(yield* approveAll(run.id, run))
          }
          const [first, second] = settled
          // Unreachable: the loop above pushed exactly two.
          if (first === undefined || second === undefined) return yield* Effect.die("two children")
          yield* mergeChild(first)
          yield* mergeChild(second)

          // **The child stops, not the parent.** The person merging is looking at
          // the piece that would not go in, with its siblings untouched — where a
          // conflict at the join surfaced once every child was already done.
          //
          // And it stops at a plan rather than at `Failed`: two pieces of one split
          // editing the same file is the work disagreeing, so the child asks its
          // composer what settling it takes. See `test/e2e/merge-conflict.test.ts`.
          const stopped = yield* current(second.id)
          expect(stopped.state).toMatchObject({ _tag: "AwaitingProposal" })
          expect(stopped.reconsult?.why).toMatchObject({
            _tag: "Conflicted",
            paths: ["notes.md"],
            into: parent.branch,
          })
          expect((yield* current(id)).state).toMatchObject({ _tag: "AwaitingChildren" })

          // The first merge stands — its work is in the parent's checkout, so its
          // branch went with its archive. The second is aborted rather than left
          // half-applied, and its branch survives untouched: a conflict never
          // reaches `RemoveWorktree`, so nothing can delete the one copy of work
          // somebody still has to settle.
          expect(git(parent.path, "status", "--porcelain")).toBe("")
          const [merged, conflicted] = branches
          expect(git(repoDir, "branch", "--list", merged ?? "")).toBe("")
          expect(git(repoDir, "branch", "--list", conflicted ?? "")).not.toBe("")
        }),
    ))
})

describe("a child that does not come back", () => {
  it("leaves the parent parked, and driving it again picks the child back up", () =>
    runFlow(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        // The first lens gets stuck and stays stuck for its first turn; the
        // human agrees to nothing, so the parent still owes it an event.
        childStep("review", "security", reply.stuck("read the handler twice")),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())

          // Only the second lens is driven, so the first never lands.
          const half = yield* driveChild(parked, 2, 1)
          yield* mergeChild(yield* approveAll(half.id, half))
          const waiting = yield* current(id)
          expect(waiting.state).toEqual({ _tag: "AwaitingChildren", step: 2 })
          expect(slotAt(waiting, 2).children[0]?.landing).toBeUndefined()
          expect(slotAt(waiting, 2).children[1]?.landing).toBeDefined()

          // No failure is a dead end, applied to the one await that owes traks
          // rather than a person: driving the parent again re-drives what is
          // actually missing, and the landed sibling is not touched.
          const stuck = yield* driveChild(waiting, 2, 0)
          expect(stuck.state).toEqual({ _tag: "AwaitingHuman", step: 0, kind: "stuck" })
          yield* mergeChild(yield* approveAll(stuck.id, stuck))
          const joined = yield* current(id)
          expect(joined.state).toEqual({ _tag: "AwaitingHuman", step: 3, kind: "approval" })
        }),
      library(),
    ))

  it("names the turn it is ending when a killed daemon left one in flight", () =>
    runFlow(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.stuck("read the handler twice")),
        onResume(reply.artifact("second look"), "the child's own retry"),
      ],
      (id) =>
        Effect.gen(function* () {
          const store = yield* Store
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())
          const kid = yield* driveChild(parked, 2, 0)

          // A person answered the stuck child, and the daemon was killed while the
          // turn that answer started was running: the event that began it is on the
          // log, nothing ended it, and `run.json` still names it. Appended rather
          // than driven, because unwinding in-process is what clears the record —
          // see `interrupted`.
          yield* seedLog(store, kid.id, [Events.humanActed(0, human.chat("look again"))])
          yield* interrupted(kid.id, { step: 0, sessionId: CUT_OFF })

          const again = yield* driveChild(yield* current(id), 2, 0)
          expect(again.state).toEqual({ _tag: "AwaitingHuman", step: 0, kind: "approval" })

          // The pick-up is that turn's only ending, and a `Restarted` naming no
          // position is not one: uncounted, the retry's document lands a section
          // above its own rows on every surface that pairs the two by counting.
          //
          // And no session with it. Carrying on the conversation the dead process
          // was having is the half
          // the deferred entry *a child cut off before its first reply loses the session it was using*
          // holds — it changes what the retry costs, where this changes what the log says.
          expect(yield* restartsOn(kid.id)).toEqual([Events.restarted(undefined, 0)])
        }),
      library(),
    ))
})
