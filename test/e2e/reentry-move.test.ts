// Re-entering a finished trak whose pull request squash-merged: the branch is moved onto
// the base before anything runs, or the re-entry is refused and nothing moves.
//
// Real git and a real `origin`, because what has to be true is where the branch stands
// there and here; the forge is a fake that reports the pull request merged with the head
// the test read off the branch.

import { spawnSync } from "node:child_process"
import { Deferred, Effect, Either, Exit, Fiber, Layer, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { ForgeAnswer, ForgeListing } from "../../src/vcs/index.js"
import { Forge, type ForgeShape } from "../../src/vcs/ports/forge.js"
import { type BranchMoved, type Event, Events } from "../../src/workflow/domain/event.js"
import { DrivesLayer, OtherCopies, reenterDrive, startDrive } from "../../src/app/drive.js"
import { advanceAfter } from "../../src/workflow/runtime.js"
import { instantClock } from "../support/clock.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { afterReentry, composer, onGit, runFlow, step } from "../support/flow.js"
import { refusesMerge, refusesOpen } from "../support/forge.js"
import {
  addOrigin,
  commitInWorktree,
  commitOnHost,
  git,
  type Origin,
  worktreeOf,
  writeWork,
} from "../support/git.js"
import { mount } from "../support/http.js"
import { reply } from "../support/scripted-agent.js"
import { act, create, expectState, human, idle } from "../support/scenario.js"

const { post } = mount(actionRoutes)

const TURNS = [composer("plan"), step(1, "plan", reply.artifact("the flag")), afterReentry("plan")]

const origins: Origin[] = []
afterEach(() => {
  for (const o of origins.splice(0)) o.remove()
})

/** What the fake forge lists for the trak's branch; set once the test knows the head. */
let listed: ForgeListing = ForgeListing.Listed({ entries: [] })

const forge = Layer.succeed(Forge, {
  pullRequest: () => Effect.succeed(ForgeAnswer.None()),
  listing: () => Effect.sync(() => listed),
  merge: refusesMerge,
  openPullRequest: refusesOpen,
} satisfies ForgeShape)

const mergedPull = (branch: string, head: string): ForgeListing =>
  ForgeListing.Listed({
    entries: [
      {
        branch,
        pull: {
          number: 1,
          title: "Add a flag",
          url: "https://example.com/pull/1",
          state: "merged",
          isDraft: false,
          merging: "clean",
          checks: "passed",
          head,
          base: "main",
        },
      },
    ],
  })

/** Why the re-entry was refused — loud where it was refused for anything else. */
const notMovedWhy = (response: HttpServerResponse) =>
  Effect.promise(async () => {
    const refusal = Schema.decodeUnknownSync(RefusalDto)(await toWeb(response).json())
    if (refusal._tag !== "BranchNotMoved") throw new Error(`refused as ${refusal._tag}`)
    return refusal.why
  })

/** Whether the repository at `repo` has the commit `sha`. */
const holds = (repo: string, sha: string): boolean =>
  spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo, stdio: "ignore" }).status ===
  0

const isReentry = (e: Event): boolean => e._tag === "Reentered"

/**
 * How the pull request went in: `plain`, a squash; `clash`, a squash and then `main`
 * writing `flag.ts` too; `forge`, a commit made on the forge onto the pull request first,
 * then a squash, then the branch deleted — so the merged head is only on `origin`, under
 * the pull request's own ref as GitHub keeps it.
 */
type Landing = "plain" | "clash" | "forge"

/**
 * A trak finished with `flag.ts`, its branch pushed and merged into `origin`'s `main` by
 * somebody else as `landing` says, then one commit made on the branch after the head it
 * pushed. `head` is the merged head the forge reports.
 */
const mergedThenMore = (id: TrakId, repoDir: string, landing: Landing) =>
  Effect.gen(function* () {
    const from = addOrigin(repoDir)
    origins.push(from)
    const worktree = worktreeOf(yield* create(id, "Add a flag"))
    writeWork(worktree, "flag.ts", "the flag\n")
    yield* act(id, 0, human.approve())
    expectState(yield* act(id, 1, human.approve()), "Finished")
    git(repoDir, "push", "--quiet", "origin", worktree.branch)

    git(from.elsewhere, "pull", "--quiet", "--ff-only")
    git(from.elsewhere, "fetch", "--quiet", "origin", worktree.branch)
    if (landing === "forge") {
      git(from.elsewhere, "checkout", "--quiet", "-b", "suggested", "FETCH_HEAD")
      commitOnHost(from.elsewhere, "suggested.ts", "from a review\n")
      git(from.elsewhere, "push", "--quiet", "origin", "HEAD:refs/pull/1/head")
      git(from.elsewhere, "checkout", "--quiet", "main")
      git(from.elsewhere, "merge", "--quiet", "--squash", "suggested")
    } else {
      git(from.elsewhere, "merge", "--quiet", "--squash", "FETCH_HEAD")
    }
    const head =
      landing === "forge"
        ? git(from.elsewhere, "rev-parse", "suggested")
        : git(repoDir, "rev-parse", worktree.branch)
    git(from.elsewhere, "commit", "--quiet", "-m", "Add a flag (#1)")
    if (landing === "clash") commitOnHost(from.elsewhere, "flag.ts", "main's flag\n")
    else commitOnHost(from.elsewhere, "other.ts", "elsewhere\n")
    git(from.elsewhere, "push", "--quiet", "origin", "main")
    if (landing === "forge")
      git(from.elsewhere, "push", "--quiet", "origin", "--delete", worktree.branch)

    writeWork(worktree, "flag.ts", "the later flag\n")
    commitInWorktree(worktree, "later work")
    listed = mergedPull(worktree.branch, head)
    return { from, worktree, head }
  })

