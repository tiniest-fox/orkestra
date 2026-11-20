// The git bar's memory: when this engine last fetched, the press that last failed, and
// the one fetch everybody asking shares.
//
// Here rather than in `vcs/` for `deploys.ts`'s reason: git holds the refs and this holds
// what no ref records — whether this engine's own fetch went through, and when. A fetch
// run in a terminal moves the refs too, and says nothing about whether ours failed.
//
// **The automatic fetch rides the status read, never a timer.** `status` starts one when
// the last began over `FETCH_STALE_AFTER` ago, so fetching happens only while a screen is
// polling — the person's credentials are not used against their remote while nobody is
// looking. A daemon restart forgets all of it, and the first read after one fetches.
//
// **A merge through the engine is the one other trigger**: `afterMerge` fetches and then
// pulls or reconciles where that is free, because the person's next press after a merge
// is almost always that one.

import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Either,
  Fiber,
  Layer,
  Ref,
  Scope,
} from "effect"
import {
  type HostStatus,
  type StashedPress,
  StashedSync,
  type SyncRefusal,
  updateAfterMerge,
} from "../vcs/index.js"
import type { GitFailed } from "../vcs/types/errors.js"
import { Vcs, type VcsShape } from "../vcs/ports/vcs.js"

/** How old the last fetch may be before a status read starts another. */
export const FETCH_STALE_AFTER = Duration.minutes(5)

type GitAction = "fetch" | "pull" | "reconcile" | "push"

/** A press that git refused to carry out, in git's own words. */
export interface GitFailure {
  readonly action: GitAction
  readonly message: string
  /** When it failed, epoch milliseconds. */
  readonly at: number
}

/** Everything the bar draws: git's answer, and this engine's memory beside it. */
export interface HostGitView {
  readonly status: HostStatus
  readonly fetchedAt?: number
  readonly fetching: boolean
  readonly failure?: GitFailure
}

/**
 * What a press came to, where git did not fail it: nothing to say, the refusal that
 * stopped it, or the files whose changes a stash still holds because putting them back
 * would conflict with what the press brought down.
 */
export interface Pressed {
  readonly refusal?: SyncRefusal
  readonly kept?: readonly [string, ...string[]]
}

/** Whether to set a dirty tree aside for the press and put it back after. */
export interface How {
  readonly stash: boolean
}

export interface HostGitShape {
  /** The bar now — starting a fetch first, without waiting on it, when the last is stale. */
  readonly status: Effect.Effect<HostGitView, GitFailed>
  /**
   * The four presses. Each answers what it came to — **a git failure is not an error
   * here**: it is recorded as `failure` and read with the next `status`, which is where
   * the bar shows it. A press run around a stash fails under its own name, so `failure`
   * says *pull* or *reconcile* either way.
   *
   * **Each runs to its end once started, and interrupting the caller only stops the
   * wait.** A pull, a reconcile and a push write to a person's checkout, and half of one
   * is worse than none.
   */
  readonly fetch: Effect.Effect<Pressed>
  readonly pull: (how: How) => Effect.Effect<Pressed>
  readonly reconcile: (how: How) => Effect.Effect<Pressed>
  readonly push: Effect.Effect<Pressed>
  /**
   * Bring the checkout up to a pull request that has just merged into `base` — a fresh
   * fetch, then the plain pull or reconcile `updateAfterMerge` picks, never a stash.
   * Returns at once: the update runs on the layer's scope, so a merge's answer does not
   * wait on the remote. It takes turns with the presses that write, as they do with each
   * other. A refusal is dropped, since the bar's counts already say it; a git
   * failure is recorded as a press's is.
   */
  readonly afterMerge: (base: string) => Effect.Effect<void>
}

export class HostGit extends Context.Tag("app/HostGit")<HostGit, HostGitShape>() {}

type Outcome = Either.Either<Pressed, GitFailed>

const NOTHING: Pressed = {}

const refusedOr = (refusal: SyncRefusal | undefined): Pressed =>
  refusal === undefined ? NOTHING : { refusal }

const stashedOr = StashedSync.$match({
  Refused: ({ refusal }): Pressed => ({ refusal }),
  Restored: (): Pressed => NOTHING,
  Kept: ({ files }): Pressed => ({ kept: files }),
})

