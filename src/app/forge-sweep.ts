// The forge sweep: every finished trak a goal opened or set to merge itself, asked about
// on GitHub once a minute — archived once its pull request has merged, and merged once
// GitHub says it would go in.
//
// **Why a goal needs it.** A trak holds at `Finished` until somebody archives it, and a
// goal hears an ending only from the trak's own log — so without this, a goal waits on
// a person's archive press to learn that work it opened has landed. The archive here is
// the same `Closed` a person's press appends; asking the forge as it removes the branch
// is what ends the trak `Merged`, and `Merged` is what wakes the goal as `landed`. Nothing
// is written to the goal's log from here: `drop_trak` records a drop first, and an archive
// that did the same would hide the landing from the watcher.
//
// **Auto-merge is the second arm**, for any trak born with it, in a goal or not. A pull
// request that merges cleanly with its checks passed, or with none run, on one head commit
// two ticks running is merged on the forge, and the next tick hears the merge like any
// other. One that conflicts, or whose checks failed, sends the trak back to its own
// composer with what the forge said; `AUTO_MERGE_SENDS` of those without a merge, and the
// sweep records that it stopped. It stops as well where nothing the trak pushes could help:
// a merge the forge's protection holds with the checks green, or `MERGE_REFUSALS` merges in
// a row the forge turned down. A mergeability the forge has not worked out yet, a check
// still running and a draft are all *not yet*: asked again next tick, and never counted.
//
// **With no `origin` the auto-merge arm is local.** There is no forge to ask, so a trak that
// merges itself is merged into the branch the project's checkout is on, as the Merge press
// merges it; a conflict sends it back and counts as a pull request's does.
//
// **What it remembers between ticks is in memory**, as the condition sweep's is: which head
// last read `none` or `passed`, and how many merges in a row were refused. A restart
// forgets both, which costs one more tick before a merge and resets a refusal count —
// never a merge that should not happen.
//
// **What is left alone.** A person's trak outside a goal is never archived from here,
// and one whose pull request is still open is not archived either. A trak resting on a
// wait is never archived: archiving it would drop the step it is waiting to run, and the
// condition sweep is what answers it.
//
// **Auto-merge goes ahead past a wait the merge answers** — `merged`, `deployed`, or a
// time on an entry that also waits for one of them — since nothing else would merge the
// trak and the wait would never end. A wait on a project's script, such as a review still
// running, or a time on an entry with no `wait_for`, holds the merge: `mergesPastWait`.
// With no `origin` a time wait holds it whatever the entry says — `stillMergingLocally`.
//
// Here rather than in `workflow/` for `conditions.ts`'s reason: it drives nothing itself
// and takes no key while it asks. One listing call per tick covers every trak it watches,
// and each archive, send and stop goes through `Drives.startIfStill`, which re-reads the
// trak under the permit — so a person's press during the forge call wins over it.

import { Effect, Ref, Schedule } from "effect"
import type { Scope } from "effect"
import { PULL_REQUEST_BRANCH_LIMIT } from "@orkestra/shared/dto/forge"
import { CommitSha } from "../vcs/index.js"
import { Forge } from "../vcs/ports/forge.js"
import { Vcs } from "../vcs/ports/vcs.js"
import type { PullRequestSummary } from "../vcs/types/pull-request.js"
import type { BranchName } from "../vcs/types/worktree.js"
import { autoMerging, sendsSpent } from "../workflow/domain/attention.js"
import { type Event, Events } from "../workflow/domain/event.js"
import {
  type ReentryCause,
  type StopCause,
  type Trak,
  type TrakId,
  engineWait,
  mergesPastWait,
  waitingAt,
} from "../workflow/domain/trak.js"
import type { Archive } from "../workflow/ports/archive.js"
import type { Idle } from "../workflow/ports/idle.js"
import { heldJob, type Locks } from "../workflow/ports/locks.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import { liveTrak } from "./archive.js"
import { ENGINE_ASKED_EVERY } from "./conditions.js"
import { Drives } from "./drive.js"
import { HostGit } from "./host-git.js"
import { destinationDirty, wouldConflict } from "./merge-destination.js"

