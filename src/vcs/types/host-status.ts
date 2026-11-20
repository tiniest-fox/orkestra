import { Data } from "effect"
import type { BranchName, CommitSha } from "./worktree.js"

/** What the host repository has checked out: a branch, or a commit with none. */
export type HostHead = Data.TaggedEnum<{
  Branch: { readonly name: BranchName }
  Detached: { readonly sha: CommitSha }
}>
export const HostHead = Data.taggedEnum<HostHead>()

/**
 * The remote branch the checked-out branch tracks, and how far apart the two are as of
 * the last fetch. Both counts are git's own, off the remote-tracking ref.
 */
export interface Upstream {
  /** As git abbreviates it — `origin/main`. */
  readonly name: string
  readonly ahead: number
  readonly behind: number
}

/**
 * Where the host repository stands against its remote, read off local refs only.
 *
 * `upstream` is absent for a branch that tracks nothing **and for one whose remote
 * branch has gone** — git keeps the configuration and has no ref to count against, and
 * both read as a branch that is not published: push makes the remote branch again.
 */
export interface HostStatus {
  readonly head: HostHead
  /** Whether a remote named `origin` is configured. Nothing here asks the network. */
  readonly origin: boolean
  readonly upstream?: Upstream
}

/**
 * Why a fetch, pull, reconcile or push did not run. Data rather than a `GitFailed`, for
 * `MergeOutcome`'s reason: each is the repository being in a state the press does not
 * apply to, decided before git is asked to do anything, and a person reads which one.
 *
 * - `Detached` — no branch to pull into or push from.
 * - `NoOrigin` — nothing to fetch from, or to publish a branch to.
 * - `NoUpstream` — a pull has nothing to fast-forward to.
 * - `Dirty` — a pull would move files under uncommitted work. Every path, as `dirty`
 *   reports them.
 * - `Diverged` — both sides have commits, so neither pull nor push can fast-forward.
 * - `Behind` — a push would be rejected, and is never forced.
 * - `Conflicted` — merging the upstream into the branch would conflict in these files.
 *   Asked of git against refs before anything moves, so the checkout is as it was. It
 *   names both sides, which is what a person resolving it elsewhere has to be told.
 */
export type SyncRefusal = Data.TaggedEnum<{
  Detached: object
  NoOrigin: object
  NoUpstream: object
  Dirty: { readonly files: readonly [string, ...string[]] }
  Diverged: { readonly ahead: number; readonly behind: number }
  Behind: { readonly behind: number }
  Conflicted: {
    readonly branch: BranchName
    readonly upstream: string
    readonly files: readonly [string, ...string[]]
  }
}>
export const SyncRefusal = Data.taggedEnum<SyncRefusal>()

/** The two presses that can run around a stash: the ones a dirty tree refuses. */
export type StashedPress = "pull" | "reconcile"

/**
 * What a press run around a stash came to.
 *
 * - `Refused` — the press does not apply, and nothing was stashed or moved.
 * - `Restored` — the press landed and every uncommitted change is back in the tree.
 * - `Kept` — the press landed and putting the changes back would conflict in these
 *   files, so the tree is clean at the new commit and the changes are in one stash
 *   entry, untouched.
 */
export type StashedSync = Data.TaggedEnum<{
  Refused: { readonly refusal: SyncRefusal }
  Restored: object
  Kept: { readonly files: readonly [string, ...string[]] }
}>
export const StashedSync = Data.taggedEnum<StashedSync>()