interface Memory {
  readonly fetchedAt?: number
  /** When the newest fetch began, finished or not — what staleness is measured from. */
  readonly askedAt?: number
  readonly failure?: GitFailure
  readonly running?: Deferred.Deferred<Outcome>
}

/** The memory after `action` came back: a failure replaces any; a success clears its own. */
const settled = (memory: Memory, action: GitAction, outcome: Outcome, at: number): Memory => {
  if (Either.isLeft(outcome)) {
    return { ...memory, failure: { action, message: outcome.left.message, at } }
  }
  const { failure, ...rest } = memory
  return failure === undefined || failure.action !== action ? memory : rest
}

/**
 * `HostGit.afterMerge`'s update, once `fetched` has come back: the plain press
 * `updateAfterMerge` picks, run through `attempt` so a git failure lands on the bar.
 *
 * **The status is read under `writing`, not before it**, so an update that waited on a
 * press reads the checkout that press left — never a tree a stash press has only set
 * clean for the moment.
 */
const updateTo = (
  base: string,
  vcs: VcsShape,
  fetched: Effect.Effect<Outcome>,
  attempt: (action: GitAction, press: Effect.Effect<Pressed, GitFailed>) => Effect.Effect<Outcome>,
  writing: Effect.Semaphore,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const fetch = yield* fetched
    if (Either.isLeft(fetch) || fetch.right.refusal !== undefined) return
    yield* writing.withPermits(1)(
      Effect.gen(function* () {
        // A status git cannot read is the bar's own next read to report.
        const read = yield* Effect.either(vcs.hostStatus())
        if (Either.isLeft(read)) return
        const action = updateAfterMerge(read.right, base)
        if (action === undefined) return
        const plain = action === "pull" ? vcs.pull() : vcs.reconcile()
        yield* attempt(action, Effect.map(plain, refusedOr))
      }),
    )
  })