/**
 * Whether the sweep may archive this trak: a goal's, or one merging itself, at
 * `Finished`, resting on no wait. Asked again under the permit before anything is
 * appended, since a person may have pressed anything while the forge answered.
 */
const archivable = (trak: Trak): boolean =>
  (trak.goal !== undefined || autoMerging(trak)) &&
  trak.state._tag === "Finished" &&
  waitingAt(trak) === undefined

/**
 * Whether the engine may still merge this trak on its own: at `Finished`, merging itself,
 * and resting on nothing the merge does not answer. What a merge, a send or a stop is
 * re-read against.
 */
const stillMerging = (trak: Trak): boolean =>
  autoMerging(trak) && trak.state._tag === "Finished" && mergesPastWait(trak)

/**
 * `stillMerging`, for the local arm: a time wait is never merged past here, even on an
 * entry that also waits for the merge. `Merged` made here closes a trak resting on one,
 * dropping the step, where on GitHub the condition sweep asks the time and then `merged`.
 */
const stillMergingLocally = (trak: Trak): boolean =>
  stillMerging(trak) && (waitingAt(trak) === undefined || engineWait(trak) !== undefined)

/** Whether the sweep watches this trak: one it may archive, or one it may still merge. */
const watched = (trak: Trak): boolean => archivable(trak) || stillMerging(trak)

/**
 * How many merges in a row the forge may turn down, on a pull request the listing read as
 * mergeable, before the sweep stops. One is the world moving between the two calls — see
 * `ForgeShape.merge` — and is asked again; several running is something the listing
 * cannot see, and asking every minute forever tells nobody.
 */
const MERGE_REFUSALS = 3

/** A rollup that merges only once it has held — see `settled`. */
type Holding = "none" | "passed"

/** The head commit the last tick read a `Holding` rollup on, and which one it read. */
interface Held {
  readonly checks: Holding
  readonly head: string
}

/**
 * What the sweep carries from one tick to the next, per trak: what the last tick read on
 * which head, where that was a rollup that has to hold, and how many merges in a row the
 * forge has refused.
 */
interface Memory {
  readonly heldOn: ReadonlyMap<TrakId, Held>
  readonly refusals: ReadonlyMap<TrakId, number>
}

/** A sweep's memory, empty — what `startForgeSweep` begins with, and each test case. */
export const sweepMemory: Effect.Effect<Ref.Ref<Memory>> = Ref.make<Memory>({
  heldOn: new Map(),
  refusals: new Map(),
})

const onlyFor = <V>(m: ReadonlyMap<TrakId, V>, ids: ReadonlySet<TrakId>): ReadonlyMap<TrakId, V> =>
  new Map([...m].filter(([id]) => ids.has(id)))

/** `m` with `id` set to `v`, or without it where `v` is absent. */
const withEntry = <V>(m: ReadonlyMap<TrakId, V>, id: TrakId, v: V | undefined) => {
  const next = new Map(m)
  if (v === undefined) next.delete(id)
  else next.set(id, v)
  return next
}

/** What the forge's word on an open pull request asks of an auto-merging trak. */
type Verdict = "merge" | "wait" | "Blocked" | ReentryCause["_tag"]

/**
 * A conflict is read before the checks: the merge of the base it sends the trak back for
 * pushes a new head, and the checks run again on that. `blocked` is read only once the
 * checks are green, since a protection rule requiring them holds the merge until then.
 *
 * `held` is whether a `none` or `passed` rollup has held — see `settled`. **Every verdict
 * that reads the checks as green waits on it, the stop as much as the merge**: protection
 * that requires checks reports `blocked` while a fresh head's CI has not registered, which
 * reads `none` or `passed`, and a stop made then is permanent.
 */
const verdictOf = (pull: PullRequestSummary, held: boolean): Verdict => {
  if (pull.merging === "conflicting" || pull.merging === "behind") return "Conflict"
  if (pull.checks === "failed") return "Checks"
  const green = (pull.checks === "passed" || pull.checks === "none") && held
  if (!green || pull.isDraft) return "wait"
  if (pull.merging === "blocked") return "Blocked"
  return pull.merging === "clean" ? "merge" : "wait"
}

