// A press that writes to the project checkout runs to its end whoever stops waiting.
//
// The HTTP server interrupts a handler when its browser goes away, and a stash press
// interrupted between its stash and its restore leaves a person's changes in the stash
// with nothing on any screen saying so. What is pinned here is `HostGit`'s half: the
// press is the layer's fiber, and the caller only waits on it. The `Vcs` is a fake that
// stops between the two halves, because the point is where the interruption lands.
//
// The update after a merge is pinned here too: which press it makes, that it never
// stashes, and that the fetch it reads began after the merge.

import { Deferred, Effect, Fiber, Layer, Ref, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { NoVcsLayer } from "../vcs/adapters/none.js"
import { BranchName, HostHead, type HostStatus, StashedSync, SyncRefusal } from "../vcs/index.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { GitFailed } from "../vcs/types/errors.js"
import { HostGit, HostGitLayer, type HostGitView } from "./host-git.js"

/** Where a stash press stands: its two halves, and the gate held between them. */
interface Halves {
  readonly stashed: Deferred.Deferred<void>
  readonly gate: Deferred.Deferred<void>
  readonly restored: Ref.Ref<boolean>
}

/**
 * A repository behind its upstream whose stash press stashes, waits at `gate`, puts the
 * changes back and then fails as git would — so the press's outcome is one the bar keeps.
 */
const stoppingVcs = (halves: Halves) =>
  Layer.effect(
    Vcs,
    Effect.map(Vcs, (none) => ({
      ...none,
      hostStatus: () =>
        Effect.succeed({
          head: HostHead.Branch({ name: BranchName.make("main") }),
          origin: true,
          upstream: { name: "origin/main", ahead: 0, behind: 1 },
        }),
      fetch: () => Effect.succeed(undefined),
      stashAnd: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(halves.stashed, undefined)
          yield* Deferred.await(halves.gate)
          yield* Ref.set(halves.restored, true)
          return yield* Effect.fail(new GitFailed({ op: "pull", reason: "the merge failed" }))
        }),
    })),
  ).pipe(Layer.provide(NoVcsLayer))

/** Poll the bar, as a screen does, until it carries what the press came to. */
const ended = (status: Effect.Effect<HostGitView, GitFailed>) =>
  status.pipe(
    Effect.filterOrFail(
      (view) => view.failure !== undefined,
      () => "the press has not ended",
    ),
    Effect.retry(Schedule.spaced("5 millis")),
    Effect.timeout("5 seconds"),
  )

describe("a git bar press whose caller goes away", () => {
  it("still restores the stash and records what the press came to", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const halves: Halves = {
          stashed: yield* Deferred.make<void>(),
          gate: yield* Deferred.make<void>(),
          restored: yield* Ref.make(false),
        }
        yield* Effect.gen(function* () {
          const git = yield* HostGit
          const caller = yield* Effect.fork(git.pull({ stash: true }))
          yield* Deferred.await(halves.stashed)

          // The browser reloads: the request's fiber is interrupted, mid-press.
          yield* Fiber.interrupt(caller)
          expect(yield* Ref.get(halves.restored)).toBe(false)

          yield* Deferred.succeed(halves.gate, undefined)
          const after = yield* ended(git.status)
          expect(yield* Ref.get(halves.restored)).toBe(true)
          expect(after.failure).toMatchObject({ action: "pull", message: "pull: the merge failed" })
        }).pipe(Effect.provide(HostGitLayer.pipe(Layer.provide(stoppingVcs(halves)))))
      }).pipe(Effect.scoped),
    )
  })
})

/** How the checkout stands, and what its pull or reconcile answers. */
interface Checkout {
  readonly upstream: NonNullable<HostStatus["upstream"]>
  readonly answers?: SyncRefusal | "fails"
  /** Held open by the first fetch until it is done. */
  readonly firstFetch?: Deferred.Deferred<void>
}

/**
 * A repository on `main` that records every git call it is asked for. A stash press
 * records its stash and its restore with a pause between them, and a pull or reconcile
 * pauses before it records — where one write would land inside another if the two did
 * not take turns.
 */
const recordingVcs = (checkout: Checkout, calls: Ref.Ref<readonly string[]>) => {
  const record = (call: string) =>
    Ref.modify(calls, (all): readonly [number, readonly string[]] => [all.length, [...all, call]])
  // A pause before the fast-forward, so a stash press not taking turns would land in it.
  const press = (call: "pull" | "reconcile") =>
    Effect.flatMap(Effect.zipRight(Effect.sleep("5 millis"), record(call)), () =>
      checkout.answers === "fails"
        ? Effect.fail(new GitFailed({ op: call, reason: "index.lock exists" }))
        : Effect.succeed(checkout.answers),
    )
  return Layer.effect(
    Vcs,
    Effect.map(Vcs, (none) => ({
      ...none,
      hostStatus: () =>
        Effect.as(record("status"), {
          head: HostHead.Branch({ name: BranchName.make("main") }),
          origin: true,
          upstream: checkout.upstream,
        }),
      fetch: () =>
        Effect.gen(function* () {
          const before = yield* record("fetch")
          if (before === 0 && checkout.firstFetch !== undefined) {
            yield* Deferred.await(checkout.firstFetch)
          }
          return undefined
        }),
      pull: () => press("pull"),
      reconcile: () => press("reconcile"),
      push: () => Effect.as(record("push"), undefined),
      stashAnd: () =>
        Effect.gen(function* () {
          yield* record("stash")
          yield* Effect.sleep("20 millis")
          yield* record("restore")
          return StashedSync.Restored()
        }),
    })),
  ).pipe(Layer.provide(NoVcsLayer))
}