export const HostGitLayer = Layer.scoped(
  HostGit,
  Effect.gen(function* () {
    const vcs = yield* Vcs
    const scope = yield* Scope.Scope
    const held = yield* Ref.make<Memory>({})
    /**
     * One write to the checkout at a time: a pull, a reconcile, a push, a stash press or
     * the update after a merge. Taken after the fetch answers, so a press waiting on a
     * fetch never holds up another — and two git commands never race for `index.lock`.
     */
    const writing = yield* Effect.makeSemaphore(1)

    /**
     * Run one press and record what came of it. The `GitFailed` is caught whole on
     * purpose: every cause — a remote that refused, no network, a lock another git
     * holds — is the same answer to a person, which is git's own sentence on the bar.
     */
    const attempt = (
      action: GitAction,
      press: Effect.Effect<Pressed, GitFailed>,
    ): Effect.Effect<Outcome> =>
      Effect.gen(function* () {
        const outcome = yield* Effect.either(press)
        const at = yield* Clock.currentTimeMillis
        yield* Ref.update(held, (memory) => settled(memory, action, outcome, at))
        return outcome
      })

    const fetchOnce: Effect.Effect<Outcome> = Effect.gen(function* () {
      const outcome = yield* attempt("fetch", Effect.map(vcs.fetch(), refusedOr))
      const at = yield* Clock.currentTimeMillis
      if (Either.isRight(outcome) && outcome.right.refusal === undefined) {
        yield* Ref.update(held, (memory) => ({ ...memory, fetchedAt: at }))
      }
      return outcome
    })

    /**
     * The fetch in flight, or a new one. `Ref.modify` decides both in one step, so two
     * readers finding the last fetch stale together start one. Forked into the layer's
     * scope rather than the request's, so a tab closing mid-fetch does not kill the fetch
     * another is waiting on — and `running` is cleared however it ends.
     *
     * **Cleared before the waiters are answered**, so one woken by this fetch that asks
     * for another never finds this one still in flight — which `afterMerge` relies on.
     */
    const shared: Effect.Effect<Deferred.Deferred<Outcome>> = Effect.gen(function* () {
      const fresh = yield* Deferred.make<Outcome>()
      const now = yield* Clock.currentTimeMillis
      const [deferred, started] = yield* Ref.modify(
        held,
        (memory): readonly [readonly [Deferred.Deferred<Outcome>, boolean], Memory] =>
          memory.running === undefined
            ? [[fresh, true], { ...memory, running: fresh, askedAt: now }]
            : [[memory.running, false], memory],
      )
      if (started) {
        yield* fetchOnce.pipe(
          Effect.ensuring(Ref.update(held, ({ running: _, ...rest }) => rest)),
          Effect.flatMap((outcome) => Deferred.succeed(deferred, outcome)),
          Effect.forkIn(scope),
        )
      }
      return deferred
    })

    /**
     * Run a press that writes to the checkout to its end, whoever stops waiting for it.
     *
     * **On the layer's scope, never the caller's.** The HTTP server interrupts a handler
     * when its browser goes away — a reload, a closed tab, a phone putting the page to
     * sleep — and an interruption is not a failure, so nothing that answers a failed
     * press runs for one: a stash press stopped between its stash and its restore leaves
     * a person's changes in the stash, and a merge stopped mid-way is never aborted. So
     * the press is this layer's fiber and the request only joins it; interrupting the
     * join leaves the press running, and what it came to is still recorded.
     */
    const toTheEnd = (press: Effect.Effect<Pressed>): Effect.Effect<Pressed> =>
      Effect.flatMap(Effect.forkIn(press, scope), Fiber.join)

    /** What a press answers: what it came to, or nothing where git failed it. */
    const answered = (outcome: Outcome): Pressed =>
      Either.isRight(outcome) ? outcome.right : NOTHING

    const fetch: Effect.Effect<Pressed> = Effect.flatMap(shared, (deferred) =>
      Effect.map(Deferred.await(deferred), answered),
    )

    /**
     * **The memory is read before git is**, and the order is the point: a fetch that
     * finished before the snapshot is in the refs git is then asked about, so `fetching:
     * false` never comes with counts from before it. The other order could read the refs
     * mid-fetch and the memory after it, and draw stale counts as settled.
     */
    const status: Effect.Effect<HostGitView, GitFailed> = Effect.gen(function* () {
      const { askedAt, fetchedAt, failure, running } = yield* Ref.get(held)
      const git = yield* vcs.hostStatus()
      const now = yield* Clock.currentTimeMillis
      const stale = askedAt === undefined || now - askedAt >= Duration.toMillis(FETCH_STALE_AFTER)
      const started = git.origin && stale
      if (started) yield* shared
      return {
        status: git,
        ...(fetchedAt === undefined ? {} : { fetchedAt }),
        fetching: started || running !== undefined,
        ...(failure === undefined ? {} : { failure }),
      }
    })

    /**
     * Fetch, then bring the branch to what came down — what `git pull` is, fast-forward
     * for `pull` and a merge for `reconcile`. A fetch that failed stops it, with the
     * fetch's failure on the bar: what would be pulled is not known. No `origin` is no
     * stop, since the upstream may be on another remote.
     */
    const afterFetch = (
      action: StashedPress,
      plain: Effect.Effect<SyncRefusal | undefined, GitFailed>,
      how: How,
    ): Effect.Effect<Pressed> =>
      toTheEnd(
        Effect.gen(function* () {
          const fetched = yield* Deferred.await(yield* shared)
          if (Either.isLeft(fetched)) return NOTHING
          const press = how.stash
            ? Effect.map(vcs.stashAnd(action), stashedOr)
            : Effect.map(plain, refusedOr)
          return answered(yield* writing.withPermits(1)(attempt(action, press)))
        }),
      )

    const push: Effect.Effect<Pressed> = toTheEnd(
      Effect.map(
        writing.withPermits(1)(attempt("push", Effect.map(vcs.push(), refusedOr))),
        answered,
      ),
    )

    /**
     * A fetch that began after now. One already in flight began before the merge and may
     * not carry it, so it is waited out rather than shared; one a poll starts after that
     * is shared, since it began after the merge too.
     */
    const freshFetch: Effect.Effect<Outcome> = Effect.gen(function* () {
      const before = (yield* Ref.get(held)).running
      if (before !== undefined) yield* Deferred.await(before)
      return yield* Deferred.await(yield* shared)
    })

    return {
      status,
      fetch,
      pull: (how) => afterFetch("pull", vcs.pull(), how),
      reconcile: (how) => afterFetch("reconcile", vcs.reconcile(), how),
      push,
      afterMerge: (base) =>
        Effect.asVoid(Effect.forkIn(updateTo(base, vcs, freshFetch, attempt, writing), scope)),
    } satisfies HostGitShape
  }),
)
