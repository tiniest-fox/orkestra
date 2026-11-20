// port: git, as the things a trak's lifetime actually needs.
//
// Not a general git wrapper. Three of these exist because a state in
// `workflow/domain` asks for them by name, and the *decision* to create, commit
// or tear down a worktree is a Command — `vcs/` only does. `hasCheckout` is a
// fourth in that group by a different route: it answers the one thing the log
// cannot, which is whether the directory is still there. Two more are asked
// before a trak exists at all, by the command that starts one: what this tool
// keeps out of git, and whether there is uncommitted work a trak would not
// contain. `hasBranch` joins them from further back still — it is asked while a
// trak is being *named*, because a branch outlives the records of the trak that
// made it. None is a state machine's question and all are git's, which is what
// puts them here rather than behind the `Workspace` port that writes the
// projection.
//
// `merge` has two callers pointing in opposite directions:
// a child's branch goes into its parent's checkout when a human closes it as
// *merge*, and a finished trak goes into the branch they are standing on — or, for a
// goal's trak with a goal branch, into the engine's checkout of that branch, which
// `createGoalBranch`, `pushGoal` and `removeGoalCheckout` keep.
// `wouldConflict` is the same question asked before anybody presses anything, and
// it is here rather than beside `merge` for the reason `hasCheckout` is: it
// answers about a destination this tool does not own. `hostBranch` feeds one
// sentence, because a merge goes where the human is standing.
//
// `changes` is the odd one: no state asks for it and nothing decides on it,
// because it answers a person reading the work rather than the engine running
// it. It is here anyway for the reason `hasCheckout` is — the question is git's,
// and a second reader of the repository would be a second idea of how git is
// invoked. The git bar's four — `hostStatus`, `fetch`, `pull` and `push` — are
// here on the same terms, and so are the file browser's two, `projectFiles` and
// `grepProject`. So are `ork proofs`'s three — `headTree`, `publishProofs` and
// `readProofs`.

import { Context, type Effect } from "effect"
import type { Changes } from "../types/changes.js"
import type { GitFailed } from "../types/errors.js"
import type { HostStatus, StashedPress, StashedSync, SyncRefusal } from "../types/host-status.js"
import type { ProjectFiles, ProjectGrep } from "../types/project-files.js"
import type {
  BranchMove,
  BranchName,
  ChangeRange,
  CommitSha,
  KeptWork,
  MergeInto,
  MergeOutcome,
  Removal,
  Worktree,
} from "../types/worktree.js"