/** Wait until `calls` holds `count` of `call`. */
const recorded = (calls: Ref.Ref<readonly string[]>, call: string, count = 1) =>
  Ref.get(calls).pipe(
    Effect.filterOrFail(
      (all) => all.filter((c) => c === call).length >= count,
      () => `no ${call} yet`,
    ),
    Effect.retry(Schedule.spaced("5 millis")),
    Effect.timeout("5 seconds"),
  )

/**
 * Every call git was asked for once the update has ended, and the failure the bar then
 * holds. The update reads the status under the permit every write takes, so a push asked
 * for after that read runs once the update is done — and records itself last.
 */
const settledAfter = (calls: Ref.Ref<readonly string[]>) =>
  Effect.gen(function* () {
    const git = yield* HostGit
    yield* recorded(calls, "status")
    yield* git.push
    const all = yield* Ref.get(calls)
    return { calls: all, failure: (yield* git.status).failure }
  })

/** `body` against a `HostGit` over `checkout`, handed the calls it records. */
const onCheckout = <A, E>(
  checkout: Checkout,
  body: (calls: Ref.Ref<readonly string[]>) => Effect.Effect<A, E, HostGit>,
) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<readonly string[]>([])
    return yield* body(calls).pipe(
      Effect.provide(HostGitLayer.pipe(Layer.provide(recordingVcs(checkout, calls)))),
    )
  }).pipe(Effect.scoped, Effect.runPromise)

/** The update after a merge into `main` against `checkout`, to its end. */
const afterMergeOn = (checkout: Checkout) =>
  onCheckout(checkout, (calls) =>
    Effect.gen(function* () {
      yield* (yield* HostGit).afterMerge("main")
      return yield* settledAfter(calls)
    }),
  )

const BEHIND = { name: "origin/main", ahead: 0, behind: 2 }
const DIVERGED = { name: "origin/main", ahead: 1, behind: 2 }

describe("the update after a merge", () => {
  it("fast-forwards a clean checkout on the base that is only behind", async () => {
    expect(await afterMergeOn({ upstream: BEHIND })).toStrictEqual({
      calls: ["fetch", "status", "pull", "push"],
      failure: undefined,
    })
  })

  it("reconciles a clean checkout on the base that has diverged", async () => {
    expect(await afterMergeOn({ upstream: DIVERGED })).toStrictEqual({
      calls: ["fetch", "status", "reconcile", "push"],
      failure: undefined,
    })
  })

  it("leaves a merge that would conflict to the person, recording no failure", async () => {
    const answers = SyncRefusal.Conflicted({
      branch: BranchName.make("main"),
      upstream: "origin/main",
      files: ["README.md"],
    })
    expect(await afterMergeOn({ upstream: DIVERGED, answers })).toStrictEqual({
      calls: ["fetch", "status", "reconcile", "push"],
      failure: undefined,
    })
  })

  it("leaves a dirty tree to the person, and never stashes it", async () => {
    const answers = SyncRefusal.Dirty({ files: ["notes.md"] })
    expect(await afterMergeOn({ upstream: BEHIND, answers })).toStrictEqual({
      calls: ["fetch", "status", "pull", "push"],
      failure: undefined,
    })
  })

  it("only fetches where the checkout tracks another branch", async () => {
    const upstream = { name: "origin/feature", ahead: 0, behind: 2 }
    expect(await afterMergeOn({ upstream })).toStrictEqual({
      calls: ["fetch", "status", "push"],
      failure: undefined,
    })
  })

  it("records git's failure on the bar, as a press's is", async () => {
    const { failure } = await afterMergeOn({ upstream: BEHIND, answers: "fails" })
    expect(failure).toMatchObject({ action: "pull", message: "pull: index.lock exists" })
  })

  it("waits out a fetch already running and reads one that began after the merge", async () => {
    const firstFetch = await Effect.runPromise(Deferred.make<void>())
    const after = await onCheckout({ upstream: BEHIND, firstFetch }, (calls) =>
      Effect.gen(function* () {
        const git = yield* HostGit
        // A poll's fetch, already running when the merge lands.
        yield* Effect.fork(git.fetch)
        yield* recorded(calls, "fetch")
        yield* git.afterMerge("main")
        expect(yield* Ref.get(calls)).toStrictEqual(["fetch"])
        yield* Deferred.succeed(firstFetch, undefined)
        return yield* settledAfter(calls)
      }),
    )
    expect(after).toStrictEqual({
      calls: ["fetch", "fetch", "status", "pull", "push"],
      failure: undefined,
    })
  })

  // Both wake from the one fetch, and whichever takes the permit first runs to its end
  // before the other touches the checkout — so the update never reads the tree the stash
  // left clean for the moment.
  it("takes turns with a stash press both released by one fetch", async () => {
    const firstFetch = await Effect.runPromise(Deferred.make<void>())
    const after = await onCheckout({ upstream: BEHIND, firstFetch }, (calls) =>
      Effect.gen(function* () {
        const git = yield* HostGit
        yield* git.afterMerge("main")
        yield* recorded(calls, "fetch")
        const press = yield* Effect.fork(git.pull({ stash: true }))
        // Long enough for the press to be waiting on the fetch the update started.
        yield* Effect.sleep("20 millis")
        yield* Deferred.succeed(firstFetch, undefined)
        yield* Fiber.join(press)
        return yield* settledAfter(calls)
      }),
    )
    expect([
      ["fetch", "stash", "restore", "status", "pull", "push"],
      ["fetch", "status", "pull", "stash", "restore", "push"],
    ]).toContainEqual(after.calls)
  })
})