const eventsOf = (id: TrakId) => Effect.flatMap(Store, (store) => store.events(id))

describe("re-entering a trak whose pull request merged", () => {
  it("moves the branch onto the base and pushes it before anything runs", async () => {
    await onGit.runFlow(
      TURNS,
      (id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const { from, worktree, head } = yield* mergedThenMore(id, repoDir, "plain")

          const response = yield* post(id, "reenter", { what: "one more thing" })
          expect(response.status).toBe(202)
          yield* idle(id)

          const main = git(from.origin, "rev-parse", "main")
          const pushed = git(from.origin, "rev-parse", worktree.branch)
          // Only the commit after the merged head, on top of the base's tip.
          expect(git(from.origin, "log", "--format=%s", `main..${worktree.branch}`)).toBe(
            "later work",
          )
          expect(git(from.origin, "rev-parse", `${worktree.branch}^`)).toBe(main)
          expect(git(repoDir, "rev-parse", worktree.branch)).toBe(pushed)

          const reentry = (yield* eventsOf(id)).find(isReentry)
          expect(reentry).toMatchObject({ moved: { merged: head, base: "main", onto: main } })
        }),
      undefined,
      undefined,
      forge,
    )
  })

  it("refuses with git's account on a conflict, and moves nothing anywhere", async () => {
    await onGit.runFlow(
      TURNS,
      (id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const { from, worktree, head } = yield* mergedThenMore(id, repoDir, "clash")
          const before = yield* eventsOf(id)
          const tip = git(repoDir, "rev-parse", worktree.branch)

          const response = yield* post(id, "reenter", { what: "one more thing" })
          expect(response.status).toBe(409)
          expect(yield* notMovedWhy(response)).toContain("CONFLICT")

          const after = yield* eventsOf(id)
          expect(after.length).toBe(before.length)
          expect(replayHistory(id, after).state._tag).toBe("Finished")
          expect(git(repoDir, "rev-parse", worktree.branch)).toBe(tip)
          expect(git(from.origin, "rev-parse", worktree.branch)).toBe(head)
          expect(git(worktree.path, "status", "--porcelain")).toBe("")
        }),
      undefined,
      undefined,
      forge,
    )
  })

  it("fetches a merged head only origin holds, and moves the branch off it", async () => {
    await onGit.runFlow(
      TURNS,
      (id, _agents, _checks, repoDir) =>
        Effect.gen(function* () {
          const { from, worktree, head } = yield* mergedThenMore(id, repoDir, "forge")
          // The precondition the case is about: this checkout never saw the forge's commit.
          expect(holds(repoDir, head)).toBe(false)

          const response = yield* post(id, "reenter", { what: "one more thing" })
          expect(response.status).toBe(202)
          yield* idle(id)

          const main = git(from.origin, "rev-parse", "main")
          expect(git(from.origin, "log", "--format=%s", `main..${worktree.branch}`)).toBe(
            "later work",
          )
          expect(git(from.origin, "rev-parse", `${worktree.branch}^`)).toBe(main)
          const reentry = (yield* eventsOf(id)).find(isReentry)
          expect(reentry).toMatchObject({ moved: { merged: head, base: "main", onto: main } })
        }),
      undefined,
      undefined,
      forge,
    )
  })

  it("refuses where the forge cannot be asked, rather than going ahead unchecked", async () => {
    await runFlow(
      TURNS,
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Add a flag")
          yield* act(id, 0, human.approve())
          expectState(yield* act(id, 1, human.approve()), "Finished")
          listed = ForgeListing.Unavailable({ why: "gh is not signed in" })
          const before = yield* eventsOf(id)

          const response = yield* post(id, "reenter", { what: "one more thing" })
          expect(response.status).toBe(409)
          expect(yield* notMovedWhy(response)).toContain("gh is not signed in")
          expect((yield* eventsOf(id)).length).toBe(before.length)
        }),
      undefined,
      undefined,
      forge,
    )
  })
})