/**
 * Whether a `none` or `passed` has held: the same head read the same rollup last tick, so
 * the first reading is never enough. A just-pushed head reads `none` until its CI
 * registers, which is the same word a repository with no CI says. It can read `passed`
 * just as early: a workflow whose every job is skipped completes in a second or two, the
 * forge counts skipped as success, and the real CI's runs have not registered yet. Any
 * other reading forgets the head, so a `running` between two `passed` starts it over. A
 * head the forge did not name never settles.
 */
const settled = (memory: Ref.Ref<Memory>, trak: Trak, pull: PullRequestSummary) =>
  Ref.modify(memory, (m): readonly [boolean, Memory] => {
    const { checks, head } = pull
    const holding = checks === "none" || checks === "passed"
    const before = m.heldOn.get(trak.id)
    const now = holding && head !== undefined ? { checks, head } : undefined
    return [
      now !== undefined && before?.checks === now.checks && before.head === now.head,
      { ...m, heldOn: withEntry(m.heldOn, trak.id, now) },
    ]
  })

/** Every trak the sweep watches now. A log this build cannot decode is left out. */
const watchedTraks = Effect.gen(function* () {
  const found: Trak[] = []
  for (const id of yield* (yield* Store).list()) {
    const live = yield* liveTrak(id).pipe(
      Effect.catchTag("StoreUndecodable", (e) =>
        Effect.as(Effect.logWarning(`forge sweep: left out: ${e.reason}`), undefined),
      ),
    )
    if (live !== undefined && watched(live.trak)) found.push(live.trak)
  }
  return found
})

/** The branches in runs the forge answers about in one call. */
const inRuns = <A>(all: readonly A[], size: number): readonly (readonly A[])[] =>
  Array.from({ length: Math.ceil(all.length / size) }, (_, i) =>
    all.slice(i * size, (i + 1) * size),
  )

/**
 * Archive it, unless something moved it since it was read. `busy` is next tick's.
 *
 * The merge commit rides the close, so the removal records it rather than asking the
 * forge again: a second call that failed would end merged work `Closed`, which its goal
 * reads as a person putting it down.
 */
const archive = (trak: Trak, merged?: CommitSha) =>
  Effect.flatMap(Drives, (drives) =>
    drives.startIfStill(trak.id, Events.closed(merged), archivable),
  )

/**
 * The checks that failed on the head commit, by name — one more call, made only for a
 * trak about to be sent back for them. The forge being unreachable sends it back naming
 * none rather than waiting: the listing has already said they failed.
 */
const failedChecks = (branch: BranchName) =>
  Effect.map(
    Effect.flatMap(Forge, (forge) => forge.pullRequest(branch)),
    (answer) =>
      answer._tag === "Found"
        ? answer.pullRequest.checks.filter((c) => c.verdict === "failed").map((c) => c.name)
        : [],
  )

/** Stop merging the trak on its own, saying why. */
const stop = (trak: Trak, cause: StopCause) =>
  Effect.flatMap(Drives, (drives) =>
    drives.startIfStill(trak.id, Events.autoMergeStopped(cause), stillMerging),
  )

/** Send the trak back with `what` and `cause`, or record that the sends are spent. */
const sendBack = (trak: Trak, what: string, cause: ReentryCause, base?: string) => {
  const event: Event = sendsSpent(trak)
    ? Events.autoMergeStopped(cause)
    : Events.sentBack(what, cause, base)
  return Effect.flatMap(Drives, (drives) => drives.startIfStill(trak.id, event, stillMerging))
}

/**
 * Send the trak back with what the forge said. A conflict names the pull request's own
 * base, which is what the resolve has to merge.
 */
const sendBackPull = (trak: Trak, pull: PullRequestSummary, cause: ReentryCause) =>
  sendBack(trak, pull.url, cause, cause._tag === "Conflict" ? pull.base : undefined)

/**
 * Merge it by the trak's picked method, and count a refusal: `MERGE_REFUSALS` in a row stop
 * the trak with the forge's last reason. A merge that goes in clears the count, and starts
 * `HostGit.afterMerge` on the pull request's base without holding up the tick.
 */
