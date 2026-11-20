// A Layer for a caller that has no repository to isolate: the offline demos.
//
// The counterpart of `ScriptedProviderLayer` — `walkthrough` and `spike` exist
// to show the engine's shape with nothing real underneath, and a demo that
// created a branch in the reader's checkout every time they ran it would not be
// offline. It is a Layer rather than an `if` in the runtime for the same reason
// the scripted provider is: which world a trak runs in is wiring, not logic.

import { Effect, Layer } from "effect"
import { Forge, type ForgeShape } from "../ports/forge.js"
import { Vcs, type VcsShape } from "../ports/vcs.js"
import { GitFailed } from "../types/errors.js"
import { HostHead, StashedSync, SyncRefusal } from "../types/host-status.js"
import { ForgeAnswer, ForgeListing, ForgeMerge, ForgeOpen } from "../types/pull-request.js"
import {
  BranchMove,
  BranchName,
  CommitSha,
  MergeOutcome,
  Removal,
  WorktreePath,
} from "../types/worktree.js"

/**
 * Work happens where the process started, and nothing is kept or removed.
 *
 * The branch and base are named for what they are rather than left blank: they
 * appear in no git command, because neither half of finishing runs one here.
 */
export const NoVcsLayer = Layer.succeed(Vcs, {
  createWorktree: () =>
    Effect.succeed({
      path: WorktreePath.make("."),
      branch: BranchName.make("(no branch)"),
      base: CommitSha.make("(no base)"),
    }),
  commitWork: () => Effect.succeed(undefined),
  removeWorktree: () => Effect.void,
  // No sandbox here, so nothing a removal could skip running in one.
  removalFor: (_worktree, kept) => Effect.succeed(Removal.Reach({ kept })),
  removeCheckout: () => Effect.void,
  // Nothing was branched and nothing pushed, so there is nothing to delete — the
  // same claim `removeWorktree` makes one line up.
  deleteBranch: () => Effect.void,
  forgetTrak: () => Effect.void,
  // Nothing lives anywhere else, so there is nothing to bring here.
  fetchWork: () => Effect.void,
  carryTarget: () => Effect.void,
  // No sandbox is ever made again, so nothing is carried across one.
  carryOut: () => Effect.void,
  carryIn: () => Effect.void,
  leftBehind: () => Effect.succeed(undefined),
  // Nothing was ever made, so there is nothing to find — and a demo whose library
  // declares a setup script should run it every time rather than skip it on the
  // strength of a checkout that does not exist.
  hasCheckout: () => Effect.succeed(false),
  // Work happens where the process started, which is always there.
  remakeCheckout: () => Effect.succeed(undefined),
  // No branch was ever made here either, so no name a demo draws can be taken by
  // one. The mint's other half — what the store already holds — still applies,
  // which is what keeps two offline traks from sharing a name.
  hasBranch: () => Effect.succeed(false),
  // And so no tip either.
  branchTip: () => Effect.succeed(undefined),
  // No origin is the record here.
  branchFromOrigin: () => Effect.void,
  // Nothing branched, so nothing can have diverged: a demo that reached a join
  // would find every child's work already where it is standing. Named for what
  // it is, like the branch and the base above.
  merge: () => Effect.succeed(MergeOutcome.Merged({ sha: CommitSha.make("(no merge)") })),
  // And so nothing can be predicted to conflict either — the honest answer for a
  // world where every merge above is already in.
  wouldConflict: () => Effect.succeed(false),
  // No branch was ever pushed, so none holds a merged pull request's commits.
  moveOntoBase: () => Effect.succeed(BranchMove.Unmoved()),
  // The same world: every branch is already in, so nothing is ever dropped.
  contains: () => Effect.succeed(true),
  // No remote to hold a goal branch, so a goal naming one is refused as a repository
  // with no `origin` refuses it.
  createGoalBranch: () =>
    Effect.fail(new GitFailed({ op: "create goal branch", reason: "no git in this world" })),
  pushGoal: () => Effect.void,
  removeGoalCheckout: () => Effect.void,
  // Nothing is checked out, so there is no branch to be standing on — which is
  // exactly what `undefined` means here, and what stops a demo's merge warning
  // inventing one.
  hostBranch: () => Effect.succeed(undefined),
  // And no remote to name a default branch either, so a hand-off here has nothing to
  // be cut from — the same answer a repository with no `origin` gives.
  defaultBranch: () => Effect.succeed(undefined),
  originTip: () => Effect.succeed(undefined),
  // Nothing branches from anything here, so nothing can be missing from a trak
  // for being uncommitted — and a demo must not write the ignore entries into
  // the repository someone ran it from, for the same reason it must not make a branch.
  dirty: () => Effect.succeed([]),
  // No repository to hash, and a constant would reuse one pass for every tree a demo
  // ever runs on. Refused, so a check here always runs.
  workingTree: () =>
    Effect.fail(new GitFailed({ op: "hash working tree", reason: "no git in this world" })),
  // No commit and no remote, so nothing to publish proofs from or read them back off.
  headTree: () =>
    Effect.fail(new GitFailed({ op: "read head tree", reason: "no git in this world" })),
  publishProofs: () =>
    Effect.fail(new GitFailed({ op: "publish proofs", reason: "no git in this world" })),
  readProofs: () => Effect.succeed(undefined),
  ensureIgnored: () => Effect.void,
  // Nothing branched and nothing committed, so there is no slice of work to
  // read. A demo that drew a diff here would be drawing the reader's own
  // checkout, which is the one thing this Layer exists to keep out of.
  changes: () => Effect.succeed({ files: [] }),
  // No checkout and no remote: the bar reads a detached nothing, and every press is
  // refused as it would be in a repository with no `origin`, touching nothing.
  hostStatus: () =>
    Effect.succeed({
      head: HostHead.Detached({ sha: CommitSha.make("(no head)") }),
      origin: false,
    }),
  fetch: () => Effect.succeed(SyncRefusal.NoOrigin()),
  pull: () => Effect.succeed(SyncRefusal.Detached()),
  reconcile: () => Effect.succeed(SyncRefusal.Detached()),
  stashAnd: () => Effect.succeed(StashedSync.Refused({ refusal: SyncRefusal.Detached() })),
  push: () => Effect.succeed(SyncRefusal.Detached()),
  // No checkout, so nothing to list or search — and listing the reader's own
  // directory is the one thing this Layer exists to keep out of.
  projectFiles: () => Effect.succeed({ root: ".", paths: [] }),
  grepProject: () => Effect.succeed({ matches: [], cut: false }),
} satisfies VcsShape)

/**
 * No forge, honestly said. `Unavailable` rather than `None`, because *there is no
 * pull request* is a claim about a branch and this world has no branches to make
 * claims about — the same distinction the type itself carries.
 */
export const NoForgeLayer = Layer.succeed(Forge, {
  pullRequest: () => Effect.succeed(ForgeAnswer.Unavailable({ why: "no forge in this world" })),
  listing: () => Effect.succeed(ForgeListing.Unavailable({ why: "no forge in this world" })),
  merge: () => Effect.succeed(ForgeMerge.Refused({ why: "no forge in this world" })),
  openPullRequest: () => Effect.succeed(ForgeOpen.Refused({ why: "no forge in this world" })),
} satisfies ForgeShape)