/** A trak run to `Finished`, with no pull request on its branch. */
const finished = (id: TrakId) =>
  Effect.gen(function* () {
    listed = ForgeListing.Listed({ entries: [] })
    yield* create(id, "Add a flag")
    yield* act(id, 0, human.approve())
    expectState(yield* act(id, 1, human.approve()), "Finished")
  })

/**
 * Other engine copies that hold nothing, whose first lease read waits for `release` after
 * saying so on `entered` — the read under an external store that yields between the key check
 * and the fork.
 */
const slowFirstRead = (entered: Deferred.Deferred<void>, release: Deferred.Deferred<void>) => {
  let reads = 0
  return Layer.succeed(OtherCopies, {
    elsewhere: () =>
      Effect.suspend(() => {
        reads += 1
        return reads === 1
          ? Effect.as(
              Effect.zipRight(Deferred.succeed(entered, undefined), Deferred.await(release)),
              undefined,
            )
          : Effect.succeed(undefined)
      }),
    heldThere: () => Effect.succeed(false),
    leaseMoved: () => Effect.succeed(false),
    awaitLetGo: () => Effect.void,
  })
}

/** The first re-entry's answer, where a second press takes the key while its read waits. */
const raceForKey = (
  id: TrakId,
  entered: Deferred.Deferred<void>,
  release: Deferred.Deferred<void>,
) =>
  Effect.gen(function* () {
    const asking = yield* Effect.fork(reenterDrive(id, firstReentry))
    yield* Deferred.await(entered)
    // Another press takes the key, and lets the first read finish while it holds it.
    const other = yield* startDrive(id, () => releasing(release)).pipe(Effect.orDie)
    expect(other.status).toBe(202)
    expect(yield* Fiber.join(asking)).toBe("busy")
    yield* idle(id)
  })

const firstReentry = (moved: BranchMoved | undefined): Event =>
  Events.reentered("first", undefined, undefined, moved)

/** The second press's event, chosen under the key it holds — the moment to let the read go. */
const releasing = (release: Deferred.Deferred<void>): Event => {
  Deferred.unsafeDone(release, Exit.void)
  return Events.reentered("second")
}

describe("the drive a re-entry waits on", () => {
  it("answers busy where another drive takes the key during the lease read", async () => {
    await runFlow(
      TURNS,
      (id) =>
        Effect.gen(function* () {
          yield* finished(id)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const raced = raceForKey(id, entered, release)
          yield* Effect.provide(
            raced,
            DrivesLayer.pipe(Layer.provide(slowFirstRead(entered, release))),
          )
          const reentries = (yield* eventsOf(id)).filter(isReentry)
          expect(reentries).toMatchObject([{ what: "second" }])
        }),
      undefined,
      undefined,
      forge,
    )
  })
})

describe("a move and its append", () => {
  it("lets the move's own limit fire", async () => {
    await runFlow(
      TURNS,
      (id) =>
        Effect.gen(function* () {
          yield* finished(id)
          // Every sleep is over at once, so the limit is due as soon as it is asked;
          // nothing but the limit can end a move that never answers.
          const hung = Effect.never.pipe(
            Effect.timeoutFail({ duration: "2 minutes", onTimeout: () => "past its limit" }),
          )
          const ended = yield* Effect.either(
            advanceAfter(id, hung).pipe(Effect.withClock(instantClock)),
          )
          expect(ended).toStrictEqual(Either.left("past its limit"))
          expect((yield* eventsOf(id)).filter(isReentry)).toStrictEqual([])
        }),
      undefined,
      undefined,
      forge,
    )
  })

  it("appends what the move chose though the drive is interrupted during it", async () => {
    await runFlow(
      TURNS,
      (id) =>
        Effect.gen(function* () {
          yield* finished(id)
          const moving = yield* Deferred.make<void>()
          const pushed = yield* Deferred.make<void>()
          const move = Effect.zipRight(
            Deferred.succeed(moving, undefined),
            Effect.as(Deferred.await(pushed), Events.reentered("moved")),
          )
          const drive = yield* Effect.fork(advanceAfter(id, move))
          yield* Deferred.await(moving)
          const stopping = yield* Effect.fork(Fiber.interrupt(drive))
          yield* Effect.yieldNow()
          yield* Deferred.succeed(pushed, undefined)
          expect(Exit.isInterrupted(yield* Fiber.join(stopping))).toBe(true)
          expect((yield* eventsOf(id)).filter(isReentry)).toMatchObject([{ what: "moved" }])
        }),
      undefined,
      undefined,
      forge,
    )
  })
})