const merge = (memory: Ref.Ref<Memory>, trak: Trak, branch: BranchName, base?: string) =>
  Effect.gen(function* () {
    const merged = yield* (yield* Forge).merge(branch, trak.mergeMethod)
    const refusals = yield* Ref.modify(memory, (m): readonly [number, Memory] => {
      const count = merged._tag === "Refused" ? (m.refusals.get(trak.id) ?? 0) + 1 : 0
      const remembered = count === 0 || count >= MERGE_REFUSALS ? undefined : count
      return [count, { ...m, refusals: withEntry(m.refusals, trak.id, remembered) }]
    })
    if (merged._tag === "Merged") {
      if (base !== undefined) yield* (yield* HostGit).afterMerge(base)
      return undefined
    }
    yield* Effect.logWarning(`forge sweep: ${trak.id} was not merged: ${merged.why}`)
    if (refusals < MERGE_REFUSALS) return undefined
    return yield* stop(trak, { _tag: "Refused", why: merged.why })
  })

/** The auto-merge arm, for one trak whose pull request is open. */
const autoMerge = (
  memory: Ref.Ref<Memory>,
  trak: Trak,
  branch: BranchName,
  pull: PullRequestSummary,
) =>
  Effect.gen(function* () {
    // Asked on every tick, whatever the mergeability, so the head is recorded on its first
    // `none` or `passed` reading and the second can settle it.
    const verdict = verdictOf(pull, yield* settled(memory, trak, pull))
    if (verdict === "wait") return undefined
    if (verdict === "Blocked") return yield* stop(trak, { _tag: "Blocked" })
    if (verdict === "Conflict") return yield* sendBackPull(trak, pull, { _tag: "Conflict" })
    if (verdict === "Checks") {
      const failed = yield* failedChecks(branch)
      return yield* sendBackPull(trak, pull, { _tag: "Checks", failed })
    }
    return yield* merge(memory, trak, branch, pull.base)
  })

/**
 * What one trak's pull request asks of the sweep. A merged one is a goal's to archive —
 * a trak outside a goal stays finished for its person — and an open one is auto-merge's.
 */
const answer = (
  memory: Ref.Ref<Memory>,
  trak: Trak,
  branch: BranchName,
  pull: PullRequestSummary | undefined,
) => {
  if (pull?.state === "merged") {
    return trak.goal !== undefined && archivable(trak) && pull.mergeCommit !== undefined
      ? Effect.asVoid(archive(trak, CommitSha.make(pull.mergeCommit)))
      : Effect.void
  }
  return pull?.state === "open" && stillMerging(trak)
    ? autoMerge(memory, trak, branch, pull)
    : Effect.void
}

/**
 * The local arm, for a trak that merges itself in a project with no `origin`: into its goal
 * branch for a goal's trak, and otherwise into the branch the project's checkout is on, as
 * the Merge press merges, through the same `Merged` event. Uncommitted files in the host's
 * checkout wait for a later tick, as the press refuses over them; a merge that would
 * conflict sends the trak back, counted as a pull request's conflict is.
 *
 * **A detached checkout waits**: there is no branch to name to the resolve, or to merge
 * into. A goal's trak never reads the host's checkout, so neither a detached nor a dirty
 * one holds it up. A child's destination is its parent's checkout, which the sweep does
 * not merge into, so it is left alone. Git failing to answer is a tick skipped, never a
 * verdict.
 */
const mergeLocally = (trak: Trak) =>
  Effect.gen(function* () {
    if (trak.parent !== undefined) return undefined
    // The branch the merge goes into, as `wouldConflict` and the runtime pick it: a goal's
    // trak lands on its goal branch, whatever the host checkout stands on.
    const into =
      trak.goal !== undefined && trak.goalBranch !== undefined
        ? trak.goalBranch
        : yield* (yield* Vcs).hostBranch()
    if (into === undefined) return undefined
    const [dirty] = yield* destinationDirty(trak)
    if (dirty !== undefined) return undefined
    const conflicts = yield* wouldConflict(trak)
    // No prediction is a merge that is not on the table, which is nothing to merge.
    if (conflicts === undefined) return undefined
    if (conflicts) {
      const what = `Merging this branch into \`${into}\` in the project's checkout would conflict.`
      return yield* sendBack(trak, what, { _tag: "Conflict", into })
    }
    return yield* (yield* Drives).startIfStill(trak.id, Events.merged(), stillMergingLocally)
  }).pipe(
    Effect.catchTags({
      GitFailed: (e) =>
        Effect.logWarning(`forge sweep: ${trak.id} was not merged locally: ${e.reason}`),
      StoreUndecodable: (e) =>
        Effect.logWarning(`forge sweep: ${trak.id} was not merged locally: ${e.reason}`),
    }),
  )

