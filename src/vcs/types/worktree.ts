// types: what `vcs/` hands back, and nothing about why it was asked.
//
// Named with a plain string id rather than a `TrakId` — that is the one place
// this boundary could have leaked, and keeping it a string is what prevents it.

import { Data, Schema } from "effect"

/** Absolute. The runtime hands it straight to a spawn as `cwd`. */
export const WorktreePath = Schema.String.pipe(Schema.brand("WorktreePath"))
export type WorktreePath = Schema.Schema.Type<typeof WorktreePath>

export const BranchName = Schema.String.pipe(Schema.brand("BranchName"))
export type BranchName = Schema.Schema.Type<typeof BranchName>

export const CommitSha = Schema.String.pipe(Schema.brand("CommitSha"))
export type CommitSha = Schema.Schema.Type<typeof CommitSha>

/**
 * A checkout, the branch it is on, and where that branch started.
 *
 * The first two are together because every caller needs both and neither can be
 * derived from the other without re-deriving `vcs/`'s naming: the path is where
 * work happens, and the branch is what survives the checkout being removed —
 * which is the whole point of committing before teardown.
 *
 * `base` is what makes "has this branch been committed to yet?" answerable at
 * all. A branch always *has* commits on it — it starts at one — so its tip alone
 * says nothing. An empty `git status` reads as "this step produced nothing" when
 * it equally means "the commit already happened" — against `base` the two are
 * distinguishable, which is what lets the command run twice.
 */
export const Worktree = Schema.Struct({
  path: WorktreePath,
  branch: BranchName,
  base: CommitSha,
})
export type Worktree = Schema.Schema.Type<typeof Worktree>

/**
 * Where a merge is going, which is the one thing the two callers do not share.
 *
 * A spawn's join merges a child into the **parent's own checkout**, and every
 * judgement there depends on that checkout still standing on its own branch. A
 * human merging a finished trak merges into the **host repository**, on whatever
 * branch they are currently standing on — which is not a checkout this tool made
 * and has no branch of ours to confirm.
 *
 * A goal's trak with a goal branch merges into **the engine's checkout of that
 * branch**, named by the goal's id: a third destination, because the person may be
 * standing anywhere and the goal branch is no checkout of theirs.
 *
 * A tagged union rather than an optional `Worktree`, because the host is a
 * destination rather than the absence of one.
 */
export type MergeInto = Data.TaggedEnum<{
  Checkout: { readonly worktree: Worktree }
  Host: object
  Goal: { readonly goal: string; readonly branch: BranchName }
}>
export const MergeInto = Data.taggedEnum<MergeInto>()

/**
 * What the log says of a trak's work as its checkout is taken away — read only under a
 * runner, where the last fetch out of the sandbox fails and the sandbox is released or
 * kept on this answer alone.
 *
 * `Merged`: the branch went in, so the sandbox holds nothing the merge did not take.
 * `At`: the last commit the log recorded left the branch at `head`, and nothing ran in
 * the checkout after it — so where this machine's copy is at `head`, it holds everything.
 * `Unsure`: something ran after that commit, and `why` names it; releasing the sandbox
 * could lose what it wrote.
 */
export type KeptWork = Data.TaggedEnum<{
  Merged: object
  At: { readonly head: CommitSha }
  Unsure: { readonly why: string }
}>
export const KeptWork = Data.taggedEnum<KeptWork>()

/**
 * What taking a checkout away has to run in its sandbox — `removalFor` answers it, and
 * `removeWorktree` is told it rather than deciding again.
 *
 * `Held`: this machine already holds everything the sandbox could give, so nothing runs
 * there at all and `release` is the whole of the removal. **Every command sent into a
 * sandbox is a way for an archive to fail on one that cannot be reached**, and a sandbox
 * an archive gave up on keeps billing; `why` is what the log says it released on.
 * `Reach`: something has to run there first, and `kept` judges a last fetch that fails.
 */
export type Removal = Data.TaggedEnum<{
  Held: { readonly why: string }
  Reach: { readonly kept: KeptWork }
}>
export const Removal = Data.taggedEnum<Removal>()

/**
 * What a merge did — a **value**, not an error channel, which is the shape
 * `CheckOutcome` has and for the same argument: git reached an answer, and two
 * branches disagreeing is not the same event as git failing to answer at all.
 * A caller that read one as the other would report a verdict about the work that
 * git never gave, which is the mistake `branchTip` made once already.
 *
 * `Merged` carries the branch's tip **after** the merge rather than the merge
 * commit as such, so a second call over a branch that is already in reports the
 * same value as the first instead of reading its own earlier success as nothing
 * to do. That is `commitWork`'s re-runnability, in the one other place a restart
 * can land on top of completed git work.
 *
 * A `Conflicted` names the paths for the reason `dirty` returns lines: whoever
 * has to resolve it is told which files, not that there were some. Non-empty,
 * because unmerged paths are the whole of what separates a conflict from git
 * declining to answer: no unmerged paths means the merge never started, which
 * leaves through the error channel and is not an outcome at all. A list that
 * could be empty would let a caller report *the work disagreed* about that.
 */
export type MergeOutcome = Data.TaggedEnum<{
  Merged: { readonly sha: CommitSha }
  Conflicted: { readonly paths: readonly [string, ...string[]] }
}>
export const MergeOutcome = Data.taggedEnum<MergeOutcome>()

/**
 * What moving a trak's branch off a merged pull request came to — `Vcs.moveOntoBase`.
 *
 * `Moved`: the commits after the merged head now sit on `onto`, the base's tip as
 * `origin` held it, and `origin` holds the branch so — answered whenever the push landed.
 * `Unmoved`: the branch shares no commit with the merged head that the base lacks, so
 * nothing of that pull request's is left on it — what a branch already moved answers.
 * `Refused`: it was not done — a conflict, a merged head nowhere to be found, commits on
 * `origin` this checkout lacks, a checkout not on its branch, or git unable to say — and
 * `why` is the reason, git's own where git stopped. The branch is then where it was, here
 * and on `origin`.
 */
export type BranchMove = Data.TaggedEnum<{
  Moved: { readonly onto: CommitSha }
  Unmoved: object
  Refused: { readonly why: string }
}>
export const BranchMove = Data.taggedEnum<BranchMove>()

/**
 * Which changes to read — the three slices of a trak's work anybody asks for.
 *
 * A tagged trio rather than a pair of refs, because the third one is not a
 * commit range at all: **`Uncommitted` is the only variant that needs the
 * checkout to still be on disk**, and it is answered by reading a working tree
 * rather than two commits. Flattening them would leave a caller free to ask for
 * the one thing a merged trak cannot answer and get silence back.
 *
 * `Branch` carries the whole `Worktree` rather than two shas because **neither**
 * of its ends is a fact a caller holds: the far one is the branch's tip, which
 * moves as the trak works, and the near one is where this branch and the one it
 * forked from last agreed, which moves as *that* branch does. It is a three-dot
 * diff, the one a pull request shows — so merging the fork branch in stops
 * adding its commits to the answer. `base` is the floor and the fallback, and it
 * is what a trak recorded when its branch was made.
 *
 * `Commits` is the pair a step resolves to. It is answered from refs alone, so
 * it still answers after the checkout has been removed — which is what lets a
 * merged or closed trak's work stay readable.
 */
export type ChangeRange = Data.TaggedEnum<{
  Branch: { readonly worktree: Worktree }
  Commits: { readonly from: CommitSha; readonly to: CommitSha }
  Uncommitted: { readonly worktree: Worktree }
}>
export const ChangeRange = Data.taggedEnum<ChangeRange>()