export interface VcsShape {
  /**
   * A linked worktree on a new branch, both named after `trakId`.
   *
   * **Idempotent, and stable.** A trak that is set up twice — a restart, a
   * replayed log — gets the checkout it already has rather than a second branch,
   * *and the same `base` it was given the first time*, even if its own agent has
   * committed in between.
   *
   * **Neither half of that is optional.** Force-removing the directory and branch
   * before retrying turns a transient git error into "the last run's work is
   * gone"; re-deriving `base` from the checkout's tip tells `commitWork` the work
   * is an empty branch.
   *
   * A branch left behind by a lost checkout is adopted rather than refused: that
   * is what a human deleting a `Failed` trak's directory leaves, and the branch
   * holds that trak's own work.
   *
   * `from` is where the new branch starts. Absent means the host repository's
   * `HEAD` — a trak a human asked for branches off whatever they were standing
   * on. A spawned child is handed its parent's branch instead, so it starts from
   * the work already done rather than from beside it, and a child created after
   * a sibling merged back inherits that sibling without anything declaring a
   * dependency. A goal's trak is handed `origin/<default>`, a remote-tracking
   * branch, so it starts from what the forge holds rather than from a local branch
   * only as fresh as the last pull — and its fork is recorded as that ref.
   *
   * **It is read only when the branch is being created.** A trak set up a second
   * time keeps the base it was first given, `from` or no `from`: the stability
   * above is the stronger promise, and a restarted child that silently re-based
   * onto a tip which moved under it is the same class of failure as re-deriving
   * `base` from the checkout was.
   */
  readonly createWorktree: (trakId: string, from?: BranchName) => Effect.Effect<Worktree, GitFailed>
  /**
   * Commit everything in the worktree onto its branch. **The checkout stays.**
   *
   * Returns the commit, or `undefined` when the worktree was untouched — which
   * is a pipeline that only produced documents, and the one case where there is
   * nothing to keep and nothing lost by saying so.
   *
   * **The commit does not take the checkout with it.** Removing the checkout at the
   * commit would take a trak's scaffolding away at the moment a human most wants to
   * read it. The commit stays here — work that exists only in a checkout is work a
   * disk failure loses — and `removeWorktree` is a human's decision.
   *
   * **Re-runnable, which is what makes a failed trak retryable.** Called again
   * after it succeeded — a crash between the commit and the event reaching the
   * log, a human retrying — it reports the same commit rather than reading its
   * own clean checkout as a step that produced nothing. Each step asks the
   * current state: commit only what is pending, then read the answer off the
   * branch rather than off whether this call did the committing.
   *
   * It fails instead of guessing when the checkout is no longer on `branch` —
   * an agent that ran `git checkout -b` inside it puts the work somewhere this
   * cannot tell from an empty branch, and the failed trak keeps its checkout so
   * a human can.
   *
   * **`undefined` means nothing is on this branch beyond `base`** — not that the
   * call just made changed nothing. A caller committing per step reads the same
   * answer twice in a row when the second step touched nothing, which is not the
   * same claim as *this step changed no files*; the caller is what has to say so.
   */
  readonly commitWork: (
    worktree: Worktree,
    message: string,
  ) => Effect.Effect<CommitSha | undefined, GitFailed>
  /**
   * Take the checkout away, and the branch too if nothing was ever committed to
   * it. **What a trak leaves behind is the branch**, so this is safe to run only
   * after `commitWork` — which is why `decide` reaches it from three states that
   * have all been through `Integrating` or `Abandoning` first.
   *
   * An empty branch is deleted here rather than in the commit half, and that is
   * where it belongs: a branch nothing committed to is litter, but only once
   * nobody is going to commit to it. The recorded base and fork refs go with it,
   * and only with it — where the branch survives, they are the only record of
   * where the kept work forked from.
   *
   * **Re-runnable**, on the same terms: it removes the checkout only if it is
   * still there, prunes the admin record if it is not, and deletes nothing twice.
   *
   * Under a runner it releases the sandbox, and `removal` says what it runs there first.
   * `Held` is the last fetch skipped, because this machine already holds everything the
   * sandbox could give. `Reach` fetches a last time, and its `kept` judges a fetch that
   * fails: the sandbox is released anyway where nothing is lost with it, and kept,
   * failing the removal with what could be, where it is not.
   */
  readonly removeWorktree: (worktree: Worktree, removal: Removal) => Effect.Effect<void, GitFailed>
  /**
   * What the removal has to run in the trak's sandbox, given what the log says of its
   * work. `Held` only where the sandbox holds nothing this machine does not — the branch
   * is merged, or this machine's copy is at the last commit the log recorded with nothing
   * run since — so the caller may skip everything it would have run there as well.
   *
   * **Always `Reach` with no runner file**, where there is no sandbox to reach into and a
   * teardown runs on this machine anyway.
   */
  readonly removalFor: (worktree: Worktree, kept: KeptWork) => Effect.Effect<Removal, GitFailed>
  /**
   * Take the checkout away and nothing else: the branch, its base and its fork stay
   * whether or not anything was committed. For a checkout `remakeCheckout` made whose
   * setup failed, so the retry can make it again — `removeWorktree` would delete an empty
   * branch, and the retry would find nothing to make it from. Re-runnable as that is.
   */
  readonly removeCheckout: (worktree: Worktree) => Effect.Effect<void, GitFailed>
  /**
   * Delete the branch, its recorded base and fork refs, and its copy on `origin` —
   * **commits and all.** Archiving is the one caller: a person has confirmed that
   * this trak's git footprint goes, so unlike everything else on this port it
   * destroys work on purpose, and the confirmation upstream is the whole of the
   * guard. A branch is the only thing in this system holding work the log does
   * not, which is why this is its own method rather than a widening of
   * `removeWorktree` — that one's conditional deletion has a destroyed-work bug
   * behind it and keeps its contract exactly as written.
   *
   * The remote copy goes only where `origin` exists and holds the branch, so a
   * repository with no remote and a branch nobody pushed both archive cleanly.
   * Its push is the one that deletes; `push` below is the other, and never forces.
   *
   * Another trak's fork record naming this branch is moved to the branch this one forked
   * from, or forgotten where that is unknown, so no record is left naming nothing.
   *
   * **Re-runnable**: a branch, ref or remote copy already gone is a no-op, never
   * a failure — a retried archive must get past the half a previous run did.
   */
  readonly deleteBranch: (worktree: Worktree) => Effect.Effect<void, GitFailed>
  /**
   * Forget the trak's recorded base and fork, and nothing else — what wiping a trak
   * leaves of it in git otherwise. Its branch and checkout stay: wiping forgets that the
   * trak happened, it does not destroy work. **Re-runnable**: a record already gone is a
   * no-op.
   */
  readonly forgetTrak: (trakId: string) => Effect.Effect<void, GitFailed>
  /**
   * Bring the trak's branch into this repository from wherever its checkout is. Under a
   * runner that is the trak's sandbox, and this is the fetch that keeps every ref read
   * here current — run after each turn, and by `commitWork` and `merge` themselves. A
   * checkout on this machine shares this repository's refs, so there it does nothing.
   */
  readonly fetchWork: (trakId: string) => Effect.Effect<void, GitFailed>
  /**
   * This machine's `trak/<id>` forced to what `origin` holds now, made where it is missing.
   * Under an external store, where `origin` is the record and the cache checkout a clone that
   * holds no trak's branch until something fetches it. With no external store this machine's
   * branch is the record, so this fails rather than overwrite it.
   */
  readonly branchFromOrigin: (trakId: string) => Effect.Effect<void, GitFailed>
  /**
   * The branch a conflicted merge was aimed at, `target`, put in the trak's checkout's
   * repository under the same name, so a step resolving the conflict can `git merge` it
   * there. Under a runner, where the trak has a sandbox: a target that is itself a
   * sandboxed trak's branch is fetched from its sandbox first, and **a fetch that fails
   * fails this** rather than send a copy short of that trak's commits — `merge`'s rule.
   * Then this machine's copy is pushed in. A target this machine holds no branch for — a
   * goal's `origin/<branch>` — is left for the checkout's own remotes. A checkout on this
   * machine shares this repository's refs, so there it does nothing.
   */
  readonly carryTarget: (trakId: string, target: BranchName) => Effect.Effect<void, GitFailed>
  /**
   * The trak's checkout's uncommitted and untracked files, ignored ones left out, kept as
   * one commit over its branch tip at `refs/orkestra/carried/<id>` — in the sandbox and,
   * fetched, here — so a sandbox about to be made again can be given them back by
   * `carryIn`. The checkout and its index are left as they were. Under a runner only:
   * with none it fails, since a checkout on this machine is never made again. Refused,
   * carrying the ref, while `leftBehind` answers one.
   */
  readonly carryOut: (trakId: string) => Effect.Effect<void, GitFailed>
  /**
   * What `carryOut` kept, put back into the trak's new checkout as uncommitted changes
   * over its branch tip, then the ref deleted here and there. All or nothing: where they do
   * not apply nothing is changed, and the failure names the ref that still holds them.
   */
  readonly carryIn: (trakId: string) => Effect.Effect<void, GitFailed>
  /**
   * `refs/orkestra/carried/<id>` where it is still here — changes a remake captured and
   * did not put back, since `carryIn` deletes it once they are — or `undefined`. While it
   * is here `carryOut` refuses, so a later capture never overwrites it.
   */
  readonly leftBehind: (trakId: string) => Effect.Effect<string | undefined, GitFailed>
  /**
   * Where this machine's `trak/<id>` points, or `undefined` where it has no such branch.
   * Under a runner it is only as fresh as the last `fetchWork`, which is why the first
   * boot after a restore reads it on both sides of one.
   */
  readonly branchTip: (trakId: string) => Effect.Effect<CommitSha | undefined, GitFailed>
  /**
   * Is there a checkout for this trak **right now**?
   *
   * Keyed on the id rather than a `Worktree`, because the path is derived from the
   * id in one place and a caller asking this may not have a `Worktree` yet — which
   * is precisely the caller that needs it.
   *
   * It is the one question in this file whose answer nothing else can supply. The
   * log says whether a checkout was ever *prepared* (`WorktreeReady` is only
   * written once the project's setup script has passed), and `TrakState` says
   * whether the engine has *removed* one. Neither knows about a human with
   * `rm -rf`, and both are wrong in the direction that skips setup for a directory
   * that is not there.
   *
   * `false` for a registration git still holds over a directory that has gone —
   * the same reading `removeWorktree` prunes on, and the fact that matters.
   */
  readonly hasCheckout: (trakId: string) => Effect.Effect<boolean, GitFailed>
  /**
   * The trak's checkout made again from its branch, where `hasCheckout` says it is not
   * there — deleted by hand, or never restored with the rest of the project. `undefined`
   * where it is there, and under a runner, whose sandboxes have their own remake.
   *
   * **A branch that is gone too fails rather than starting afresh**, which is the one
   * thing `createWorktree` would do differently: a trak mid-plan forked again from `HEAD`
   * would carry on as if every step it kept had never run.
   */
  readonly remakeCheckout: (trakId: string) => Effect.Effect<Worktree | undefined, GitFailed>
  /**
   * Is there a branch for this trak — checked out or not, and whatever the store
   * says?
   *
   * Keyed on the id for the reason `hasCheckout` is, and asked by the same kind
   * of caller: the mint, which has no `Worktree` and no trak yet. It exists
   * because a trak's git footprint outlives its records. Wiping a trak removes
   * its event log and touches neither the branch nor the recorded base ref, so a
   * branch with no records behind it is one request away — and a name drawn onto
   * that branch is a new trak adopting a dead one's commits.
   *
   * The branch alone, not the base ref: a ref with no branch is overwritten when
   * the branch is created, while a branch is the only thing in this system
   * holding work the log does not.
   */
  readonly hasBranch: (trakId: string) => Effect.Effect<boolean, GitFailed>
  /**
   * The commits `worktree`'s branch holds after `merged` — the head of a pull request
   * that has merged — replayed onto `origin/<base>` as fetched now, pushed to `origin`
   * with a lease on what it held, and the trak's recorded base moved to the new start.
   *
   * What a squash merge needs before more work goes on the branch: the old commits are
   * in no history of the base, so a branch left on them carries them into the next pull
   * request. Run in the trak's checkout, wherever it is, and this machine's copy of the
   * branch brought level after — `fetchWork`'s rule.
   *
   * **A rebase that stops is aborted, and a push refused leaves the checkout reset to
   * where it was**: `Refused` means the branch is unchanged here and on `origin`, and a
   * push that landed is `Moved` whatever fails after it. See `BranchMove`.
   */
  readonly moveOntoBase: (
    worktree: Worktree,
    merged: CommitSha,
    base: BranchName,
  ) => Effect.Effect<BranchMove, GitFailed>
  /**
   * Merge `branch` into whatever `into` names — a trak's own checkout at a
   * spawn's join, or the host repository when a human merges a finished trak.
   *
   * **A conflict comes back as a `MergeOutcome`, not through the error channel**
   * — see the type for the argument. A conflicting merge is *aborted*, so the
   * destination is left clean and `branch` is left unmerged and visible: not
   * deleted, not half-applied, and still there for whoever resolves it. A branch
   * is the only thing in this system holding work the log does not.
   *
   * **Re-runnable**, which is what makes a join restartable: called again over a
   * branch already in, it reports the same tip rather than failing or reading
   * its own earlier success as nothing to merge.
   *
   * A `Checkout` target is confirmed to still be on its own branch, for the
   * reason `commitWork` does — a merge into someone else's branch or a detached
   * `HEAD` puts the work where nothing downstream is looking for it. A `Host`
   * target is **not**: where the human is standing is the destination by
   * definition, and there is no branch of ours there to be wrong about. What a
   * host merge refuses instead is a dirty tree, and it refuses it before it is
   * asked — see `dirty`.
   *
   * A `Goal` target merges in the engine's own checkout of the goal branch, made the
   * first time one is asked for. It is fetched and brought level with
   * `origin/<branch>` first, so a pull request the forge merged into the goal branch
   * is under this merge rather than overwritten by its push. A merge that goes in is
   * pushed; a push that fails is logged and left for the next one, and the merge
   * stands. **One goal's checkout takes one operation at a time**: a `Goal` merge, from
   * its fetch to its push, `pushGoal` and `removeGoalCheckout` each wait for the one
   * before them on the same goal.
   *
   * **Under an external store, with the project's sandbox in use, a `Host` or `Goal` merge
   * lands on `origin` instead**: merged in sandbox `project` from `origin`'s copies of
   * both branches, onto the default branch or the goal branch, and pushed before it
   * answers `Merged`. A refused push fails it, and the cache checkout is fetched after.
   */
  readonly merge: (
    into: MergeInto,
    branch: BranchName,
    message: string,
  ) => Effect.Effect<MergeOutcome, GitFailed>
  /**
   * Would that merge conflict? Asked and answered without performing it.
   *
   * `git merge-tree --write-tree` does the merge in memory: no worktree, no
   * index, no checkout touched, and nothing to abort — so this is safe to ask
   * about a destination somebody else is standing in, which `merge` is not.
   *
   * **A boolean, and not the paths.** The paths a resolution is planned against
   * come from the attempt, which is the authoritative answer; what this buys is
   * telling a person which button they are about to press. Anything richer would
   * be a second, staler account of the same conflict.
   *
   * **It predicts and never decides.** A caller that short-circuited on `true`
   * would spend a turn whenever the prediction is stale in the harmless
   * direction — the merge is instant and free, so the attempt is the check.
   *
   * A `Goal` target is asked against `origin/<branch>` as last fetched — the tip the
   * merge itself starts from — here and in `contains`.
   */
  readonly wouldConflict: (into: MergeInto, branch: BranchName) => Effect.Effect<boolean, GitFailed>
  /**
   * Make `branch` on `origin` from `origin/<default>`, where `origin` does not hold it
   * already — what a goal with a goal branch needs before its first trak is cut. `from`
   * names another branch on `origin` to cut it from instead: a sub-goal's branch is cut
   * from its parent's goal branch.
   * Refused, through the error channel with the reason, for a name git will not take as
   * a branch, for the default branch itself or `from` itself, and where there is no
   * `origin`, no default branch, or no `from` on `origin` to cut it from. **Re-runnable**:
   * a branch `origin` holds is left as it is.
   */
  readonly createGoalBranch: (
    branch: BranchName,
    from?: BranchName,
  ) => Effect.Effect<void, GitFailed>
  /**
   * Push the engine's checkout of a goal branch, where there is one — the merges a
   * failed push after `merge` left behind. Fetched first: nothing is sent where
   * `origin/<branch>` already holds the checkout's `HEAD`, and a checkout that has
   * diverged from it is refused, as `merge` refuses it. Nothing where there is no checkout.
   */
  readonly pushGoal: (goal: string, branch: BranchName) => Effect.Effect<void, GitFailed>
  /**
   * Take away the engine's checkout of a goal branch, once the goal has ended. The
   * branch is not touched: `origin` holds it, and a person owns it from here.
   * **Re-runnable**, as `removeWorktree` is.
   */
  readonly removeGoalCheckout: (goal: string) => Effect.Effect<void, GitFailed>
  /**
   * Does the destination already hold everything on `branch`? `true` means a merge
   * would bring in no commit at all.
   *
   * Asked of refs and never of a log: a commit a person made by hand in a checkout,
   * or a branch merged and kept, are facts git holds and the trak's log does not,
   * and this is what decides whether a spawn child's branch goes into a parent that
   * has landed — see `MergeWork`. `git merge-base --is-ancestor`, which reads the
   * graph and writes nothing.
   */
  readonly contains: (into: MergeInto, branch: BranchName) => Effect.Effect<boolean, GitFailed>
  /**
   * The branch the host repository is currently on, or `undefined` on a detached
   * `HEAD`.
   *
   * Read by one sentence — *"`trak/abc` branched from `main`; you are on
   * `release/2`"* — and by nothing that decides anything, which is the merge rule
   * stated as a signature: a merge goes where the
   * human is standing, so what this buys is telling them where that is.
   */
  readonly hostBranch: () => Effect.Effect<BranchName | undefined, GitFailed>
  /**
   * The repository's default branch — the local branch `origin/HEAD` names — or
   * `undefined` where no remote says which one that is.
   *
   * What a composer's hand-off is cut from: never this trak's branch, and never
   * `hostBranch`, which is whatever the person happens to be standing on while an
   * agent opens a trak on their behalf. **The local branch, as it stands** — as fresh as
   * the last pull, which is also what a person cutting
   * a branch by hand from `main` gets. `createWorktree` records that name as the
   * fork, so the new trak's changes read against it.
   *
   * `undefined` rather than a guess: a repository with no `origin`, or one whose
   * `origin/HEAD` was never set, has no answer, and a base invented here would be
   * wrong where it cannot be seen. `git remote set-head origin --auto` is what sets it.
   */
  readonly defaultBranch: () => Effect.Effect<BranchName | undefined, GitFailed>
  /**
   * The commit `origin/<branch>` names in the host repository, as of the last `fetch` —
   * `undefined` where there is no such remote-tracking branch. What a goal composer is told
   * of the default branch a merge into its goal branch conflicted with, so the trak that
   * resolves it merges that commit and not whatever the branch has moved to since.
   */
  readonly originTip: (branch: BranchName) => Effect.Effect<CommitSha | undefined, GitFailed>
  /**
   * Everything `git status --porcelain` reports, line for line — empty when the
   * tree is clean. In the host repository, or in `checkout` when one is given.
   *
   * A trak branches from a commit, so anything uncommitted is invisible to it. A
   * trak that silently does not contain the work you were in the middle of is a
   * worse failure than being told to commit first, which is why the CLI refuses
   * to start one from a dirty tree. The lines rather than a boolean, because the
   * refusal has to say which files.
   *
   * The same question of a parent's checkout gates a child's merge into it: git
   * refuses to merge over an uncommitted copy of a file the branch touches, and
   * asking first is what keeps the child at `Finished` with its press instead of
   * failing it. So does a sandbox about to be made again, which only its path and branch
   * name — the base is no part of the answer.
   */
  readonly dirty: (
    checkout?: Pick<Worktree, "path" | "branch">,
  ) => Effect.Effect<readonly string[], GitFailed>
  /**
   * The checkout's files as one git tree id: tracked and untracked, ignored ones left
   * out, committed or not. Two checkouts holding the same files answer the same id.
   *
   * **The checkout's index is never touched.** `commitWork` stages whatever is in the
   * checkout after this, and an index this had staged into would change what it commits.
   *
   * `leaveOutGenerated` hashes the tree without every file `.gitattributes` marks
   * `linguist-generated` — committed copies as well as the ones on disk, so editing only
   * those files answers the same id.
   */
  readonly workingTree: (
    /** Absent for the checkout this layer was built in, as `dirty`'s is. */
    checkout: Worktree | undefined,
    leaveOutGenerated: boolean,
  ) => Effect.Effect<string, GitFailed>
  /** The tree `HEAD` names in this layer's checkout — what a published proof is named by. */
  readonly headTree: () => Effect.Effect<string, GitFailed>
  /**
   * Publish `text` as the unit proofs for `tree`: one commit holding it, and each of
   * `prints` beside it by its name, under `refs/passes/<tree>` here and on `origin`,
   * replacing whatever was there.
   *
   * One ref per tree rather than one shared ref, so two checkouts publishing at once never
   * race on the same ref unless they hold the same files. A commit rather than a bare
   * blob, because a forge may refuse a ref that names anything else. The prints ride the
   * same commit because they hold for any tree: a reader who knows a tree the host
   * published finds them there after every other tree has moved on.
   */
  readonly publishProofs: (
    tree: string,
    text: string,
    prints?: readonly ProofPrint[],
  ) => Effect.Effect<void, GitFailed>
  /**
   * The proofs `origin` holds for `tree`, fetched, or `undefined` where it holds none or
   * there is no `origin`. With `prints`, the prints published beside them are written
   * out under that directory, laid out by their names.
   */
  readonly readProofs: (
    tree: string,
    prints?: string,
  ) => Effect.Effect<string | undefined, GitFailed>
  /**
   * Add whatever is missing from the repository's `info/exclude` so the
   * directories Orkestra keeps in it stay out of git. Idempotent.
   *
   * **Never a tracked file.** Appending to `.gitignore` made the tree dirty, and the
   * next trak's start was refused for it — the engine edited the file whose
   * uncommitted change it then refused to start over. `info/exclude` is never
   * committed, and every linked worktree reads the common directory's copy, so it
   * covers the checkout `commitWork` is about to commit wholesale. An ignore file
   * inside `.orkestra/` would be an untracked file of its own.
   *
   * The git root, not the `.orkestra/` root: the library walks up for
   * `.orkestra/` the way git walks up for `.git`, and the two can land in
   * different places.
   */
  readonly ensureIgnored: () => Effect.Effect<void, GitFailed>
  /**
   * What one slice of the work did to the files. Nothing in `workflow/domain` asks
   * for it, nor for the six below it.
   *
   * It is on this port rather than beside the route that reads it because git
   * already has one, with a contract suite behind it; a second reader of the
   * repository would be a second idea of how it is invoked.
   *
   * **A committed slice is answered from refs, so it outlives the checkout —
   * but not the branch.** Archiving runs `deleteBranch`, after which a `Branch`
   * range answers no files: the refs are gone, and that is the deletion a person
   * confirmed rather than a failure to read. `Uncommitted` cannot promise even
   * the checkout, and it does not fail there — a checkout that is gone holds no
   * uncommitted work, so the honest answer is no files rather than an error.
   *
   * **Capped, and it says what it dropped.** A branch that touched a lockfile is
   * ordinary, so both the file count and one file's patch length are bounded —
   * see `logic/diff.ts`. Every file still reports its `+/−`, including the ones
   * whose hunks were dropped, so a truncated answer is visibly truncated.
   *
   * **A file `.gitattributes` marks `linguist-generated` arrives collapsed** — its counts,
   * no hunks, and `omitted: "generated"` — read against the far end of a committed slice
   * and against the checkout for an uncommitted one. `only` asks for one file of the slice
   * with its hunks, which is how a collapsed file is opened; a path the slice does not
   * touch answers no files.
   */
  readonly changes: (range: ChangeRange, only?: string) => Effect.Effect<Changes, GitFailed>
  /**
   * The branch the host repository is on, its upstream, and how far apart the two are
   * — read off local refs, so the counts are as fresh as the last `fetch`.
   *
   * These six are the git bar's: a person keeping the host repository in step with its
   * remote without opening a terminal. They answer a person rather than the engine, as
   * `changes` does, and they are here for its reason.
   */
  readonly hostStatus: () => Effect.Effect<HostStatus, GitFailed>
  /**
   * Bring `origin`'s refs down into the host repository. Touches no branch and no file.
   *
   * **It never waits on a prompt.** The engine has no terminal to answer one, so a
   * remote that wants a password fails at once rather than hanging the bar: git's own
   * terminal prompt, an askpass program — from the environment or `core.askPass` — and
   * a credential manager's dialog are all closed. A credential helper that answers
   * without asking still answers. The same holds for `push`. `NoOrigin` where there is
   * nothing to fetch from.
   */
  readonly fetch: () => Effect.Effect<SyncRefusal | undefined, GitFailed>
  /**
   * Fast-forward the host's branch to its upstream, as of the last `fetch` — a caller
   * that wants the remote's latest fetches first.
   *
   * **Fast-forward only, and never over uncommitted work.** It refuses a detached
   * `HEAD`, a branch with no upstream, a dirty tree and a diverged branch before it runs
   * anything, and the merge itself is `--ff-only`, so a refusal that came too late is
   * still git declining rather than a merge: nothing here leaves a merge commit, a
   * rebase or a conflict in the checkout. A branch already level is a no-op.
   */
  readonly pull: () => Effect.Effect<SyncRefusal | undefined, GitFailed>
  /**
   * Merge the host branch's upstream into it, as of the last `fetch` — what a diverged
   * branch needs, and what `pull` will not do. A branch that is only behind
   * fast-forwards, and one already level is a no-op.
   *
   * **A refusal leaves the checkout as it was.** It refuses a detached `HEAD`, a branch
   * with no upstream and a dirty tree, and it asks git whether the merge would conflict
   * before it starts one: `Conflicted` names the files, with no merge begun, no ref
   * moved and nothing for a person to abort. A merge that goes in leaves one merge
   * commit and a clean tree.
   */
  readonly reconcile: () => Effect.Effect<SyncRefusal | undefined, GitFailed>
  /**
   * `pull` or `reconcile` over a dirty tree: set every uncommitted change aside, tracked
   * and untracked, run the press, and put the changes back.
   *
   * **Nothing is stashed for a press that would not run.** Every refusal but `Dirty`
   * is decided first, a reconcile's conflict included, so `Refused` means the tree and
   * the stash are as they were.
   *
   * **The changes are put back only where they would go in.** Git is asked first, and
   * where they would conflict with what the press brought down the answer is `Kept`:
   * the tree is clean at the new commit and the changes are in one stash entry.
   * Settling that conflict is a person's.
   *
   * The stash stack is the repository's, and a trak's worktree pushes to the same one.
   * The entry made here is applied and dropped by its own commit, never by position.
   */
  readonly stashAnd: (press: StashedPress) => Effect.Effect<StashedSync, GitFailed>
  /**
   * Send the host's branch to its upstream, or publish it to `origin` under its own
   * name and track that, where it has no upstream.
   *
   * **Never forced.** A branch behind its upstream, or diverged from it, is refused
   * before anything is sent; a remote that moved since the last fetch rejects the push
   * itself, which is a `GitFailed`. A branch with nothing ahead sends nothing.
   */
  readonly push: () => Effect.Effect<SyncRefusal | undefined, GitFailed>
  /**
   * The project checkout's files as git sees them, on disk now: tracked files still
   * there, and untracked ones `.gitignore` does not exclude. An ignored file is not in
   * it, and nothing else may be served off the checkout — the file browser's route
   * refuses any path this does not name.
   *
   * These two are the file browser's, a person reading the project rather than the
   * engine running it, and they are here for `changes`' reason.
   */
  readonly projectFiles: () => Effect.Effect<ProjectFiles, GitFailed>
  /**
   * The lines of those same files holding `text`, as a fixed string and ignoring case,
   * out of the working tree — uncommitted edits included, binary files left out. At most
   * `limit` matches, and `cut` says where there were more. No match is an empty answer,
   * not a failure.
   */
  readonly grepProject: (text: string, limit: number) => Effect.Effect<ProjectGrep, GitFailed>
}

export class Vcs extends Context.Tag("vcs/Vcs")<Vcs, VcsShape>() {}

/** A file a proofs commit carries beside the units: its name there, and where it is now. */
export interface ProofPrint {
  readonly name: string
  readonly path: string
}