/**
 * Archive every merged one among `traks`, and answer every open one that merges itself,
 * asked in one call. With no `origin` there is no forge to ask, and each trak that merges
 * itself is merged here instead. A merged pull request whose merge commit the forge does not yet
 * name is asked again next tick, since the close has nothing to carry.
 */
const answerFromForge = (memory: Ref.Ref<Memory>, traks: readonly Trak[]) =>
  Effect.gen(function* () {
    const branched = traks.flatMap((t) =>
      t.worktree === undefined ? [] : [{ trak: t, branch: t.worktree.branch }],
    )
    if (branched.length === 0) return
    const listing = yield* (yield* Forge).listing(branched.map((b) => b.branch))
    if (listing._tag === "Unavailable") {
      return yield* Effect.logWarning(`forge sweep: could not ask the forge: ${listing.why}`)
    }
    if (listing._tag === "NoOrigin") {
      for (const { trak } of branched) if (stillMergingLocally(trak)) yield* mergeLocally(trak)
      return
    }
    for (const { trak, branch } of branched) {
      const pull = listing.entries.find((e) => e.branch === branch)?.pull
      yield* answer(memory, trak, branch, pull)
    }
  })

/**
 * One pass: archive each goal's trak whose branch has landed — on the trak's own log, or
 * as a merged pull request on the forge — and merge or send back each trak that merges
 * itself.
 *
 * `StoreFailed` escapes, on `Conditions.sweep`'s argument: a disk that will not list its
 * traks is not a tick to skip quietly.
 */
export const forgeSweep = (
  memory: Ref.Ref<Memory>,
): Effect.Effect<
  void,
  StoreFailed,
  Store | Archive | Idle | Locks | Forge | Drives | HostGit | Vcs
> =>
  Effect.gen(function* () {
    const traks = yield* watchedTraks
    // A trak no longer watched takes its memory with it.
    const ids = new Set(traks.map((t) => t.id))
    yield* Ref.update(memory, (m) => ({
      heldOn: onlyFor(m.heldOn, ids),
      refusals: onlyFor(m.refusals, ids),
    }))
    // A landing the log already holds needs no forge: the close carries its sha. A trak
    // outside a goal that landed has nothing left for the forge to merge.
    for (const trak of traks) {
      if (trak.landed !== undefined && trak.goal !== undefined && archivable(trak)) {
        yield* archive(trak)
      }
    }
    const asking = traks.filter((t) => t.landed === undefined)
    for (const run of inRuns(asking, PULL_REQUEST_BRANCH_LIMIT)) yield* answerFromForge(memory, run)
  })

/**
 * Fork the sweep on the engine's own interval — the one line `serve.ts` calls. The first
 * pass runs at once, so a merge that happened while the engine was down is heard at boot.
 * Under an external store it runs on the one engine copy holding its job, so a trak is never
 * archived twice. A tick that cannot list the store is logged and the next one tries again.
 */
export const startForgeSweep: Effect.Effect<
  void,
  never,
  Store | Archive | Idle | Locks | Forge | Drives | HostGit | Vcs | Scope.Scope
> = Effect.flatMap(sweepMemory, (memory) =>
  Effect.forkScoped(
    heldJob(
      "forge",
      Effect.asVoid(
        Effect.repeat(
          forgeSweep(memory).pipe(
            Effect.catchAll((e) => Effect.logWarning(`forge sweep: a sweep failed: ${e.reason}`)),
          ),
          Schedule.spaced(ENGINE_ASKED_EVERY),
        ),
      ),
    ),
  ),
).pipe(Effect.asVoid)
