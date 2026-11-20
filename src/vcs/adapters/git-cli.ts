// The only Layer here: git, over the Process port.
//
// Nothing shells out. Every invocation is `git` plus an argv array, so a branch
// name or a base ref is an argument rather than text spliced into a command line
// — and the port's scoped lifetime means a git that hangs is killed with its
// process group instead of blocking the runtime, which `execSync` did for the
// whole of `worktree add`.
//
// The layer takes the directory to start from, like `FsLibraryLayer` does, and
// resolves the repository root once at startup. Every path below is built from
// that root: a relative one would be resolved against `process.cwd()`, which is
// not the same directory whenever `ork` is run from a subdirectory of the repo.

import { Clock, Duration, Effect, Either, Layer, Option, Ref, Stream } from "effect"
import { randomUUID } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { type Exited, Process, type ProcessShape } from "../../agent/ports/process.js"
import type { ProcessFailed } from "../../agent/types/errors.js"
import { FILE_CAP, parseUnifiedDiff } from "../logic/diff.js"
import { collapseGenerated, generatedIn } from "../logic/generated.js"
import {
  conflictedIn,
  hostStatusOf,
  pullRefusal,
  pushRefusal,
  reconcileRefusal,
  stashNamed,
} from "../logic/host-status.js"
import {
  baseRefFor,
  type CheckoutPlace,
  branchFor,
  carriedRefFor,
  forkRefFor,
  GITHUB_HELPER,
  GITHUB_SSH,
  goalCheckoutPathFor,
  ignoreFileWith,
  remotesIn,
  trakOfBranch,
  trakOfCheckout,
  worktreeFor,
  worktreePathFor,
  withoutCredentials,
} from "../logic/paths.js"
import { filesListed, grepRow } from "../logic/project-files.js"
import { gitTooOld, MIN_GIT } from "../logic/version.js"
import type { Changes } from "../types/changes.js"
import type { ProjectFiles, ProjectGrep } from "../types/project-files.js"
import { GitFailed } from "../types/errors.js"
import {
  type HostStatus,
  type StashedPress,
  StashedSync,
  SyncRefusal,
} from "../types/host-status.js"
import {
  BranchMove,
  BranchName,
  ChangeRange,
  CommitSha,
  KeptWork,
  MergeInto,
  MergeOutcome,
  Removal,
  type Worktree,
} from "../types/worktree.js"
import { Sandboxes, type SandboxesShape } from "../ports/sandboxes.js"
import { type During, duringWith, Preparation } from "../ports/preparation.js"
import { PreparingPhase } from "../types/preparing.js"
import { type ProofPrint, Vcs, type VcsShape } from "../ports/vcs.js"

interface GitExit {
  readonly code: number | undefined
  readonly signal: string | undefined
  readonly stderr: string
  /**
   * stdout, exactly as git wrote it. **Untrimmed, and that is load-bearing for
   * one caller**: a patch's context lines begin with a space and its last line
   * may be nothing but spaces, so trimming here would silently shorten a hunk
   * against the length its own `@@` header declares. Everything else reads it
   * through `git`, which trims.
   */
  readonly out: string
}

/**
 * One git command, run to completion. Fails only when git could not be run at
 * all; the exit status comes back as *data*, because two callers here have to
 * tell "git says no" apart from "git did not answer".
 *
 * Scoped per call, for the reason `checks-shell` is: closing the scope kills the
 * process group, so nothing survives a failure halfway through a sequence.
 */
const runGit = (
  proc: ProcessShape,
  cwd: string,
  op: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
  stdin?: string,
): Effect.Effect<GitExit, GitFailed> =>
  Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "git",
      args,
      cwd,
      env,
      stdin,
      holdStdin: false,
    })
    // Drained before awaiting exit, or a full pipe would deadlock the child —
    // `git status` in a large repo is easily more than one pipe buffer.
    const out = yield* Stream.runCollect(spawned.lines)
    const exited = yield* spawned.exited
    return {
      code: exited.code,
      signal: exited.signal,
      stderr: exited.stderr,
      out: [...out].join("\n"),
    }
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )

/**
 * A spawn that failed, under `op` — keeping the runner verb that failed, where git ran in a
 * sandbox through one, so a step commit the provider's limit refused says so on screen.
 */
const gitFailedFrom = (op: string, e: ProcessFailed): GitFailed =>
  new GitFailed({
    op,
    reason: e.reason,
    ...(e.runner === undefined ? {} : { runner: e.runner }),
    ...(e.carried === undefined ? {} : { carried: e.carried }),
  })

const gitFailed = (op: string, args: readonly string[], exit: GitExit): GitFailed =>
  new GitFailed({
    op,
    reason: `git ${args.join(" ")} exited ${exit.code ?? exit.signal ?? "?"}: ${exit.stderr.trim()}`,
  })

/**
 * One git command. Returns its stdout, trimmed; a non-zero exit is a `GitFailed`
 * carrying stderr, which is where git explains itself.
 */
const git = (
  proc: ProcessShape,
  cwd: string,
  op: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Effect.Effect<string, GitFailed> =>
  runGit(proc, cwd, op, args, env).pipe(
    Effect.flatMap((exit) =>
      exit.code === 0 ? Effect.succeed(exit.out.trim()) : Effect.fail(gitFailed(op, args, exit)),
    ),
  )

/**
 * A git command whose *exit status is the answer*: 0 is yes, 1 is no, and
 * anything else is git failing to answer at all.
 *
 * The distinction is the whole point: catching a failure wholesale turns "could
 * not run git" into "there is no such branch", which is a verdict about the work
 * that git never gave.
 *
 * **A command only belongs here if its exit 1 means *no* and nothing else does**,
 * and the four used with it are not on equal footing. `show-ref --verify
 * --quiet` documents exit 1 as "the ref is not there" and `merge-base
 * --is-ancestor` documents it as "no", so those two are git's own discrimination.
 * `cat-file -e` and `symbolic-ref --quiet` document only "non-zero", and their
 * exit 1 — for a missing object, and for a ref that is absent or not symbolic —
 * is measured rather than promised, pinned by the contract tier against real git,
 * where a git that changed it would fail loudly.
 * Before adding another caller, check which of the two it is; a command that
 * exits 1 for anything else would make this answer "no" to a question git failed
 * to read.
 */
const gitAnswers = (
  proc: ProcessShape,
  cwd: string,
  op: string,
  args: readonly string[],
): Effect.Effect<boolean, GitFailed> =>
  runGit(proc, cwd, op, args).pipe(
    Effect.flatMap((exit) => {
      if (exit.code === 0) return Effect.succeed(true)
      if (exit.code === 1) return Effect.succeed(false)
      return Effect.fail(gitFailed(op, args, exit))
    }),
  )

/** The lines of a listing git printed, or none for an empty one. */
const listed = (out: string): readonly string[] => (out === "" ? [] : out.split("\n"))

/**
 * Where a ref points, or `undefined` when it is not there — one process for both
 * the yes or no and the sha.
 *
 * `for-each-ref` keeps the discrimination `gitAnswers` exists for, and documents
 * it: exit 0 is an answer whether or not anything matched, and anything else is git
 * failing to answer. A *dangling* symbolic ref is not listed, so it reads as
 * absent — the reading `forkTip` relies on, measured and pinned by the contract
 * tier. The pattern also matches every ref beneath it — `refs/heads/a`
 * lists `refs/heads/a/b` — so the line is picked by its exact name; a refname holds
 * no space, which is what lets the line split on one.
 */
const refTip = (
  proc: ProcessShape,
  repoRoot: string,
  op: string,
  ref: string,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  git(proc, repoRoot, op, ["for-each-ref", "--format=%(refname) %(objectname)", ref]).pipe(
    Effect.map((out) => {
      const sha = listed(out)
        .map((line) => line.split(" "))
        .find(([name]) => name === ref)?.[1]
      return sha === undefined ? undefined : CommitSha.make(sha)
    }),
  )

/**
 * The directory the checkouts go in.
 *
 * Keeping the checkouts out of `git status` is `ensureIgnored`'s job, in the
 * repository's `info/exclude` — one mechanism for every runtime directory. A `*`
 * gitignore written beside them would be an untracked file of its own.
 */
const makeBase = (base: string): void => {
  mkdirSync(base, { recursive: true })
}

/**
 * The common directory rather than `<repoRoot>/.git`: in a linked worktree `.git` is a
 * file, and every worktree of a repository reads the one `info/exclude` there. Git
 * may answer relative to the directory it ran in, hence the `resolve`.
 */
const excludePathOf = (proc: ProcessShape, repoRoot: string): Effect.Effect<string, GitFailed> =>
  Effect.map(
    git(proc, repoRoot, "find git directory", ["rev-parse", "--git-common-dir"]),
    (common) => join(resolve(repoRoot, common), "info", "exclude"),
  )

const ensureIgnored = (proc: ProcessShape, repoRoot: string): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const path = yield* excludePathOf(proc, repoRoot)
    yield* Effect.try({
      try: () => {
        const written = ignoreFileWith(existsSync(path) ? readFileSync(path, "utf8") : "")
        if (written === undefined) return
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, written)
      },
      catch: (cause) =>
        new GitFailed({
          op: "update info/exclude",
          reason: `could not write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
  })

/**
 * Records in `git worktree list --porcelain` are separated by a blank line and
 * start with `worktree <path>`; `prunable <reason>` appears in the ones whose
 * directory git can no longer find.
 */
const isPrunableLine = (line: string): boolean =>
  line === "prunable" || line.startsWith("prunable ")

const isCheckoutRecord = (porcelain: string, path: string): boolean => {
  const record = porcelain
    .split("\n\n")
    .map((r) => r.split("\n"))
    .find((lines) => lines[0] === `worktree ${path}`)
  if (record === undefined) return false
  return !record.some(isPrunableLine)
}

const listWorktrees = (proc: ProcessShape, repoRoot: string): Effect.Effect<string, GitFailed> =>
  git(proc, repoRoot, "list worktrees", ["worktree", "list", "--porcelain"])

/**
 * Is there a checkout at this path that git knows about *and still has*?
 *
 * `existsSync` was the first answer and it is the wrong question: a `worktree
 * add` interrupted partway leaves the directory there, so the existence check
 * short-circuited and handed back a `Worktree` every later git command would
 * fail against. Registration is the fact that matters, and only git has it.
 *
 * Registration *alone* is the wrong question in the other direction, which cost
 * more. Delete the directory and git keeps the admin record: `worktree list`
 * still prints the exact `worktree <path>` line and adds `prunable gitdir file
 * points to non-existent location` under it. A line match therefore said yes,
 * `finishWorktree` spawned git with a `cwd` nobody has, and every retry came
 * back `GitFailed{op: "stage work", reason: "spawn git ENOENT"}` — which reads
 * as "git is not installed" and never stops reading that way. A prunable record
 * is an admin file, not a checkout, so it answers no and the caller prunes.
 */
const hasCheckout = (
  proc: ProcessShape,
  repoRoot: string,
  path: string,
): Effect.Effect<boolean, GitFailed> =>
  listWorktrees(proc, repoRoot).pipe(Effect.map((out) => isCheckoutRecord(out, path)))

/**
 * Where the branch currently points, or `undefined` when there is genuinely no
 * such branch.
 *
 * Asked of the *branch* rather than of the checkout, so it still answers once
 * the checkout is gone — which is what lets finishing be re-runnable. The
 * missing case is not an error: a previous run that found nothing to commit
 * deletes the branch on its way out, and a re-run has to tolerate its own
 * earlier work rather than fail against it.
 *
 * Absence is `refTip` listing nothing, never a caught `rev-parse` failure. The
 * wholesale catch laundered every git failure into "there is no such branch": one
 * spawn that could not run gave `tip === undefined`, which is `sha === undefined`,
 * which is `WorkCommitted(undefined)` and a trak reporting `Finished` with no
 * commit over a branch that holds the work — and, worse, `branch -D` on the way past. That
 * is the same shape as a transport error read as a verdict about the work, which
 * `agent/interactions/elicit.ts` keeps apart for exactly this reason.
 */
const branchTip = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  refTip(proc, repoRoot, "read branch tip", `refs/heads/${branch}`)

/**
 * Whether the branch is there at all — the yes or no, with no sha read.
 *
 * `op` is the caller's, so a git that could not answer is reported against the
 * question that was being asked rather than against this. Two ask it: deleting
 * a branch, and naming a trak. Discriminating on `show-ref`'s exit status is what
 * keeps "git could not answer" out of "there is no such branch" — the first
 * caller would delete work over that, and the second would draw a new trak onto
 * a closed one's commits.
 */
const branchExists = (
  proc: ProcessShape,
  repoRoot: string,
  op: string,
  branch: BranchName,
): Effect.Effect<boolean, GitFailed> =>
  gitAnswers(proc, repoRoot, op, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])

/**
 * Where this branch started, as git recorded it when the checkout was made, or
 * `undefined` when nothing recorded it.
 *
 * The fact has to outlive the process, and a ref is the only place to put it
 * that git itself maintains. Deriving it instead is what broke: `createWorktree`
 * re-read the *checkout's* `HEAD` on the already-registered path, which is the
 * base only until something commits — and a trak whose agent has committed and
 * is then set up again (a restart, a replayed log) came back with its own tip as
 * its base. `finishWorktree` then compared tip against tip, called it "this step
 * wrote nothing", and `branch -D`'d the work into the reflog.
 */
const recordedBase = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  refTip(proc, repoRoot, "read recorded base", baseRefFor(branch))

/**
 * The base of a branch that outlived its checkout and is about to get a new one.
 *
 * The recorded ref is the answer whenever there is one. Without it the branch
 * predates this ref existing, and its fork point from `HEAD` is the closest
 * honest reconstruction: for a branch that committed nothing that is the branch
 * itself, and for one that committed it is where it left the line `HEAD` is on.
 * It errs *old* on purpose — too old means an empty branch survives as litter,
 * while too new means `finishWorktree` reads real commits as nothing and deletes
 * them, and only one of those is recoverable.
 */
const adoptedBase = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<CommitSha, GitFailed> =>
  Effect.gen(function* () {
    const recorded = yield* recordedBase(proc, repoRoot, branch)
    if (recorded !== undefined) return recorded
    return CommitSha.make(
      yield* git(proc, repoRoot, "read branch base", ["merge-base", branch, "HEAD"]),
    )
  })

interface Start {
  readonly base: CommitSha
  /**
   * The ref to record as the fork, in full — `refs/heads/…` for a local branch, or
   * `refs/remotes/…` for a goal's trak cut from what `origin` holds — or `undefined`
   * to record none.
   */
  readonly forked: string | undefined
}

/**
 * The commit `from` names, and the full ref it names it through.
 *
 * `--symbolic-full-name` applies to the arguments after it, so the first line is the
 * commit and the second the ref — which is what lets `from` be a remote-tracking
 * branch: recorded as `refs/heads/origin/main` the fork would name a branch that does
 * not exist, and the changes view would widen back to `base`.
 */
const startOf = (
  proc: ProcessShape,
  repoRoot: string,
  from: BranchName,
): Effect.Effect<Start, GitFailed> => {
  const args = ["rev-parse", from, "--symbolic-full-name", from]
  return Effect.flatMap(git(proc, repoRoot, "read base", args), (out) => {
    const [sha = "", ref] = out.split("\n")
    return Effect.succeed({
      base: CommitSha.make(sha),
      forked: ref === undefined || ref === "" ? undefined : ref,
    })
  })
}

/**
 * Where a branch nothing holds yet starts, and the branch it forks from.
 *
 * From `HEAD`, both come out of one `rev-parse`: `--abbrev-ref` applies to the
 * arguments after it, so the first line is the commit and the second the branch —
 * or the literal `HEAD` when detached, `hostBranch`'s reading.
 */
const freshStart = (
  proc: ProcessShape,
  repoRoot: string,
  from: BranchName | undefined,
): Effect.Effect<Start, GitFailed> => {
  if (from !== undefined) return startOf(proc, repoRoot, from)
  const args = ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"]
  return Effect.flatMap(git(proc, repoRoot, "read base", args), (out) => {
    const [sha = "", head] = out.split("\n")
    if (head === undefined) {
      return Effect.fail(
        new GitFailed({
          op: "read base",
          reason: `git ${args.join(" ")} printed one line: ${out}`,
        }),
      )
    }
    return Effect.succeed({
      base: CommitSha.make(sha),
      forked: head === "HEAD" ? undefined : `refs/heads/${head}`,
    })
  })
}

/**
 * The start of a branch that outlived its checkout. The fork is recorded only where
 * nothing was — see `createWorktree`.
 */
const adoptedStart = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
  from: BranchName | undefined,
): Effect.Effect<Start, GitFailed> =>
  Effect.gen(function* () {
    const base = yield* adoptedBase(proc, repoRoot, branch)
    if (yield* forkRecorded(proc, repoRoot, branch)) return { base, forked: undefined }
    if (from !== undefined) return { base, forked: (yield* startOf(proc, repoRoot, from)).forked }
    const host = yield* hostBranch(proc, repoRoot)
    return { base, forked: host === undefined ? undefined : `refs/heads/${host}` }
  })

/**
 * Idempotent by checkout check, which is what a restart needs: replaying a log
 * that already contains `WorktreeReady` must hand back the checkout the trak has
 * been working in, not fail on a branch that is already there.
 *
 * The version this replaces answered the same problem by force-removing the
 * directory and force-deleting the branch before retrying, so any transient git
 * error destroyed the previous run's work.
 *
 * Three states are reachable here, and each has to end at the same `Worktree`:
 * the checkout exists (hand it back), the branch exists without one (adopt it),
 * or neither does (make both). The middle case is not exotic — an interrupted
 * `worktree add` leaves it, and so does a human deleting a `Failed` trak's
 * checkout, which is exactly what `Failed` keeps the checkout *for*. Before
 * adopting, `worktree add … -b` was unconditional there, so every retry failed
 * on "a branch named 'trak/<id>' already exists" and no amount of pruning
 * helped: the branch is not a worktree record, so `prune` cannot see it.
 *
 * Adopting is safe because the branch is ours by construction — the name is
 * derived from the trak id in one place and nothing else writes it, so its
 * commits are this trak's own work and re-attaching a checkout is continuing,
 * not overwriting. **That rests on no two traks ever being given the same id**,
 * which a name drawn from a wordlist is not owed for free: the mint redraws
 * until nothing here holds the branch — see `hasBranch` and the `Ids` adapter —
 * and this arm is what it is protecting. Force (`-B`) would not be safe and is
 * not used: it resets the branch, which is the deletion this whole function
 * exists to avoid. The one genuinely dangerous case — the branch being checked
 * out somewhere else — git refuses on its own.
 */
const createWorktree = (
  proc: ProcessShape,
  repoRoot: string,
  trakId: string,
  from: BranchName | undefined,
): Effect.Effect<Worktree, GitFailed> =>
  Effect.gen(function* () {
    const path = worktreePathFor(repoRoot, trakId)
    const branch = branchFor(trakId)
    // Clear the admin records of checkouts whose directories are gone. A stale
    // one makes git refuse to re-add the same path, and pruning is the only thing
    // here that can make a second run of this command work where the first got
    // halfway. `worktree list` marks the records a prune would clear, so it runs
    // only when there is one — and a prunable record never reads as a checkout,
    // so the listing taken before the prune still answers the question.
    const listing = yield* listWorktrees(proc, repoRoot)
    if (listing.split("\n").some(isPrunableLine)) {
      yield* git(proc, repoRoot, "prune worktrees", ["worktree", "prune"])
    }
    if (isCheckoutRecord(listing, path)) {
      // `from` is deliberately not consulted here, and that is the stability
      // promise rather than an oversight: a child set up again after its parent
      // has committed must keep the base it started from, or `finishWorktree`
      // measures its work against a tip that moved under it.
      const recorded = yield* recordedBase(proc, repoRoot, branch)
      // The checkout's own `HEAD` only for a worktree made before the ref
      // existed, and deliberately not written back as if it were authoritative:
      // it is the base only while nothing has committed.
      const base =
        recorded ?? CommitSha.make(yield* git(proc, path, "read base", ["rev-parse", "HEAD"]))
      return worktreeFor(repoRoot, trakId, base)
    }

    yield* Effect.try({
      try: () => makeBase(dirname(path)),
      catch: (cause) =>
        new GitFailed({
          op: "create worktree",
          reason: `could not make ${dirname(path)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
    const orphaned = yield* branchTip(proc, repoRoot, branch)
    // From `HEAD` when nothing says otherwise, deliberately: a trak branches off
    // whatever the human was standing on when they asked for it, which is the
    // commit they described the work against. A spawned child is given its
    // parent's branch instead, so it starts from the work already done. Either
    // way it is resolved to a sha before the checkout is made, so `base` is a
    // commit rather than a ref that moves out from under the trak.
    //
    // The fork branch is read here too and written below, after the add. **It is
    // written once, and never re-derived for a branch being adopted**, which is
    // `adoptedBase`'s rule and for its reason: `base` there comes from the
    // recorded ref rather than from `HEAD`, so reading this off `HEAD` would leave
    // the two describing different forks. A person deleting a `Failed` trak's
    // checkout and resuming from another branch is the way in. A record whose
    // branch has since been deleted still counts as one — the trak did not fork
    // from wherever `HEAD` is now.
    const { base, forked } =
      orphaned === undefined
        ? yield* freshStart(proc, repoRoot, from)
        : yield* adoptedStart(proc, repoRoot, branch, from)
    const worktree = worktreeFor(repoRoot, trakId, base)
    yield* git(
      proc,
      repoRoot,
      "create worktree",
      orphaned === undefined
        ? ["worktree", "add", worktree.path, "-b", branch, base]
        : ["worktree", "add", worktree.path, branch],
    )
    // After the add, so a failed add leaves nothing claiming to know where a
    // branch that was never made began.
    yield* git(proc, repoRoot, "record base", ["update-ref", baseRefFor(branch), base])
    // And *which branch* it forked from, which `base` cannot say: a sha is
    // frozen, and reading the branch's changes needs the end that moves — see
    // `forkRefFor` and `forkPoint`.
    //
    // A detached host `HEAD` has no branch to name, so nothing is recorded and
    // the branch diff stays against `base` — the same fallback a trak made
    // before this ref existed takes.
    if (forked !== undefined) {
      yield* git(proc, repoRoot, "record fork", ["symbolic-ref", forkRefFor(branch), forked])
    }
    return worktree
  })

/**
 * `createWorktree`'s adopting arm alone, for a checkout that went missing after it was
 * prepared — its prune of a stale record included. A directory still standing where
 * git holds no record is not a checkout, and `worktree add` refuses it rather than
 * writing over it.
 *
 * Nothing under a runner: a lost sandbox is `Sandboxes.awake`'s to make again, at the
 * first work in it.
 */
const remakeCheckout = (
  proc: ProcessShape,
  repoRoot: string,
  held: Option.Option<SandboxesShape>,
  trakId: string,
  during: During,
): Effect.Effect<Worktree | undefined, GitFailed> =>
  Effect.gen(function* () {
    if ((yield* sandboxesNow(held, trakId)) !== undefined) return undefined
    const path = worktreePathFor(repoRoot, trakId)
    if (yield* hasCheckout(proc, repoRoot, path)) return undefined
    const branch = branchFor(trakId)
    if (!(yield* branchExists(proc, repoRoot, "read branch", branch))) {
      return yield* new GitFailed({
        op: "remake checkout",
        reason: `the checkout at ${path} is gone, and so is ${branch}, so there is nothing to make it again from`,
      })
    }
    return yield* during(trakId, PreparingPhase.Checkout(), () =>
      createWorktree(proc, repoRoot, trakId, undefined),
    )
  })

/**
 * Everything the step wrote, as one commit; nothing at all when the tree is
 * already clean. Whether that produced a commit is not this function's answer to
 * give — `commitWork` decides it by reading `branchTip` against `base`.
 *
 * `--no-verify` because a pre-commit hook that rejects the work would leave the
 * trak with no way to keep it. Hooks are a human's guard on a human's commit;
 * what runs against a step's work is the checks it declared, and those already
 * ran. `add -A` stages tracked and untracked alike but never ignored files, so
 * `node_modules` and build output stay out on their own.
 */
const stageAndCommit = (
  proc: ProcessShape,
  worktree: Worktree,
  message: string,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    yield* git(proc, worktree.path, "stage work", ["add", "-A"])
    // Read after staging: `--porcelain` prints a line per changed path and
    // nothing at all when the index matches HEAD. Empty is deliberately *not*
    // read as "there was nothing to commit" — that is what `branchTip` decides,
    // by asking whether the branch has moved off `base`, and a clean tree is
    // equally what a commit that already succeeded leaves behind.
    const pending = yield* git(proc, worktree.path, "read status", ["status", "--porcelain"])
    if (pending === "") return

    yield* git(proc, worktree.path, "commit", ["commit", "--no-verify", "-m", message])
  })

/**
 * That the checkout is still standing on the branch the trak's work is judged
 * against — and a loud failure when it is not.
 *
 * A step can run git, and nothing stops an agent from `checkout -b`ing an idea
 * of its own or detaching `HEAD` inside its own checkout. Everything downstream
 * then measures the wrong thing: `stageAndCommit` commits wherever `HEAD` points
 * while `trak/<id>` is still sitting on `base`, so the work reads as "this step
 * wrote nothing", the branch is deleted at close, the checkout is removed, and
 * the trak reports `Finished` over commits nothing records. Off a detached `HEAD`
 * only `git fsck` would find them afterwards.
 *
 * It fails rather than moving `HEAD` back, because putting it back is a guess
 * about which of the two branches holds the work, and guessing wrong is the
 * deletion this is here to prevent. `Failed{worktree}` keeps the checkout, which
 * is precisely when someone wants to look at one.
 */
const confirmOnItsBranch = (
  proc: ProcessShape,
  worktree: Worktree,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    // `--abbrev-ref HEAD` answers the literal `HEAD` when detached, which is not
    // a branch name and so cannot collide with the one we are asking about.
    const head = yield* git(proc, worktree.path, "read checkout branch", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    if (head !== worktree.branch) yield* Effect.fail(offItsBranch(worktree, head))
  })

/** What `confirmOnItsBranch` refuses with, for a checkout whose `HEAD` reads `head`. */
const offItsBranch = (worktree: Worktree, head: string): GitFailed => {
  const where = head === "HEAD" ? "a detached HEAD" : head
  return new GitFailed({
    op: "check checkout branch",
    reason: `${worktree.path} is on ${where}, not ${worktree.branch}: whatever was committed there is not on the trak's branch, so nothing here can tell work from an empty branch. The checkout is kept — move or merge the commits onto ${worktree.branch} and retry.`,
  })
}

/**
 * Whether this trak wrote anything, read off the branch.
 *
 * A branch always *has* commits — it starts at one — so the tip alone says
 * nothing. Only against `base` does "this trak wrote something" separate from
 * "this trak wrote nothing", and that is the whole difference between keeping the
 * work and deleting it. Both halves below ask it, which is what lets them run in
 * either order and more than once: neither infers the answer from what it did
 * itself. The version this replaces inferred "nothing was committed" from a clean
 * tree, so a second run after a successful commit read its own work as an empty
 * branch and `branch -D`'d it — the trak reporting `Finished` with no sha over
 * the top of a commit that only the reflog still knew about.
 */
const committed = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  branchTip(proc, repoRoot, worktree.branch).pipe(
    Effect.map((tip) => (tip === undefined || tip === worktree.base ? undefined : tip)),
  )

/**
 * Everything in the checkout, onto the branch. The checkout stays.
 *
 * **Re-runnable**, which retrying a failed trak depends on: both steps ask the
 * current state rather than assuming the last run got nowhere — commit only what
 * is pending, then read the answer off the branch. A checkout that is already
 * gone is not a failure either; the branch still answers, which is what makes a
 * re-run after a close a no-op rather than a crash.
 *
 * The one thing it will not do is proceed against a checkout that is no longer on
 * its own branch — see `confirmOnItsBranch`. Every judgement here reads the
 * branch, so a wandered `HEAD` makes all of them wrong at once.
 */
const commitWork = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  message: string,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  Effect.gen(function* () {
    if (yield* hasCheckout(proc, repoRoot, worktree.path)) {
      // Before anything is written: a checkout that wandered off its branch makes
      // every judgement here wrong in the direction that loses work.
      yield* confirmOnItsBranch(proc, worktree)
      yield* stageAndCommit(proc, worktree, message)
    }
    return yield* committed(proc, repoRoot, worktree)
  })

/** `commitWork`, then the branch onto `origin` where commits are recorded there. */
const commitHere = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  message: string,
  record: RecordedOn,
): Effect.Effect<CommitSha | undefined, GitFailed> => {
  const trakId = trakOfBranch(worktree.branch)
  const made = commitWork(proc, repoRoot, worktree, message)
  return record === "here" || trakId === undefined
    ? made
    : Effect.zipLeft(made, pushedFromHere(proc, repoRoot, trakId))
}

/**
 * The recorded base and fork branch, forgotten in one transaction. Both callers
 * forget the two together, and only ever together.
 *
 * **`--no-deref` is not optional and not a style choice.** The fork ref is a
 * *symbolic* ref, and `git update-ref -d` follows one and deletes the branch it
 * names — measured, in a scratch repo: deleting the fork ref of a trak forked
 * from `main` took `refs/heads/main` with it and left the symref dangling. So
 * the flag is what stands between archiving a trak and deleting the branch it
 * came from. The base ref is not symbolic, so the flag changes nothing for it.
 *
 * A `delete` with no old value exits 0 on a ref that is not there, so a second
 * run is a no-op.
 */
const forgetRecords = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<void, GitFailed> => {
  const args = ["update-ref", "--no-deref", "--stdin"]
  const stdin = `delete ${baseRefFor(branch)}\ndelete ${forkRefFor(branch)}\n`
  return runGit(proc, repoRoot, "forget records", args, {}, stdin).pipe(
    Effect.flatMap((exit) =>
      exit.code === 0 ? Effect.void : Effect.fail(gitFailed("forget records", args, exit)),
    ),
  )
}

/**
 * Every other branch's fork record that names `branch`, moved off it before it is
 * deleted — onto the branch `branch` itself forked from, or deleted where that is not
 * known.
 *
 * **A record left naming a deleted branch is a symbolic ref to nothing, and `git fsck`
 * reports it as corruption** — which failed the first backup drill, on a piece whose
 * parent had been archived. Moving it one step up keeps the moving end the record is
 * for: the parent's work landed where the parent forked from, or nowhere, and
 * `forkPoint`'s floor at `base` keeps either answer to the piece's own work.
 *
 * Run before the `branch -D`, and only then: `for-each-ref` does not list a dangling
 * symbolic ref, so afterwards the records naming the branch can no longer be found.
 * Deleting is `--no-deref`, for `forgetRecords`' reason.
 */
const releaseForks = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const out = yield* git(proc, repoRoot, "read fork records", [
      "for-each-ref",
      "--format=%(refname) %(symref)",
      "refs/orkestra/fork/",
    ])
    const records = listed(out).map((line) => line.split(" "))
    const deleted = `refs/heads/${branch}`
    const own = forkRefFor(branch)
    const onward = records.find(([name]) => name === own)?.[1]
    const naming = records.filter(([name, target]) => target === deleted && name !== own)
    for (const [name = ""] of naming) {
      yield* onward === undefined || onward === "" || onward === deleted
        ? git(proc, repoRoot, "forget fork", ["update-ref", "--no-deref", "-d", name])
        : git(proc, repoRoot, "repoint fork", ["symbolic-ref", name, onward])
    }
  })

/**
 * The checkout goes; the branch stays, unless it never held anything.
 *
 * `--force` is safe *here* and only here, because `commitWork` having run is what
 * makes it safe: everything tracked is already on the branch, and what remains is
 * the ignored build output git would otherwise refuse to walk past. The version
 * this replaces force-removed without committing, which is the same command
 * meaning the opposite thing — and the port is what states the ordering now that
 * a human, rather than the next line of a function, is what triggers this.
 *
 * **Re-runnable**: remove the checkout only if it is still there, prune the admin
 * record if it is not, and delete a branch only while there is one.
 */
const removeWorktree = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
): Effect.Effect<void, GitFailed> =>
  Effect.zipRight(
    removeCheckout(proc, repoRoot, worktree),
    dropEmptyBranch(proc, repoRoot, worktree),
  )

/** `removeWorktree`'s first half: the checkout, or its stale record, and nothing else. */
const removeCheckout = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    if (yield* hasCheckout(proc, repoRoot, worktree.path)) {
      yield* git(proc, repoRoot, "remove worktree", [
        "worktree",
        "remove",
        "--force",
        worktree.path,
      ])
    } else {
      // The checkout went in a previous run; the registration git still holds
      // for it did not. Pruning is what makes a re-run of this command a no-op
      // rather than a failure against a directory nobody has.
      yield* git(proc, repoRoot, "prune worktrees", ["worktree", "prune"])
    }
  })

/**
 * The branch, its recorded base and its fork, deleted where nothing was ever committed
 * to it — what `removeWorktree` does once the checkout is gone, wherever it was.
 */
const dropEmptyBranch = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    // The same question `committed` asks, spelled out because the answer wanted
    // here is the tip as well: `undefined` means a previous run already deleted
    // the branch, and equal-to-base means this run is the one that should.
    const tip = yield* branchTip(proc, repoRoot, worktree.branch)
    // Nothing was ever committed, so the branch is the base commit under another
    // name. Keeping one per trak would leave a repo full of them. `tip` absent
    // means a previous run already did this.
    //
    // The recorded base and fork go with the branch and only with it. They are
    // the answer to "what does an empty `trak/<id>` look like", so they are
    // litter once there is no `trak/<id>` — by the same argument that deletes the
    // branch itself. Where the branch *survives*, both stay: they are then the
    // only record of where the kept work forked from, worth a few bytes to
    // whoever reads that branch later, and what a re-created checkout reads
    // instead of guessing. `forgetRecords` is a no-op on refs already gone, so a
    // second run is too.
    if (tip !== undefined && tip === worktree.base) {
      yield* releaseForks(proc, repoRoot, worktree.branch)
      yield* git(proc, repoRoot, "delete branch", ["branch", "-D", worktree.branch])
      yield* forgetRecords(proc, repoRoot, worktree.branch)
    }
  })

/** Whether a remote named `origin` is configured. Local: nothing asks the network. */
const hasOrigin = (proc: ProcessShape, repoRoot: string): Effect.Effect<boolean, GitFailed> =>
  Effect.map(git(proc, repoRoot, "list remotes", ["remote"]), (remotes) =>
    remotes.split("\n").includes("origin"),
  )

/**
 * Whether `origin` holds this branch **right now**, asked of the remote itself.
 *
 * `ls-remote --exit-code` documents exit 2 as "no matching refs" — its own
 * discrimination, like `show-ref`'s, so a network that is down or a remote that
 * refuses stays a `GitFailed` rather than reading as "nothing to delete". That
 * direction matters: the wrong reading here leaves a remote branch behind
 * silently, which a person who confirmed the deletion has no way to notice.
 */
const originHolds = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<boolean, GitFailed> => {
  const args = ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`]
  return runGit(proc, repoRoot, "read origin branch", args).pipe(
    Effect.flatMap((exit) => {
      if (exit.code === 0) return Effect.succeed(true)
      if (exit.code === 2) return Effect.succeed(false)
      return Effect.fail(gitFailed("read origin branch", args, exit))
    }),
  )
}

/**
 * The branch goes — commits and all — with its recorded base ref and its copy on
 * `origin`. The port carries the contract: archiving is the one caller, a person
 * has confirmed it, and this is deliberately **not** `removeWorktree`'s
 * conditional deletion grown a flag.
 *
 * Each half asks the current state before acting, which is what makes a re-run a
 * no-op: an absent branch is skipped, forgetting absent records exits 0,
 * a repository with no `origin` never asks the network at all, and a remote copy
 * already gone — deleted by a previous run, by GitHub's own auto-delete, or by a
 * person — is left alone rather than failed on.
 *
 * The remote half runs last, so a network failure leaves nothing local half
 * done: the retry re-runs the local no-ops and picks up at the push.
 */
const deleteBranch = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    if (yield* branchExists(proc, repoRoot, "delete branch", worktree.branch)) {
      yield* releaseForks(proc, repoRoot, worktree.branch)
      yield* git(proc, repoRoot, "delete branch", ["branch", "-D", worktree.branch])
    }
    yield* forgetRecords(proc, repoRoot, worktree.branch)
    if (!(yield* hasOrigin(proc, repoRoot))) return
    if (yield* originHolds(proc, repoRoot, worktree.branch)) {
      yield* git(proc, repoRoot, "delete origin branch", [
        "push",
        "origin",
        "--delete",
        worktree.branch,
      ])
    }
  })

/**
 * The paths git left unmerged, read out of the index: `U` on both sides is
 * `--diff-filter`'s name for exactly that.
 *
 * Asked of the index rather than inferred from the exit status, which is what
 * decides whether a non-zero merge was a conflict at all. `git merge` does
 * document 1 for a conflict, but it is also what a refusal to start looks like
 * from outside, and the two must not be confused: a dirty checkout or a branch
 * that is not there is git declining to answer, while unmerged paths are git's
 * answer. Reading the code alone would file the first as *the work disagreed*.
 */
const conflictedPaths = (
  proc: ProcessShape,
  path: string,
): Effect.Effect<readonly string[], GitFailed> =>
  git(proc, path, "read conflicts", ["diff", "--name-only", "--diff-filter=U"]).pipe(
    Effect.map((out) => (out === "" ? [] : out.split("\n"))),
  )

/**
 * A merge that did not exit zero, sorted into the two things that can mean.
 *
 * Unmerged paths make it an outcome, and the abort is what the port promises:
 * the destination goes back to where it was, so the human who has to resolve
 * this finds a clean tree and an intact branch rather than a half-applied merge.
 * Nothing else is an outcome — it is git refusing to start, and it escapes as a
 * `GitFailed` naming what it said.
 */
const mergeRefusal = (
  proc: ProcessShape,
  cwd: string,
  args: readonly string[],
  exit: GitExit,
): Effect.Effect<MergeOutcome, GitFailed> =>
  Effect.gen(function* () {
    // Destructured rather than length-checked, because the outcome's paths are
    // non-empty by construction: *there was at least one unmerged path* is the
    // whole of what makes this a conflict, and the type is what says so.
    const [first, ...rest] = yield* conflictedPaths(proc, cwd)
    if (first === undefined) return yield* Effect.fail(gitFailed("merge", args, exit))
    yield* git(proc, cwd, "abort merge", ["merge", "--abort"])
    return MergeOutcome.Conflicted({ paths: [first, ...rest] })
  })

/**
 * `--no-ff`, so the merge is a commit someone can see. With N children merging in
 * turn, fast-forwarding the first of them makes its commits indistinguishable
 * from the parent's own afterwards, and which work came from which child is the
 * question anyone reading a spawn's history has. Merging a whole trak into a
 * human's branch wants the same thing for the same reason.
 *
 * `--no-verify` for the reason `stageAndCommit` uses it: a hook rejecting the
 * merge would leave the trak with no way to keep work that is already committed
 * on both branches, and hooks are a human's guard on a human's commit.
 *
 * The tip is read afterwards rather than assumed to be the merge commit, because
 * *already up to date* also exits zero and creates nothing — which is precisely
 * what a re-run of a merge that already succeeded looks like, and it must report
 * the same sha as the run that did the work.
 */
const mergeInto = (
  proc: ProcessShape,
  cwd: string,
  branch: BranchName,
  message: string,
): Effect.Effect<MergeOutcome, GitFailed> =>
  Effect.gen(function* () {
    const args = ["merge", "--no-ff", "--no-verify", "-m", message, branch]
    const exit = yield* runGit(proc, cwd, "merge", args)
    if (exit.code !== 0) return yield* mergeRefusal(proc, cwd, args, exit)
    return MergeOutcome.Merged({
      sha: CommitSha.make(yield* git(proc, cwd, "read merged tip", ["rev-parse", "HEAD"])),
    })
  })

/**
 * The two destinations, and the one guard that separates them.
 *
 * A checkout is confirmed to still be on its own branch first — merging from one
 * that has wandered puts the child's work on a branch nothing downstream reads.
 * The host has no such guard and must not grow one: where the human is standing
 * *is* the destination, and confirming it against anything would be this tool
 * having an opinion about somebody else's working copy.
 */
const merge = (
  proc: ProcessShape,
  repoRoot: string,
  permits: GoalPermits,
  into: MergeInto,
  branch: BranchName,
  message: string,
): Effect.Effect<MergeOutcome, GitFailed> =>
  MergeInto.$match(into, {
    Checkout: (c) =>
      confirmOnItsBranch(proc, c.worktree).pipe(
        Effect.zipRight(mergeInto(proc, c.worktree.path, branch, message)),
      ),
    Host: () => mergeInto(proc, repoRoot, branch, message),
    Goal: (g) => permits(g.goal)(mergeIntoGoal(proc, repoRoot, g.goal, g.branch, branch, message)),
  })

/**
 * The ref a prediction reads the destination off: a checkout's branch, the host's
 * `HEAD`, or a goal branch as `origin` last held it — where its merge starts.
 */
const destinationRef = (into: MergeInto): string =>
  MergeInto.$match(into, {
    Checkout: (c) => c.worktree.branch,
    Host: () => "HEAD",
    Goal: (g) => remoteRefFor(g.branch),
  })

const remoteRefFor = (branch: BranchName): string => `refs/remotes/origin/${branch}`

/**
 * The port carries the contract. The checks run before anything is sent, and the push is
 * of the fetched default branch's tip, so the person's own checkout is never read.
 */
const createGoalBranch = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
  from: BranchName | undefined,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const op = "create goal branch"
    const refuse = (reason: string) => Effect.fail(new GitFailed({ op, reason }))
    yield* git(proc, repoRoot, op, ["check-ref-format", "--branch", branch])
    if (!(yield* hasOrigin(proc, repoRoot))) {
      return yield* refuse(`there is no \`origin\` to hold the goal branch \`${branch}\``)
    }
    const named = yield* defaultBranch(proc, repoRoot)
    if (named === undefined) {
      return yield* refuse(
        "`origin` names no default branch to cut the goal branch from — `git remote set-head origin --auto` sets one",
      )
    }
    if (named === branch || from === branch) {
      const which = named === branch ? "the default branch" : "the branch it would be cut from"
      return yield* refuse(
        `\`${branch}\` is ${which}, and a goal branch is where a goal's traks land instead of it`,
      )
    }
    if (yield* originHolds(proc, repoRoot, branch)) return
    const base = from ?? named
    if (from !== undefined && !(yield* originHolds(proc, repoRoot, from))) {
      return yield* refuse(`\`origin\` holds no \`${from}\` to cut \`${branch}\` from`)
    }
    yield* gitRemote(proc, repoRoot, "fetch origin", ["fetch", "origin", base])
    yield* gitRemote(proc, repoRoot, op, [
      "push",
      "origin",
      `${remoteRefFor(base)}:refs/heads/${branch}`,
    ])
    // So `origin/<branch>` names it here before the first trak is cut from it.
    yield* gitRemote(proc, repoRoot, "fetch goal branch", ["fetch", "origin", branch])
  })

/**
 * The engine's checkout of a goal branch, made where there is none and brought level with
 * `origin/<branch>` as fetched just now. **Detached**, so it holds no local branch of that
 * name and never collides with a person who has the goal branch checked out themselves;
 * every push names the remote branch.
 *
 * A checkout behind the remote fast-forwards. One ahead of it holds merges an earlier push
 * did not deliver, and stays where it is so the next push carries them. One that has
 * diverged is a person's to settle, and is refused rather than merged or reset.
 */
const goalCheckout = (
  proc: ProcessShape,
  repoRoot: string,
  goal: string,
  branch: BranchName,
): Effect.Effect<string, GitFailed> =>
  Effect.gen(function* () {
    const path = goalCheckoutPathFor(repoRoot, goal)
    const remote = remoteRefFor(branch)
    yield* gitRemote(proc, repoRoot, "fetch goal branch", ["fetch", "origin", branch])
    const listing = yield* listWorktrees(proc, repoRoot)
    if (!isCheckoutRecord(listing, path)) {
      if (listing.split("\n").some(isPrunableLine)) {
        yield* git(proc, repoRoot, "prune worktrees", ["worktree", "prune"])
      }
      yield* Effect.try({
        try: () => makeBase(dirname(path)),
        catch: (cause) =>
          new GitFailed({
            op: "create goal checkout",
            reason: `could not make ${dirname(path)}: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      })
      yield* git(proc, repoRoot, "create goal checkout", [
        "worktree",
        "add",
        "--detach",
        path,
        remote,
      ])
      return path
    }
    if ((yield* goalStanding(proc, path, branch, "fast-forward goal checkout")) === "held") {
      yield* git(proc, path, "fast-forward goal checkout", ["checkout", "--detach", remote])
    }
    return path
  })

/**
 * Where the goal checkout's `HEAD` stands against `origin/<branch>` as last fetched:
 * `held` where the remote already has it, `ahead` where it holds merges the remote does
 * not. Diverged is refused under `op`, the one standing a person has to settle.
 */
const goalStanding = (
  proc: ProcessShape,
  path: string,
  branch: BranchName,
  op: string,
): Effect.Effect<"held" | "ahead", GitFailed> =>
  Effect.gen(function* () {
    const remote = remoteRefFor(branch)
    const ancestor = (a: string, b: string) =>
      gitAnswers(proc, path, "read goal checkout", ["merge-base", "--is-ancestor", a, b])
    if (yield* ancestor("HEAD", remote)) return "held" as const
    if (yield* ancestor(remote, "HEAD")) return "ahead" as const
    return yield* Effect.fail(
      new GitFailed({
        op,
        reason: `${path} and origin/${branch} have diverged: push or reset that checkout by hand`,
      }),
    )
  })

/** The goal checkout's `HEAD` onto the goal branch on `origin`. Never forced. */
const pushGoalHead = (
  proc: ProcessShape,
  path: string,
  branch: BranchName,
): Effect.Effect<void, GitFailed> =>
  Effect.asVoid(
    gitRemote(proc, path, "push goal branch", ["push", "origin", `HEAD:refs/heads/${branch}`]),
  )

/**
 * `mergeInto`, in the goal checkout, then pushed. **The merge stands whatever the push
 * does**: the commit is made and the trak has landed on it, so a refused push is a
 * warning, and the next merge's push, or the goal's Confirm done, carries it.
 */
const mergeIntoGoal = (
  proc: ProcessShape,
  repoRoot: string,
  goal: string,
  goalBranch: BranchName,
  branch: BranchName,
  message: string,
): Effect.Effect<MergeOutcome, GitFailed> =>
  Effect.gen(function* () {
    const path = yield* goalCheckout(proc, repoRoot, goal, goalBranch)
    const outcome = yield* mergeInto(proc, path, branch, message)
    if (outcome._tag === "Merged") {
      yield* pushGoalHead(proc, path, goalBranch).pipe(
        Effect.catchTag("GitFailed", (e) =>
          Effect.logWarning(`goal branch ${goalBranch}: merged, not pushed: ${e.reason}`),
        ),
      )
    }
    return outcome
  })

/**
 * The port carries the contract. Fetched first, so a pull request the forge merged into
 * the goal branch since the last local merge reads as the remote holding the checkout's
 * `HEAD` rather than as a push to be rejected.
 */
const pushGoal = (
  proc: ProcessShape,
  repoRoot: string,
  goal: string,
  branch: BranchName,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const path = goalCheckoutPathFor(repoRoot, goal)
    if (!(yield* hasCheckout(proc, repoRoot, path))) return
    yield* gitRemote(proc, repoRoot, "fetch goal branch", ["fetch", "origin", branch])
    if ((yield* goalStanding(proc, path, branch, "push goal branch")) === "ahead") {
      yield* pushGoalHead(proc, path, branch)
    }
  })

/**
 * One permit per goal checkout, made the first time a goal asks: every operation on the
 * checkout — a merge's fetch, level, merge and push, `pushGoal`, `removeGoalCheckout` —
 * holds it whole. Two traks of one goal merge from separate drives, and without it one
 * merge's level moves `HEAD` off the other's commit before that one pushes.
 */
type GoalPermits = (goal: string) => <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>

const goalPermits = (): GoalPermits => {
  const held = new Map<string, Effect.Semaphore>()
  return (goal) => (effect) =>
    Effect.suspend(() => {
      const known = held.get(goal)
      const permit = known ?? Effect.unsafeMakeSemaphore(1)
      if (known === undefined) held.set(goal, permit)
      return permit.withPermits(1)(effect)
    })
}

/** The port carries the contract. Detached, so there is no branch to delete with it. */
const removeGoalCheckout = (
  proc: ProcessShape,
  repoRoot: string,
  goal: string,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const path = goalCheckoutPathFor(repoRoot, goal)
    if (yield* hasCheckout(proc, repoRoot, path)) {
      yield* git(proc, repoRoot, "remove goal checkout", ["worktree", "remove", "--force", path])
    } else {
      yield* git(proc, repoRoot, "prune worktrees", ["worktree", "prune"])
    }
  })

/**
 * The same merge, in memory, before anybody presses anything.
 *
 * `merge-tree --write-tree` documents its exit status as the answer — 0 merged
 * cleanly, 1 conflicted, anything else git failing to answer — which is
 * `gitAnswers`' contract exactly, inverted because the question here is *would
 * it conflict*. That is the same discrimination `conflictedPaths` draws one
 * function up, arrived at without a checkout to read an index out of.
 *
 * Run in the repository root and against refs, never in a checkout: the
 * destination for a host merge is wherever `HEAD` is over there, and the point
 * of this call is that it can ask without standing in it. The trees it writes
 * are unreferenced objects git collects on its own.
 */
const wouldConflict = (
  proc: ProcessShape,
  repoRoot: string,
  into: MergeInto,
  branch: BranchName,
): Effect.Effect<boolean, GitFailed> =>
  gitAnswers(proc, repoRoot, "predict merge", [
    "merge-tree",
    "--write-tree",
    destinationRef(into),
    branch,
  ]).pipe(Effect.map((clean) => !clean))

/**
 * Whether the destination's tip already has `branch`'s tip among its ancestors —
 * the graph's own answer to *would a merge bring anything*. Refs only, from the
 * repository root, so it can be asked about a checkout somebody is standing in.
 */
const contains = (
  proc: ProcessShape,
  repoRoot: string,
  into: MergeInto,
  branch: BranchName,
): Effect.Effect<boolean, GitFailed> =>
  gitAnswers(proc, repoRoot, "contains", [
    "merge-base",
    "--is-ancestor",
    branch,
    destinationRef(into),
  ])

/**
 * What every diff here is invoked with, so no repository's own configuration can
 * change the shape of the answer.
 *
 * **Each flag turns off something a `.gitconfig` can switch on.** `diff.external`
 * would replace unified output wholesale; `color.ui = always` would colour it;
 * `diff.noprefix` and `diff.mnemonicPrefix` would move or rename the `a/`–`b/`
 * prefixes the parser strips; `diff.context` would change how many context lines
 * a hunk carries; a `textconv` driver would show something other than the file.
 * `core.quotePath=false` keeps a non-ASCII path readable rather than escaped.
 *
 * `-M` is on, so a moved file is one row naming both paths rather than two large
 * opposite ones.
 */
const DIFF: readonly string[] = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--patch",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--unified=3",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
]

/**
 * One diff, as text. **Exit 1 is an answer**, not a failure: it is what
 * `--no-index` says when the two paths differ, which is the whole reason an
 * untracked file is asked about that way.
 *
 * Read off `runGit` rather than `git` because the output must not be trimmed —
 * see `GitExit.out`.
 */
const diffPatch = (
  proc: ProcessShape,
  cwd: string,
  args: readonly string[],
): Effect.Effect<string, GitFailed> => {
  // The whole invocation, so a failure names the command that ran rather than
  // the tail of it — `git HEAD -- exited 128` sends a reader after a call
  // nobody made.
  const whole = [...DIFF, ...args]
  return runGit(proc, cwd, "read changes", whole).pipe(
    Effect.flatMap((exit) =>
      exit.code === 0 || exit.code === 1
        ? Effect.succeed(exit.out)
        : Effect.fail(gitFailed("read changes", whole, exit)),
    ),
  )
}

/** Files in the checkout that git is not tracking and is not ignoring. */
const untrackedIn = (
  proc: ProcessShape,
  path: string,
): Effect.Effect<readonly string[], GitFailed> =>
  git(proc, path, "list untracked", ["ls-files", "--others", "--exclude-standard"]).pipe(
    Effect.map((out) => (out === "" ? [] : out.split("\n"))),
  )

/**
 * Which of `paths` `.gitattributes` marks `linguist-generated`.
 *
 * `source` is the commit whose `.gitattributes` decides — the far end of a committed slice,
 * since the branch may be what added the line. Absent, git reads the checkout `cwd` names,
 * which is the uncommitted slice's answer.
 *
 * **A commit is read through a scratch index, not `check-attr --source`**: that flag is git
 * 2.40, above the 2.38 floor `MIN_GIT` holds and the 2.39 Debian bookworm ships.
 * `read-tree` puts the commit in an index of its own and `--cached` reads `.gitattributes`
 * from it alone, which is the same answer on every git the engine starts on.
 */
const generatedAmong = (
  proc: ProcessShape,
  cwd: string,
  paths: readonly string[],
  source: CommitSha | undefined,
): Effect.Effect<ReadonlySet<string>, GitFailed> => {
  const ask = (env: Readonly<Record<string, string>>, cached: boolean) => {
    const args = [
      "check-attr",
      ...(cached ? ["--cached"] : []),
      "-z",
      "--stdin",
      "linguist-generated",
    ]
    return runGit(proc, cwd, "read attributes", args, env, paths.join("\0")).pipe(
      Effect.flatMap((exit) =>
        exit.code === 0
          ? Effect.succeed(generatedIn(exit.out))
          : Effect.fail(gitFailed("read attributes", args, exit)),
      ),
    )
  }
  if (source === undefined) return ask({}, false)
  const scratch = join(tmpdir(), `orkestra-attr-index-${randomUUID()}`)
  const env = { GIT_INDEX_FILE: scratch }
  return Effect.acquireUseRelease(
    Effect.void,
    () =>
      git(proc, cwd, "read attributes", ["read-tree", source], env).pipe(
        Effect.zipRight(ask(env, true)),
      ),
    () => Effect.sync(() => rmSync(scratch, { force: true })),
  )
}

/**
 * The slice as a reader is sent it: whole, with every `linguist-generated` file collapsed;
 * or the one file `only` names, with its hunks.
 *
 * **One file is cut from the whole patch rather than asked for by pathspec**, because a
 * pathspec of the new path loses the old one and git then reports a rename as an add.
 *
 * **An attribute read that fails sends the slice uncollapsed, and logs why.** Collapsing is
 * a convenience over an answer that is already complete; failing the slice for it would
 * blank the Changes view of every trak, generated files or none, over the one part of the
 * answer it could have done without. Uncollapsed shows more rather than less, so the
 * fallback hides nothing.
 */
const sliceOf = (
  proc: ProcessShape,
  cwd: string,
  patch: string,
  only: string | undefined,
  source: CommitSha | undefined,
): Effect.Effect<Changes> =>
  Effect.gen(function* () {
    const whole = parseUnifiedDiff(patch)
    if (only !== undefined) return { files: whole.files.filter((file) => file.path === only) }
    if (whole.files.length === 0) return whole
    const generated = yield* generatedAmong(
      proc,
      cwd,
      whole.files.map((file) => file.path),
      source,
    ).pipe(
      Effect.catchTag("GitFailed", (e) =>
        Effect.as(Effect.logWarning(`changes sent uncollapsed: ${e.message}`), new Set<string>()),
      ),
    )
    return collapseGenerated(whole, generated)
  })

/**
 * Whether the repository still holds this commit, asked of git rather than inferred
 * from a diff failing.
 *
 * `cat-file -e` on a bare sha exits 1 for an object that is not there and leaves every
 * other code for git failing to answer — `gitAnswers`' shape, though measured rather
 * than documented, which is why the contract tier pins it against real git. **A bare sha,
 * not `<sha>^{commit}`**: the peel makes git resolve a *name* first, and a missing
 * object then exits 128 as an invalid name, indistinguishable from a repository that
 * cannot be read. The discrimination is the point: catching the diff's exit 128
 * instead would read a corrupt object database as *there was nothing here*.
 */
const commitHeld = (
  proc: ProcessShape,
  repoRoot: string,
  sha: CommitSha,
): Effect.Effect<boolean, GitFailed> =>
  gitAnswers(proc, repoRoot, "read commit", ["cat-file", "-e", sha])

/**
 * A commit range, answered against the repository root rather than a checkout —
 * so it still answers once the checkout has gone, which is what lets a finished
 * or merging trak's work stay readable.
 *
 * **It is answered from the objects, not from a ref, and an archive orphans
 * them.** `deleteBranch` takes the branch and its reflog, so every commit it held
 * is unreachable from that moment and gone once git prunes it — silently, weeks
 * later, on a trak nobody touched. Either end missing is therefore **no files
 * rather than a failure**: the deletion a person confirmed, read back at the
 * route that promises nothing-to-read is an empty answer. Nothing is kept to
 * preserve an archived trak's diffs, and that is the decision rather than a gap.
 */
const committedChanges = (
  proc: ProcessShape,
  repoRoot: string,
  from: CommitSha,
  to: CommitSha,
  only: string | undefined,
): Effect.Effect<Changes, GitFailed> =>
  Effect.gen(function* () {
    const held = yield* Effect.all(
      [commitHeld(proc, repoRoot, from), commitHeld(proc, repoRoot, to)],
      { concurrency: "unbounded" },
    )
    if (!held.every(Boolean)) return { files: [] }
    return yield* sliceOf(
      proc,
      repoRoot,
      yield* diffPatch(proc, repoRoot, [from, to, "--"]),
      only,
      to,
    )
  })

/**
 * Whether a fork branch was ever written down — the yes or no, with nothing
 * resolved. **A record whose branch has since been deleted is still a record**,
 * which is why this is not `forkTip`'s question asked for its truthiness:
 * `refTip` reads a dangling symbolic ref as absent, and `createWorktree` would
 * then overwrite it with a branch the trak never forked from.
 *
 * `symbolic-ref --quiet` is `gitAnswers`' shape and answers exactly that — 0 for
 * a symbolic ref live or dangling, 1 for nothing there and for a ref that is not
 * symbolic. Its non-zero is documented; that it is 1 is measured, and the
 * contract tier pins it.
 */
const forkRecorded = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<boolean, GitFailed> =>
  gitAnswers(proc, repoRoot, "read fork branch", ["symbolic-ref", "--quiet", forkRefFor(branch)])

/**
 * Where the branch this one forked from points **now**, or `undefined` when
 * nothing says which branch that was: a trak made before this ref existed, one
 * forked off a detached `HEAD`, or one whose parent branch was deleted before
 * `releaseForks` existed, which left the symbolic ref dangling.
 *
 * A dangling symbolic ref reads as absent — see `refTip`. Reading `rev-parse`'s
 * failure instead would call a repository that cannot answer an unrecorded fork,
 * and silently widen the diff.
 */
const forkTip = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  refTip(proc, repoRoot, "read fork branch", forkRefFor(branch))

/**
 * The commit two of them last shared, or `undefined` when they share none.
 *
 * Unrelated histories exit 1 and are an *answer*; anything else is git failing
 * to reach one. Measured rather than documented, and unpinned because nothing
 * here reaches it: a trak's branch is cut from the branch it forked from, so the
 * two always share a commit. It is written this way for what the discrimination
 * costs if that ever stops being true — a wholesale catch would read a git that
 * could not answer as *no common history* and quietly widen the diff.
 */
const mergeBase = (
  proc: ProcessShape,
  repoRoot: string,
  a: CommitSha,
  b: CommitSha,
): Effect.Effect<CommitSha | undefined, GitFailed> => {
  const args = ["merge-base", a, b]
  return runGit(proc, repoRoot, "read merge base", args).pipe(
    Effect.flatMap((exit) => {
      if (exit.code === 0) return Effect.succeed(CommitSha.make(exit.out.trim()))
      if (exit.code === 1) return Effect.succeed(undefined)
      return Effect.fail(gitFailed("read merge base", args, exit))
    }),
  )
}

/**
 * The near end of a branch's diff: where it and the branch it forked from last
 * agreed. What a pull request compares against, and what `base` on its own
 * cannot give.
 *
 * **`base` is frozen and the merge base moves, which is the whole point.** Merge
 * `main` into a trak and every commit `main` made since the fork is now on the
 * trak's branch; measured from the fork commit they all read as the trak's own
 * work, which is a diff nobody can review. By then `main`'s tip is the merge
 * base, so they drop back out and what is left is what the trak wrote.
 *
 * **Not once the work has landed**, which is the case that decides the shape of
 * this. A merge base equal to the tip means the fork branch already holds
 * everything this branch has — the trak was merged, or a piece joined its parent
 * — so the moving end has moved all the way onto this branch and the diff of it
 * against itself is empty. Every finished trak's changes view would be blank.
 * `base` is the answer there, and it is a *wider* one than the pull request
 * showed wherever the trak caught up with its fork branch before landing: those
 * commits come back. Keeping the narrow end would mean recording it at the
 * moment of the merge, and a blank view is the worse of the two to ship — see
 * the deferred entry *a landed trak's changes view widens back to include what it merged in*.
 *
 * **Never further back than `base`.** A fork branch that has been rebased or
 * amended shares less history than it did, so its merge base can sit *behind*
 * where this branch started — and the diff would grow commits the trak never
 * touched, which is the noise the rest of this removes. `base` is the floor, so
 * this answer is never wider than the one given before the fork ref existed.
 */
const forkPoint = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  tip: CommitSha,
): Effect.Effect<CommitSha, GitFailed> =>
  Effect.gen(function* () {
    const fork = yield* forkTip(proc, repoRoot, worktree.branch)
    if (fork === undefined) return worktree.base
    const shared = yield* mergeBase(proc, repoRoot, fork, tip)
    if (shared === undefined || shared === tip) return worktree.base
    const forward = yield* gitAnswers(proc, repoRoot, "read merge base", [
      "merge-base",
      "--is-ancestor",
      worktree.base,
      shared,
    ])
    return forward ? shared : worktree.base
  })

/**
 * Everything the branch holds that the branch it forked from does not — the
 * three-dot diff, which is what a pull request shows.
 *
 * A branch that is not there is **no committed work** rather than a repository
 * that cannot answer. Two things delete one: `removeWorktree`, only where
 * nothing was ever committed to it, and `deleteBranch`, which is the archive and
 * takes it whatever it held. So the answer is the fact at a live trak and the
 * deletion a person confirmed at an archived one, and neither is a failure.
 */
const branchChanges = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  only: string | undefined,
): Effect.Effect<Changes, GitFailed> =>
  Effect.gen(function* () {
    const tip = yield* branchTip(proc, repoRoot, worktree.branch)
    if (tip === undefined) return { files: [] }
    const from = yield* forkPoint(proc, repoRoot, worktree, tip)
    return yield* committedChanges(proc, repoRoot, from, tip, only)
  })

/**
 * How many untracked files are diffed at once. Bounded because the list can run to
 * `FILE_CAP`, and that many processes at once is a burst the machine pays for
 * beside every other trak.
 */
const UNTRACKED_AT_ONCE = 8

/**
 * What is in the checkout and not yet on the branch — the tracked diff against
 * `HEAD`, plus one `--no-index` diff per untracked file.
 *
 * **Untracked files go through git rather than being read here.** Git does the
 * binary detection and produces a real patch, and `git add -N` — the other way
 * to make them visible to one diff — writes to the index of a checkout an agent
 * may be working in.
 *
 * **No checkout means no uncommitted work**, which is a fact rather than a
 * failure: there is nowhere for it to be. A merged or closed trak answers `all`
 * and its per-step slices from refs, and this one with nothing.
 */
const uncommittedChanges = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  only: string | undefined,
): Effect.Effect<Changes, GitFailed> =>
  Effect.gen(function* () {
    if (!(yield* hasCheckout(proc, repoRoot, worktree.path))) return { files: [] }
    return yield* uncommittedIn(proc, worktree, only)
  })

/** `uncommittedChanges` in a checkout known to be there. */
const uncommittedIn = (
  proc: ProcessShape,
  worktree: Worktree,
  only: string | undefined,
): Effect.Effect<Changes, GitFailed> =>
  Effect.gen(function* () {
    const [tracked, untracked] = yield* Effect.all(
      [diffPatch(proc, worktree.path, ["HEAD", "--"]), untrackedIn(proc, worktree.path)],
      { concurrency: "unbounded" },
    )
    // Cut before the spawns rather than after: past the cap they would be parsed
    // and thrown away, having cost a process each. One file asked for is one spawn at most.
    const asked =
      only === undefined ? untracked.slice(0, FILE_CAP) : untracked.filter((at) => at === only)
    const fresh = yield* Effect.forEach(
      asked,
      (path) => diffPatch(proc, worktree.path, ["--no-index", "--", "/dev/null", path]),
      { concurrency: UNTRACKED_AT_ONCE },
    )
    const answer = yield* sliceOf(
      proc,
      worktree.path,
      [tracked, ...fresh].join("\n"),
      only,
      undefined,
    )
    const unasked = untracked.length - asked.length
    if (unasked === 0 || only !== undefined) return answer
    // The ones never asked about are dropped files too, and a count that left
    // them out would say the list is more complete than it is.
    return { files: answer.files, omittedFiles: (answer.omittedFiles ?? 0) + unasked }
  })

/**
 * The branch the host is on, or `undefined` when `HEAD` is detached.
 *
 * `--abbrev-ref HEAD` answers the literal string `HEAD` when detached, which is
 * not a branch name and so cannot be mistaken for one — the same reading
 * `confirmOnItsBranch` relies on.
 */
const hostBranch = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<BranchName | undefined, GitFailed> =>
  git(proc, repoRoot, "read host branch", ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
    Effect.map((head) => (head === "HEAD" ? undefined : BranchName.make(head))),
  )

/**
 * The local branch `origin/HEAD` names, or `undefined` where nothing does.
 *
 * `symbolic-ref --quiet` is `gitAnswers`' shape: 0 with `refs/remotes/origin/main`
 * where the remote's head is known, 1 where it is not — a repository with no
 * `origin`, or one cloned in a way that never recorded it. The remote-tracking
 * name is turned into the local one, because what is cut from it is a branch of
 * this repository and `createWorktree` records the fork under `refs/heads/`.
 */
const defaultBranch = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<BranchName | undefined, GitFailed> =>
  Effect.gen(function* () {
    const args = ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]
    const exit = yield* runGit(proc, repoRoot, "read default branch", args)
    if (exit.code === 1) return undefined
    if (exit.code !== 0) return yield* Effect.fail(gitFailed("read default branch", args, exit))
    return BranchName.make(exit.out.trim().replace(/^refs\/remotes\/origin\//, ""))
  })

/**
 * Every line `git status --porcelain` prints, or none for a clean tree.
 *
 * Empty stdout is a clean tree, and `git` prints nothing else — so the split is on the
 * trimmed output rather than filtered afterwards, which would report one blank line as
 * one dirty file. Each line trimmed as well, because `git` trims the whole block: a
 * porcelain status column is two characters wide, so the first entry would come back
 * one space narrower than the rest and print misaligned.
 */
const dirtyLines = (proc: ProcessShape, cwd: string): Effect.Effect<readonly string[], GitFailed> =>
  git(proc, cwd, "read status", ["status", "--porcelain"]).pipe(
    Effect.map((out) => (out === "" ? [] : out.split("\n").map((line) => line.trim()))),
  )

/** The files `.gitattributes` marks `linguist-generated`, as a pathspec. */
const GENERATED = ":(attr:linguist-generated)"

/**
 * The checkout's files as a tree id, through a scratch copy of its index.
 *
 * `git add -A` then `git write-tree` is git's own answer to *what would be committed*,
 * ignore rules and all, and running both against a copy leaves the checkout's index as
 * it was. Copied rather than started empty because the copy's stat cache is what lets
 * `add` skip rehashing every unchanged file. A checkout with no index yet starts from
 * none, which `add` creates.
 *
 * **Generated files are left out by removing them after the `add`**, not by excluding
 * them from it: the copied index holds them as of the last commit, and the engine commits
 * after every step, so an excluded entry still changes between steps and the tree id with
 * it. Nor may `add` take the `attr` pathspec at all: git 2.43, above the floor `MIN_GIT`
 * holds, refuses it there, where `rm` takes it. The pathspec reads `.gitattributes` from
 * the checkout, so the file that marks them is itself hashed.
 */
const workingTree = (
  proc: ProcessShape,
  checkout: string,
  leaveOutGenerated: boolean,
): Effect.Effect<string, GitFailed> =>
  Effect.gen(function* () {
    const index = yield* git(proc, checkout, "find index", [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])
    const scratch = join(tmpdir(), `orkestra-index-${randomUUID()}`)
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        if (existsSync(index)) copyFileSync(index, scratch)
      }),
      () => {
        const env = { GIT_INDEX_FILE: scratch }
        const hash = (args: readonly string[]): Effect.Effect<string, GitFailed> =>
          git(proc, checkout, "hash working tree", args, env)
        if (!leaveOutGenerated)
          return hash(["add", "-A", "."]).pipe(Effect.zipRight(hash(["write-tree"])))
        return hash(["add", "-A", "."]).pipe(
          Effect.zipRight(
            hash(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", GENERATED]),
          ),
          Effect.zipRight(hash(["write-tree"])),
        )
      },
      () => Effect.sync(() => rmSync(scratch, { force: true })),
    )
  })

/**
 * What a command that talks to a remote runs with: no prompt, ever. Every route git
 * has to a person is closed:
 *
 * - `GIT_TERMINAL_PROMPT=0` — git's own prompt on a terminal.
 * - `GIT_ASKPASS=` — an askpass program. Empty is not unset: git takes the environment
 *   value whenever it is present and runs nothing when it is empty, so this also stands
 *   over `core.askPass` and `SSH_ASKPASS`. It matters because an engine started from an
 *   editor's terminal inherits that editor's askpass.
 * - `SSH_ASKPASS_REQUIRE=never` — OpenSSH's own askpass.
 * - `GCM_INTERACTIVE=never` — Git Credential Manager, which draws its own dialog.
 *
 * A credential helper that answers without asking still answers. A person's
 * `core.sshCommand` is left alone; a key that wants a passphrase fails rather than asks.
 */
const NO_PROMPT = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
  GCM_INTERACTIVE: "never",
} as const

/** How long a remote gets before the command is killed and reported as no answer. */
const REMOTE_PATIENCE = Duration.minutes(2)

/**
 * A git command that talks to a remote. A remote that never answers — a host that
 * drops packets rather than refusing them — is killed at `REMOTE_PATIENCE` with its
 * process group, which `runGit`'s scope does on interruption.
 */
const gitRemote = (
  proc: ProcessShape,
  repoRoot: string,
  op: string,
  args: readonly string[],
): Effect.Effect<string, GitFailed> =>
  git(proc, repoRoot, op, args, NO_PROMPT).pipe(
    Effect.timeoutFail({
      duration: REMOTE_PATIENCE,
      onTimeout: () =>
        new GitFailed({
          op,
          reason: `git ${args.join(" ")} had no answer from the remote after ${Duration.format(REMOTE_PATIENCE)}`,
        }),
    }),
  )

/** Where one tree's unit proofs are kept, here and on `origin`. */
const proofsRef = (tree: string): string => `refs/passes/${tree}`
/** The units a proofs commit holds, as one file at its root. */
const PROOFS_FILE = "proofs"
/** Where a proofs commit holds the prints beside them: a copy of a store's prints directory. */
const PRINTS_DIR = "prints"

/** `git` with `stdin` written to it. */
const gitFed = (
  proc: ProcessShape,
  cwd: string,
  op: string,
  args: readonly string[],
  stdin: string,
  env: Readonly<Record<string, string>> = {},
): Effect.Effect<string, GitFailed> =>
  runGit(proc, cwd, op, args, env, stdin).pipe(
    Effect.flatMap((exit) =>
      exit.code === 0 ? Effect.succeed(exit.out.trim()) : Effect.fail(gitFailed(op, args, exit)),
    ),
  )

/**
 * Run `use` with an index file of its own, which no checkout reads: the tree a proofs
 * commit holds is built in it and read out of it without touching the checkout's index.
 */
const withScratchIndex = <A>(
  use: (env: Readonly<Record<string, string>>) => Effect.Effect<A, GitFailed>,
): Effect.Effect<A, GitFailed> => {
  const index = join(tmpdir(), `orkestra-proofs-${randomUUID()}.index`)
  return use({ GIT_INDEX_FILE: index }).pipe(
    Effect.ensuring(Effect.sync(() => rmSync(index, { force: true }))),
  )
}

/** The tree of a proofs commit: the units as `PROOFS_FILE`, and each print file under `PRINTS_DIR`. */
const proofsTree = (
  proc: ProcessShape,
  repoRoot: string,
  text: string,
  prints: readonly ProofPrint[],
): Effect.Effect<string, GitFailed> =>
  withScratchIndex((env) =>
    Effect.gen(function* () {
      const op = "publish proofs"
      const blob = yield* gitFed(proc, repoRoot, op, ["hash-object", "-w", "--stdin"], text)
      const blobs =
        prints.length === 0
          ? []
          : (yield* gitFed(
              proc,
              repoRoot,
              op,
              ["hash-object", "-w", "--stdin-paths"],
              prints.map((p) => `${p.path}\n`).join(""),
            )).split("\n")
      const listing = [
        `100644 ${blob}\t${PROOFS_FILE}`,
        ...prints.map((p, i) => `100644 ${blobs[i] ?? ""}\t${PRINTS_DIR}/${p.name}`),
      ]
      yield* gitFed(
        proc,
        repoRoot,
        op,
        ["update-index", "--add", "--index-info"],
        listing.map((l) => `${l}\n`).join(""),
        env,
      )
      return yield* git(proc, repoRoot, op, ["write-tree"], env)
    }),
  )

const publishProofs = (
  proc: ProcessShape,
  repoRoot: string,
  tree: string,
  text: string,
  prints: readonly ProofPrint[],
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const op = "publish proofs"
    const holding = yield* proofsTree(proc, repoRoot, text, prints)
    const commit = yield* git(proc, repoRoot, op, [
      "commit-tree",
      holding,
      "-m",
      `unit proofs for ${tree}`,
    ])
    const ref = proofsRef(tree)
    yield* git(proc, repoRoot, op, ["update-ref", ref, commit])
    // Forced: a later publish of the same tree holds every unit the earlier one did.
    yield* gitRemote(proc, repoRoot, op, ["push", "--force", "origin", `${ref}:${ref}`])
  })

/** The prints a fetched proofs commit at `ref` holds, written out under `into`. */
const extractPrints = (
  proc: ProcessShape,
  repoRoot: string,
  ref: string,
  into: string,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const held = yield* runGit(proc, repoRoot, "find prints", [
      "cat-file",
      "-e",
      `${ref}:${PRINTS_DIR}`,
    ])
    // A commit published before prints were, or with none to carry.
    if (held.code !== 0) return
    mkdirSync(into, { recursive: true })
    yield* withScratchIndex((env) =>
      Effect.gen(function* () {
        yield* git(proc, repoRoot, "read prints", ["read-tree", `${ref}:${PRINTS_DIR}`], env)
        yield* git(
          proc,
          repoRoot,
          "read prints",
          ["checkout-index", "--all", "--force", `--prefix=${resolve(into)}/`],
          env,
        )
      }),
    )
  })

const readProofs = (
  proc: ProcessShape,
  repoRoot: string,
  tree: string,
  prints: string | undefined,
): Effect.Effect<string | undefined, GitFailed> =>
  Effect.gen(function* () {
    if (!(yield* hasOrigin(proc, repoRoot))) return undefined
    const ref = proofsRef(tree)
    const held = yield* gitRemote(proc, repoRoot, "find proofs", ["ls-remote", "origin", ref])
    if (held === "") return undefined
    yield* gitRemote(proc, repoRoot, "fetch proofs", [
      "fetch",
      "--no-tags",
      "origin",
      `+${ref}:${ref}`,
    ])
    if (prints !== undefined) yield* extractPrints(proc, repoRoot, ref, prints)
    return yield* git(proc, repoRoot, "read proofs", ["cat-file", "blob", `${ref}:${PROOFS_FILE}`])
  })

const hostStatus = (proc: ProcessShape, repoRoot: string): Effect.Effect<HostStatus, GitFailed> =>
  Effect.gen(function* () {
    // `--untracked-files=no`: only the header block is read, and listing untracked
    // files is the slow half of a status in a large checkout.
    const args = ["status", "--porcelain=v2", "--branch", "--untracked-files=no"]
    const [out, origin] = yield* Effect.all(
      [git(proc, repoRoot, "read host status", args), hasOrigin(proc, repoRoot)],
      { concurrency: "unbounded" },
    )
    return hostStatusOf(out, origin)
  })

const fetchOrigin = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<SyncRefusal | undefined, GitFailed> =>
  Effect.gen(function* () {
    if (!(yield* hasOrigin(proc, repoRoot))) return SyncRefusal.NoOrigin()
    yield* gitRemote(proc, repoRoot, "fetch origin", ["fetch", "origin"])
    return undefined
  })

/** `--ff-only`, so nothing here can leave a merge commit. A branch already level is a no-op. */
const fastForward = (
  proc: ProcessShape,
  repoRoot: string,
  status: HostStatus,
): Effect.Effect<undefined, GitFailed> =>
  Effect.gen(function* () {
    if (status.upstream === undefined || status.upstream.behind === 0) return undefined
    yield* git(proc, repoRoot, "pull", ["merge", "--ff-only", "@{upstream}"])
    return undefined
  })

/** The host's status and its uncommitted lines, read side by side. */
const statusAndDirt = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<readonly [HostStatus, readonly string[]], GitFailed> =>
  Effect.all([hostStatus(proc, repoRoot), dirtyLines(proc, repoRoot)], {
    concurrency: "unbounded",
  })

/**
 * The port carries the contract. The refusal is decided off the status and the tree as
 * they are now, and `--ff-only` is what keeps a refusal decided a moment too early from
 * becoming a merge.
 */
const pull = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<SyncRefusal | undefined, GitFailed> =>
  Effect.gen(function* () {
    const [status, dirty] = yield* statusAndDirt(proc, repoRoot)
    const refused = pullRefusal(status, dirty)
    if (refused !== undefined) return refused
    return yield* fastForward(proc, repoRoot, status)
  })

/**
 * The paths a merge of `theirs` into `ours` would conflict in, asked in memory —
 * `wouldConflict`'s question with the files named. `--name-only` puts them between the
 * tree and the messages; the exit status is still the answer, so none are read off a
 * merge that would go in.
 */
const mergeConflicts = (
  proc: ProcessShape,
  repoRoot: string,
  ours: string,
  theirs: string,
): Effect.Effect<readonly string[], GitFailed> =>
  Effect.gen(function* () {
    const args = ["merge-tree", "--write-tree", "--name-only", ours, theirs]
    const exit = yield* runGit(proc, repoRoot, "predict merge", args)
    if (exit.code === 0) return []
    if (exit.code === 1) return conflictedIn(exit.out)
    return yield* Effect.fail(gitFailed("predict merge", args, exit))
  })

const conflicted = (status: HostStatus, files: readonly string[]): SyncRefusal | undefined => {
  const [first, ...rest] = files
  if (first === undefined || status.head._tag === "Detached" || status.upstream === undefined) {
    return undefined
  }
  return SyncRefusal.Conflicted({
    branch: status.head.name,
    upstream: status.upstream.name,
    files: [first, ...rest],
  })
}

/** Whether merging the upstream would conflict, before anything in the checkout moves. */
const upstreamConflict = (
  proc: ProcessShape,
  repoRoot: string,
  status: HostStatus,
): Effect.Effect<SyncRefusal | undefined, GitFailed> =>
  Effect.map(mergeConflicts(proc, repoRoot, "HEAD", "@{upstream}"), (files) =>
    conflicted(status, files),
  )

/**
 * Merge the upstream into the branch. `--no-edit`, because there is no terminal for an
 * editor to open in and git would wait on one. `--no-verify` for `mergeInto`'s reason,
 * and one more here: a hook that rejects the merge commit leaves the merge in progress
 * in a person's checkout.
 *
 * A conflict is found by `upstreamConflict` before this runs. One that turns up anyway
 * — the upstream moved in between — is aborted and answered the same way, so the
 * checkout is never left mid-merge.
 */
const mergeUpstream = (
  proc: ProcessShape,
  repoRoot: string,
  status: HostStatus,
): Effect.Effect<SyncRefusal | undefined, GitFailed> =>
  Effect.gen(function* () {
    if (status.upstream === undefined || status.upstream.behind === 0) return undefined
    const args = ["merge", "--no-edit", "--no-verify", "@{upstream}"]
    const exit = yield* runGit(proc, repoRoot, "reconcile", args)
    if (exit.code === 0) return undefined
    const refused = conflicted(status, yield* conflictedPaths(proc, repoRoot))
    if (refused === undefined) return yield* Effect.fail(gitFailed("reconcile", args, exit))
    yield* git(proc, repoRoot, "abort merge", ["merge", "--abort"])
    return refused
  })

/** The port carries the contract. Refused, then predicted, then merged — in that order. */
const reconcile = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<SyncRefusal | undefined, GitFailed> =>
  Effect.gen(function* () {
    const [status, dirty] = yield* statusAndDirt(proc, repoRoot)
    const refused =
      reconcileRefusal(status, dirty) ?? (yield* upstreamConflict(proc, repoRoot, status))
    if (refused !== undefined) return refused
    return yield* mergeUpstream(proc, repoRoot, status)
  })

/**
 * Set every uncommitted change aside — untracked files too, since `dirtyLines` counts
 * them and a tree still holding one is still dirty — and answer the entry's commit.
 *
 * **The entry is found by its message, never taken off the top.** The stash stack is
 * the repository's, shared with every trak's worktree, so an agent can push between
 * this push and the read. Nothing when git found nothing to save.
 */
const stashAll = (
  proc: ProcessShape,
  repoRoot: string,
  press: StashedPress,
): Effect.Effect<string | undefined, GitFailed> =>
  Effect.gen(function* () {
    const message = `orkestra: set aside before ${press} ${String(yield* Clock.currentTimeMillis)}`
    yield* git(proc, repoRoot, "stash", [
      "stash",
      "push",
      "--include-untracked",
      "--message",
      message,
    ])
    const list = yield* git(proc, repoRoot, "read stashes", ["stash", "list", "--format=%H%x09%gs"])
    return stashNamed(list, message)
  })

/**
 * The paths putting `stash` back onto `HEAD` would conflict in.
 *
 * Two questions, because a stash holds its untracked files in a third parent that the
 * merge of its tree never sees: the tracked changes are a merge of the stash commit
 * into `HEAD`, whose base git finds for itself — the stash's first parent is the tip it
 * was made on, which `HEAD` descends from — and an untracked file conflicts where
 * `HEAD` now holds its path.
 */
const restoreConflicts = (
  proc: ProcessShape,
  repoRoot: string,
  stash: string,
): Effect.Effect<readonly string[], GitFailed> =>
  Effect.gen(function* () {
    const tracked = yield* mergeConflicts(proc, repoRoot, "HEAD", stash)
    const verify = ["rev-parse", "--verify", "--quiet", `${stash}^3`]
    if (!(yield* gitAnswers(proc, repoRoot, "read stash", verify))) return tracked
    const untracked = listed(
      yield* git(proc, repoRoot, "read stash", ["ls-tree", "-r", "--name-only", `${stash}^3`]),
    )
    if (untracked.length === 0) return tracked
    const taken = yield* git(proc, repoRoot, "read tip", [
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
      "--",
      ...untracked,
    ])
    return [...tracked, ...listed(taken)]
  })

/**
 * Put `stash` back and drop its entry. **Applied by commit and never popped**, for
 * `stashAll`'s reason: the top of the stack may be somebody else's by now. The entry is
 * looked up again before the drop, since its position can have moved as well.
 */
const restore = (
  proc: ProcessShape,
  repoRoot: string,
  stash: string,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    yield* git(proc, repoRoot, "restore stash", ["stash", "apply", stash])
    const entries = listed(
      yield* git(proc, repoRoot, "read stashes", ["stash", "list", "--format=%H"]),
    )
    const at = entries.indexOf(stash)
    if (at === -1) return
    yield* git(proc, repoRoot, "drop stash", ["stash", "drop", `stash@{${String(at)}}`])
  })

/**
 * The port carries the contract. **A conflict is asked about before anything is
 * stashed, and a restore before anything is applied** — a conflicted `git stash apply`
 * leaves markers in the tree and the untracked files restored beside them, which is
 * neither the tree as it was nor the changes safely in the stash.
 *
 * A press that fails or is refused after the stash was made has moved nothing, so the
 * changes go straight back. A failure of that restore is dropped in favour of the
 * press's own: the entry is still in the stash, and the press is what a person asked
 * about.
 */
const stashAnd = (
  proc: ProcessShape,
  repoRoot: string,
  press: StashedPress,
): Effect.Effect<StashedSync, GitFailed> =>
  Effect.gen(function* () {
    const status = yield* hostStatus(proc, repoRoot)
    const refused =
      press === "pull"
        ? pullRefusal(status, [])
        : (reconcileRefusal(status, []) ?? (yield* upstreamConflict(proc, repoRoot, status)))
    if (refused !== undefined) return StashedSync.Refused({ refusal: refused })
    if (status.upstream === undefined || status.upstream.behind === 0) return StashedSync.Restored()
    const run =
      press === "pull" ? fastForward(proc, repoRoot, status) : mergeUpstream(proc, repoRoot, status)
    const dirty = yield* dirtyLines(proc, repoRoot)
    const stash = dirty.length === 0 ? undefined : yield* stashAll(proc, repoRoot, press)
    if (stash === undefined) {
      const stopped = yield* run
      return stopped === undefined
        ? StashedSync.Restored()
        : StashedSync.Refused({ refusal: stopped })
    }
    const stopped = yield* run.pipe(
      Effect.tapError(() => Effect.ignore(restore(proc, repoRoot, stash))),
    )
    if (stopped !== undefined) {
      yield* restore(proc, repoRoot, stash)
      return StashedSync.Refused({ refusal: stopped })
    }
    const [first, ...rest] = yield* restoreConflicts(proc, repoRoot, stash)
    if (first !== undefined) return StashedSync.Kept({ files: [first, ...rest] })
    yield* restore(proc, repoRoot, stash)
    return StashedSync.Restored()
  })

/**
 * The port carries the contract. A branch with an upstream is pushed to exactly that —
 * its remote and its remote branch, read off the configuration — rather than to
 * whatever `push.default` would pick, which refuses outright where the two names differ.
 * Full refs on both sides, so a tag sharing the branch's name cannot be what is sent.
 */
const push = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<SyncRefusal | undefined, GitFailed> =>
  Effect.gen(function* () {
    const status = yield* hostStatus(proc, repoRoot)
    const refused = pushRefusal(status)
    if (refused !== undefined) return refused
    if (status.head._tag === "Detached") return SyncRefusal.Detached()
    const branch = status.head.name
    const local = `refs/heads/${branch}`
    if (status.upstream === undefined) {
      const args = ["push", "--set-upstream", "origin", `${local}:${local}`]
      yield* gitRemote(proc, repoRoot, "publish branch", args)
      return undefined
    }
    if (status.upstream.ahead === 0) return undefined
    const remote = yield* git(proc, repoRoot, "read upstream", [
      "config",
      `branch.${branch}.remote`,
    ])
    const tracked = yield* git(proc, repoRoot, "read upstream", [
      "config",
      `branch.${branch}.merge`,
    ])
    yield* gitRemote(proc, repoRoot, "push", ["push", remote, `${local}:${tracked}`])
    return undefined
  })

/**
 * A `-z` listing, untrimmed: `git` trims, and a name may begin or end with a space.
 */
const nulListing = (
  proc: ProcessShape,
  cwd: string,
  op: string,
  args: readonly string[],
): Effect.Effect<string, GitFailed> =>
  runGit(proc, cwd, op, args).pipe(
    Effect.flatMap((exit) =>
      exit.code === 0 ? Effect.succeed(exit.out) : Effect.fail(gitFailed(op, args, exit)),
    ),
  )

/**
 * Every file git sees in the project checkout, tracked or untracked-and-not-ignored, less
 * the tracked ones deleted on disk. Two listings rather than one, because no single
 * `ls-files` mode answers *on disk now* for both kinds.
 */
const projectFiles = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<ProjectFiles, GitFailed> =>
  Effect.gen(function* () {
    const [seen, deleted] = yield* Effect.all(
      [
        nulListing(proc, repoRoot, "list project files", [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ]),
        nulListing(proc, repoRoot, "list deleted files", ["ls-files", "--deleted", "-z"]),
      ],
      { concurrency: "unbounded" },
    )
    return { root: repoRoot, paths: filesListed(seen, deleted) }
  })

/**
 * `git grep` over the working tree, untracked files included and ignored ones not.
 *
 * `-e` and the closing `--` are what keep a search for `-n` from being read as a flag.
 *
 * **It reads rows off the process and stops at `limit + 1` matches**, rather than through
 * `runGit`, which collects the whole output first: a two-letter query on a large checkout
 * is over a hundred thousand lines, and the palette asks it again on every poll. The extra
 * row is what says the answer was cut. Closing the scope kills the process group, so a
 * search stopped at the cap ends `git` there, and that stop is a success. Read to its end,
 * **exit 1 is git's documented *no match*** and an empty answer; anything else non-zero is
 * git failing to search.
 *
 * **`--threads=1`, because the cap is worth nothing without it.** A threaded `git grep`
 * holds each file's matches until that file is done, and under `-i` that took over six
 * seconds over one 4 MB file before the first row arrived. One thread writes each match as
 * it finds it, so the cap ends the process at once.
 */
const grepProject = (
  proc: ProcessShape,
  repoRoot: string,
  text: string,
  limit: number,
): Effect.Effect<ProjectGrep, GitFailed> => {
  const op = "search project"
  const args = [
    "grep",
    "--threads=1",
    "-n",
    "-I",
    "-F",
    "-i",
    "--untracked",
    "-z",
    "-e",
    text,
    "--",
  ]
  return Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "git",
      args,
      cwd: repoRoot,
      env: {},
      stdin: undefined,
      holdStdin: false,
    })
    const rows = yield* spawned.lines.pipe(
      Stream.filterMap((row) => Option.fromNullable(grepRow(row))),
      Stream.take(limit + 1),
      Stream.runCollect,
    )
    const matches = [...rows]
    if (matches.length > limit) return { matches: matches.slice(0, limit), cut: true }
    const exited = yield* spawned.exited
    if (exited.code === 0) return { matches, cut: false }
    if (exited.code === 1) return { matches: [], cut: false }
    const exit: GitExit = {
      code: exited.code,
      signal: exited.signal,
      stderr: exited.stderr,
      out: "",
    }
    return yield* Effect.fail(gitFailed(op, args, exit))
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )
}

/**
 * Whether this process has already seen a git new enough. The binary does not
 * change under a running engine, so asking once is enough — and a layer is built
 * per flow test, so asking per layer was a spawn per test. Only a pass is kept: a
 * git too old is asked again, and refused again, every time.
 */
let versionConfirmed = false

// ---------------------------------------------------------------------------
// Checkouts in a sandbox
// ---------------------------------------------------------------------------
//
// Under a runner every trak's checkout is in its sandbox, at the path this machine would
// give it, and this machine holds no checkout there and no worktree record for one. Its
// copy of `trak/<id>`, with the recorded base and fork, is what every ref read here
// answers from — so `branchChanges`, `wouldConflict`, `contains` and a merge into the
// project are the host's functions unchanged, once a fetch has brought the commits.
// A git command whose `cwd` is the checkout runs in the sandbox without anything here
// saying so: the Process layer routes it by the directory.

/**
 * The sandboxes, while `trak`'s checkout is in one — or, for a call about no trak, while
 * this project's checkouts are — and `undefined` otherwise. A trak placed on this machine
 * (`ports/host-traks.ts`) answers `undefined` under a runner.
 */
const sandboxesNow = (
  held: Option.Option<SandboxesShape>,
  trak: string | undefined,
): Effect.Effect<SandboxesShape | undefined> =>
  Option.match(held, {
    onNone: () => Effect.succeed(undefined),
    onSome: (sandboxes) =>
      Effect.map(trak === undefined ? sandboxes.inUse : sandboxes.holds(trak), (inUse) =>
        inUse ? sandboxes : undefined,
      ),
  })

/** What `whereFor` answers with: the two sides of one call about `trak`, chosen per call. */
type Where = <A>(
  trak: string | undefined,
  onHost: () => Effect.Effect<A, GitFailed>,
  inSandbox: (sandboxes: SandboxesShape) => Effect.Effect<A, GitFailed>,
) => Effect.Effect<A, GitFailed>

/** `onHost` where `trak`'s checkout is on this machine, and `inSandbox` where it is in one — asked on every call. */
const whereFor =
  (held: Option.Option<SandboxesShape>): Where =>
  (trak, onHost, inSandbox) =>
    Effect.flatMap(sandboxesNow(held, trak), (sandboxes) =>
      sandboxes === undefined ? onHost() : inSandbox(sandboxes),
    )

/**
 * This machine's copy of the trak's branch, out of its sandbox. Forced, because this
 * copy is a mirror: the sandbox's branch is the trak's, and an agent that amended a
 * commit there has moved it in a way no fast-forward can follow.
 */
const fetchFromSandbox = (
  sandboxes: SandboxesShape,
  repoRoot: string,
  trakId: string,
): Effect.Effect<void, GitFailed> => {
  const ref = `refs/heads/${branchFor(trakId)}`
  return sandboxes.transfer(
    trakId,
    "fetch trak branch",
    repoRoot,
    worktreePathFor(repoRoot, trakId),
    (remote) => [
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      remote,
      `+${ref}:${ref}`,
    ],
  )
}

// seed: begin
/**
 * This machine's copy of `branch`, into the repository in `trakId`'s sandbox under the
 * same name. Forced for `fetchFromSandbox`'s reason: there it is a copy, and nothing but
 * this push writes it. Never the sandbox's own branch, which is checked out there.
 */
const pushToSandbox = (
  sandboxes: SandboxesShape,
  repoRoot: string,
  trakId: string,
  branch: BranchName,
  op: string,
): Effect.Effect<void, GitFailed> => {
  const ref = `refs/heads/${branch}`
  return sandboxes.transfer(trakId, op, repoRoot, worktreePathFor(repoRoot, trakId), (remote) => [
    "push",
    "--quiet",
    "--no-verify",
    remote,
    `+${ref}:${ref}`,
  ])
}
// seed: end

/**
 * This machine's `trak/<id>` and its records, made where there is no branch, and the
 * base the trak works against. The rules are `createWorktree`'s: a recorded base is
 * kept whatever `from` says, a branch with none is adopted as `adoptedStart` reads it,
 * and the fork is written once.
 */
const hostCopyOf = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
  from: BranchName | undefined,
): Effect.Effect<CommitSha, GitFailed> =>
  Effect.gen(function* () {
    const tip = yield* branchTip(proc, repoRoot, branch)
    if (tip !== undefined) {
      const recorded = yield* recordedBase(proc, repoRoot, branch)
      if (recorded !== undefined) return recorded
    }
    const { base, forked } =
      tip === undefined
        ? yield* freshStart(proc, repoRoot, from)
        : yield* adoptedStart(proc, repoRoot, branch, from)
    if (tip === undefined) {
      yield* git(proc, repoRoot, "create trak branch", ["branch", "--no-track", branch, base])
    }
    yield* git(proc, repoRoot, "record base", ["update-ref", baseRefFor(branch), base])
    if (forked !== undefined) {
      yield* git(proc, repoRoot, "record fork", ["symbolic-ref", forkRefFor(branch), forked])
    }
    return base
  })

// seed: begin
// What a new sandbox is seeded with. A change anywhere between these markers moves
// the seed version a host's runner keeps, so every sandbox made before it is made again.

/**
 * The seed in the sandbox: every step but the push, in one `sh -c`, because each runner
 * exec costs seconds while a new sandbox's disk is still loading and the steps move almost
 * nothing. Its arguments are the steps in order, each a word and its fields, carrying what
 * this machine read for it.
 *
 * - `init` — `git init`, harmless over a repository.
 * - `identity <key> <value>` — the commit identity this repository uses, where otherwise
 *   only the provider's image says who commits, and an image that says nobody refuses
 *   every commit.
 * - `exclude <text>` — this machine's `info/exclude` lines the sandbox's lacks, appended in
 *   this machine's order and matched on whole trimmed lines; blank lines are not entries.
 *   A path a project ignores only there — `.orkestra/.trak/` above all, which
 *   `ensureIgnored` writes nowhere else — is otherwise untracked in the sandbox, and the
 *   step commit's `add -A` takes it.
 * - `remote <name> <url>` — added, or its URL set where the sandbox has the remote.
 *   `open-pr` pushes to `origin` from the sandbox and fails on a clone with no such remote.
 * - `helper <key> <value>` and `push-url <ssh> <pattern>` — `GITHUB_HELPER`, and each of
 *   `GITHUB_SSH` pushed over HTTPS. Each write replaces rather than appends, so a second
 *   seed leaves one of each.
 * - `held <branch>` — prints `unheld` where the sandbox holds no such branch, and the seed
 *   push follows this exec. Never over commits made there.
 * - `checkout <branch>` — the branch checked out where `HEAD` names no commit yet, so a
 *   sandbox whose agent moved `HEAD` is left for `confirmOnItsBranch` to refuse. Skipped
 *   after `unheld`: it is the exec after the push.
 * - `fetch <git args…>` — last, taking the rest: the seed fetch, run only after `unheld`.
 *   Never a failure: its exit and stderr follow a `fetch-failed` line.
 *
 * A step that fails prints `failed <op>` and git's own account, and exits 1. `GH_TOKEN` is a
 * credential of this exec, handed on to the fetch alone, and nothing may prompt there.
 * `rev-parse --verify --quiet` documents a non-zero exit for a name that resolves to
 * nothing, and an unborn `HEAD` exits 1 — measured, and pinned by the contract tier.
 */
const SEED_SCRIPT = `nl='
'
unheld=
tok=\${GH_TOKEN-}
unset GH_TOKEN
fail() {
  printf 'failed %s\\n%s\\n' "$1" "$2"
  exit 1
}
run() {
  o=$1
  shift
  e=$(git "$@" 2>&1 >/dev/null) && return 0
  fail "$o" "git $* exited $?: $e"
}
ask() {
  o=$1
  shift
  e=$(git "$@" 2>&1 >/dev/null)
  c=$?
  [ "$c" -le 1 ] && return "$c"
  fail "$o" "git $* exited $c: $e"
}
trim() {
  t=\${1#"\${1%%[![:space:]]*}"}
  t=\${t%"\${t##*[![:space:]]}"}
}
exclude() {
  f=.git/info/exclude
  have=$nl
  gap=
  if [ -f "$f" ]; then
    while IFS= read -r l || [ -n "$l" ]; do
      trim "$l"
      have=$have$t$nl
    done <"$f"
    [ -z "$(tail -c 1 "$f")" ] || gap=$nl
  fi
  add=
  while IFS= read -r l; do
    trim "$l"
    [ -n "$t" ] || continue
    case $have in *"$nl$t$nl"*) continue ;; esac
    add=$add$t$nl
  done <<EOF
$1
EOF
  [ -n "$add" ] || return 0
  { mkdir -p .git/info && { cat "$f" 2>/dev/null; printf '%s%s' "$gap" "$add"; } >"$f.tmp" && mv -f "$f.tmp" "$f"; } ||
    fail "copy info/exclude" "could not write $f"
}
while [ $# -gt 0 ]; do
  s=$1
  shift
  case $s in
  init) run "start sandbox checkout" init --quiet ;;
  identity)
    run "set git identity" config "$1" "$2"
    shift 2
    ;;
  exclude)
    exclude "$1"
    shift
    ;;
  remote)
    if ask "read sandbox remote" config --get "remote.$1.url"; then v=set-url; else v=add; fi
    run "set sandbox remote" remote "$v" "$1" "$2"
    shift 2
    ;;
  helper)
    run "set sandbox credential helper" config "$1" "$2"
    shift 2
    ;;
  push-url)
    run "set sandbox push URL" config --replace-all url.https://github.com/.pushInsteadOf "$1" "$2"
    shift 2
    ;;
  held)
    ask "read sandbox branch" show-ref --verify --quiet "refs/heads/$1" || {
      unheld=1
      echo unheld
    }
    shift
    ;;
  checkout)
    [ -n "$unheld" ] || ask "read sandbox head" rev-parse --verify --quiet HEAD ||
      run "check out trak branch" checkout --quiet "$1"
    shift
    ;;
  fetch)
    [ -z "$unheld" ] ||
      e=$(GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes' env \${tok:+"GH_TOKEN=$tok"} git "$@" 2>&1 >/dev/null) ||
      printf 'fetch-failed %s\\n%s\\n' "$?" "$e"
    break
    ;;
  *) fail "seed sandbox" "no step named $s" ;;
  esac
done
exit 0`

/** What a seed exec printed: whether the push has to follow it, and a seed fetch that failed. */
interface SeedSaid {
  readonly unheld: boolean
  readonly fetchFailed: { readonly code: string; readonly stderr: string } | undefined
}

/** `SEED_SCRIPT`'s lines read back: a step's failure under its own op, and `op`'s where the exec failed with none. */
const seedSaidOf = (
  op: string,
  lines: readonly string[],
  exited: Exited,
): Effect.Effect<SeedSaid, GitFailed> => {
  let unheld = false
  let fetchFailed: SeedSaid["fetchFailed"] = undefined
  for (const [at, line] of lines.entries()) {
    const rest = lines
      .slice(at + 1)
      .join("\n")
      .trim()
    if (line.startsWith("failed ")) {
      return Effect.fail(new GitFailed({ op: line.slice("failed ".length), reason: rest }))
    }
    if (line === "unheld") unheld = true
    if (line.startsWith("fetch-failed ")) {
      fetchFailed = { code: line.slice("fetch-failed ".length), stderr: rest }
      break
    }
  }
  if (exited.code !== 0) {
    const said = `exited ${exited.code ?? exited.signal ?? "?"}: ${exited.stderr.trim()}`
    return Effect.fail(new GitFailed({ op, reason: said }))
  }
  return Effect.succeed({ unheld, fetchFailed })
}

/** One exec of `SEED_SCRIPT` over `steps` in the sandbox's checkout, failing under `op` where it could not run. */
const seedIn = (
  proc: ProcessShape,
  path: string,
  op: string,
  steps: readonly string[],
  credentials: readonly string[] = [],
): Effect.Effect<SeedSaid, GitFailed> =>
  Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "sh",
      args: ["-c", SEED_SCRIPT, "sh", ...steps],
      cwd: path,
      env: {},
      credentials,
      stdin: undefined,
      holdStdin: false,
    })
    const lines = [...(yield* Stream.runCollect(spawned.lines))]
    return yield* seedSaidOf(op, lines, yield* spawned.exited)
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )

/** The `identity` steps: each key this repository sets, as this machine reads it. */
const identitySteps = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<readonly string[], GitFailed> =>
  Effect.map(
    Effect.forEach(["user.name", "user.email"], (key) =>
      Effect.gen(function* () {
        // `config --get` documents exit 1 as the key not being set.
        const args = ["config", "--get", key]
        const exit = yield* runGit(proc, repoRoot, "read git identity", args)
        if (exit.code === 1) return []
        if (exit.code !== 0) return yield* Effect.fail(gitFailed("read git identity", args, exit))
        return ["identity", key, exit.out.trim()]
      }),
    ),
    (each) => each.flat(),
  )

/** The `exclude` step: this machine's `info/exclude`, or nothing where it has none. */
const excludeStep = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<readonly string[], GitFailed> =>
  Effect.gen(function* () {
    const from = yield* excludePathOf(proc, repoRoot)
    const host = yield* Effect.try({
      try: () => (existsSync(from) ? readFileSync(from, "utf8") : ""),
      catch: (cause) =>
        new GitFailed({
          op: "read info/exclude",
          reason: `could not read ${from}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
    return ["exclude", host]
  })

/**
 * The `remote` steps — this machine's remotes, with no credential in a URL — then the
 * `helper` and `push-url` steps beside them.
 */
const remoteSteps = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<readonly string[], GitFailed> =>
  Effect.gen(function* () {
    // `config --get-regexp` documents exit 1 as nothing matching: a project with no remote.
    const args = ["config", "--get-regexp", "^remote\\..*\\.url$"]
    const exit = yield* runGit(proc, repoRoot, "read remotes", args)
    if (exit.code !== 0 && exit.code !== 1) {
      return yield* Effect.fail(gitFailed("read remotes", args, exit))
    }
    const remotes = remotesIn(exit.code === 0 ? exit.out.trim() : "")
    return [
      ...remotes.flatMap(({ name, url }) => ["remote", name, withoutCredentials(url)]),
      "helper",
      ...GITHUB_HELPER,
      ...GITHUB_SSH.flatMap(([ssh, only]) => ["push-url", ssh, only]),
    ]
  })

/**
 * The arguments of the seed fetch: `origin`'s `branch` into `to` — under
 * `refs/orkestra/seed/` where the seed push's negotiation reads it, and no agent's branch
 * listing shows it, or the branch itself where `origin` is the record. GitHub's SSH
 * spellings are read as HTTPS for this one command, because `GH_TOKEN` authenticates only
 * HTTPS and the sandbox holds no SSH key.
 */
const seedFetchArgs = (
  branch: BranchName,
  to: string = `refs/orkestra/seed/${branch}`,
): readonly string[] => [
  ...GITHUB_SSH.flatMap(([ssh]) => ["-c", `url.https://github.com/.insteadOf=${ssh}`]),
  "fetch",
  "--quiet",
  "--no-tags",
  "--no-write-fetch-head",
  "origin",
  `+refs/heads/${branch}:${to}`,
]

/**
 * Why the seed push sends the whole history, where it does: no default branch to fetch,
 * one this machine could not read, or a fetch that failed. Each is logged and the seed goes
 * on, because the push is correct without the fetch and only slower.
 */
const seedFetchLogged = (
  trakId: string,
  named: Either.Either<BranchName | undefined, GitFailed>,
  failed: SeedSaid["fetchFailed"],
): Effect.Effect<void> =>
  Either.match(named, {
    onLeft: (e) =>
      Effect.logWarning(`seed ${trakId}: ${e.message}, so the seed push sends the whole history`),
    onRight: (branch) => {
      if (branch === undefined) {
        return Effect.logInfo(
          `seed ${trakId}: origin names no default branch, so the seed push sends the whole history`,
        )
      }
      if (failed === undefined) return Effect.void
      return Effect.logWarning(
        `seed ${trakId}: fetching ${branch} from origin exited ${failed.code}, so the seed push sends the whole history: ${failed.stderr}`,
      )
    },
  })

/**
 * The seed where `origin` is the record: `trak/<id>` fetched from `origin` inside the seed
 * exec, where the sandbox does not hold it, then checked out by a second. **Nothing is
 * pushed into the sandbox**, and nothing reads this machine's copy: a trak's commits reach
 * `origin` before the log names them, so `origin` holds every one a new sandbox starts
 * from. Where `origin` lacks the branch — a new trak, its branch at its recorded base —
 * this machine pushes it there first. A fetch that fails fails the seed, since it is the
 * only way the branch arrives.
 */
const seedFromOrigin = (
  proc: ProcessShape,
  repoRoot: string,
  trakId: string,
  steps: readonly string[],
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const path = worktreePathFor(repoRoot, trakId)
    const branch = branchFor(trakId)
    if (!(yield* originHolds(proc, repoRoot, branch))) {
      yield* pushTrak(proc, repoRoot, trakId, [])
    }
    const said = yield* seedIn(
      proc,
      path,
      "start sandbox checkout",
      [...steps, "fetch", ...seedFetchArgs(branch, `refs/heads/${branch}`)],
      ["GH_TOKEN"],
    )
    if (!said.unheld) return
    if (said.fetchFailed !== undefined) {
      return yield* Effect.fail(
        new GitFailed({
          op: "fetch trak branch from origin",
          reason: `fetching ${branch} from origin into the sandbox exited ${said.fetchFailed.code}: ${said.fetchFailed.stderr}`,
        }),
      )
    }
    yield* seedIn(proc, path, "read sandbox head", ["checkout", branch])
  })

/**
 * The repository in the sandbox, at the checkout's path, standing on `trak/<id>` as this
 * machine holds it — or as it already stands there. One exec of `SEED_SCRIPT` where the
 * sandbox holds the branch; where it does not, that exec fetches the default branch from
 * `origin`, so the seed push sends only what the remote lacks — the sandbox and the forge
 * are in data centers and the engine host may be on a home network — and a second checks
 * the branch out after the push. Where `origin` is the record, `seedFromOrigin` instead.
 *
 * **Each step asks before it acts**, so a create cut off halfway, and every later
 * `SetupWorktree`, end at the same checkout.
 */
const seedSandbox = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  trakId: string,
  record: RecordedOn,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const path = worktreePathFor(repoRoot, trakId)
    const branch = branchFor(trakId)
    yield* sandboxes.create(trakId, path)
    const steps = [
      "init",
      ...(yield* identitySteps(proc, repoRoot)),
      ...(yield* excludeStep(proc, repoRoot)),
      ...(yield* remoteSteps(proc, repoRoot)),
      "held",
      branch,
      "checkout",
      branch,
    ]
    if (record === "origin") return yield* seedFromOrigin(proc, repoRoot, trakId, steps)
    const named = yield* Effect.either(defaultBranch(proc, repoRoot))
    const fetch =
      Either.isRight(named) && named.right !== undefined ? seedFetchArgs(named.right) : []
    const said = yield* seedIn(
      proc,
      path,
      "start sandbox checkout",
      fetch.length === 0 ? steps : [...steps, "fetch", ...fetch],
      fetch.length === 0 ? [] : ["GH_TOKEN"],
    )
    if (!said.unheld) return
    yield* seedFetchLogged(trakId, named, said.fetchFailed)
    yield* pushToSandbox(sandboxes, repoRoot, trakId, branch, "seed sandbox")
    yield* seedIn(proc, path, "read sandbox head", ["checkout", branch])
  })
// seed: end

/**
 * `createWorktree` under a runner: `runner.sh create` where `worktree add` runs, then
 * the seed. This machine's branch comes first, because it is what the seed pushes — into
 * the sandbox, or to `origin` where `origin` is the record and lacks it. Without a store
 * file, where it outlived a sandbox that was lost, the new sandbox starts from its commits;
 * under one, from `origin`'s.
 *
 * **Named as the preparation it is**, from the `status` asked first: a sandbox made from
 * the tools template where the runner holds none, one started again where it is stopped,
 * then the seed once `create` answers. One already running is a checkout already seeded,
 * whose seed asks and skips, so it is named nothing.
 */
const createSandboxed = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  trakId: string,
  from: BranchName | undefined,
  during: During,
  record: RecordedOn,
): Effect.Effect<Worktree, GitFailed> =>
  Effect.gen(function* () {
    const base = yield* hostCopyOf(proc, repoRoot, branchFor(trakId), from)
    const state = yield* sandboxes.status(trakId)
    if (state === "running") yield* seedSandbox(proc, repoRoot, sandboxes, trakId, record)
    else {
      const phase = state === "absent" ? PreparingPhase.Creating() : PreparingPhase.Resuming()
      yield* during(trakId, phase, (move) =>
        seedSandbox(
          proc,
          repoRoot,
          {
            ...sandboxes,
            create: (trak, path) =>
              Effect.zipRight(sandboxes.create(trak, path), move(PreparingPhase.Seeding())),
          },
          trakId,
          record,
        ),
      )
    }
    return worktreeFor(repoRoot, trakId, base)
  })

/** `Vcs.createWorktree`: a checkout on this machine, or a sandbox under a runner. */
const createWith =
  (where: Where, during: During, proc: ProcessShape, repoRoot: string, record: RecordedOn) =>
  (trakId: string, from: BranchName | undefined): Effect.Effect<Worktree, GitFailed> =>
    where(
      trakId,
      () =>
        during(trakId, PreparingPhase.Checkout(), () =>
          createWorktree(proc, repoRoot, trakId, from),
        ),
      (sandboxes) => createSandboxed(proc, repoRoot, sandboxes, trakId, from, during, record),
    )

/** Whether the trak has a sandbox now, running or stopped — `status` in place of `worktree list`. */
const hasSandbox = (sandboxes: SandboxesShape, trakId: string): Effect.Effect<boolean, GitFailed> =>
  Effect.map(sandboxes.status(trakId), (state) => state !== "absent")

/**
 * `carryOut` in the sandbox: the checkout's files as a commit over `HEAD`, written to the
 * ref `$1`, through a scratch index so the checkout's own is left as it was — the same
 * `add -A` `commitWork` stages, so what git ignores is left out. The identity is this
 * machine's, handed in by `identityEnv` as `commitWork`'s is there.
 */
const CARRY_OUT_SCRIPT = `set -e
s=$(mktemp)
trap 'rm -f "$s"' EXIT
rm -f "$s"
export GIT_INDEX_FILE="$s"
git read-tree HEAD
git add -A .
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p HEAD -m "$2")
git update-ref "$1" "$commit"`

/**
 * `carryIn` in the sandbox: what the commit at `$1` changed over its parent, applied to
 * the checkout as uncommitted changes, then the ref deleted. `git apply` writes nothing
 * where any part fails, and the ref is kept then.
 */
const CARRY_IN_SCRIPT = `set -e
if ! git diff --quiet "$1^" "$1"; then
  git diff --binary "$1^" "$1" | git apply --whitespace=nowarn
fi
git update-ref -d "$1"`

/** One `sh -c` script in a checkout, failing under `op` with what it printed where it exits non-zero. */
const scriptIn = (
  proc: ProcessShape,
  cwd: string,
  op: string,
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "sh",
      args: ["-c", script, "sh", ...args],
      cwd,
      env,
      stdin: undefined,
      holdStdin: false,
    })
    const out = [...(yield* Stream.runCollect(spawned.lines))].join("\n").trim()
    const exited = yield* spawned.exited
    if (exited.code === 0) return
    const said = [exited.stderr.trim(), out].filter((part) => part !== "").join("\n")
    return yield* Effect.fail(
      new GitFailed({ op, reason: `exited ${exited.code ?? exited.signal ?? "?"}: ${said}` }),
    )
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )

/**
 * `carryOut` under a runner: the commit in the sandbox, then this machine's copy of its ref.
 * **Refused while the ref is still here**, because then it holds changes an earlier remake
 * could not put back, a ref under `refs/orkestra/` keeps no reflog, and overwriting it
 * would lose them for good. The refusal carries the ref, and a stale remake keeps the
 * sandbox on it.
 */
const carryOutSandboxed = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  trakId: string,
): Effect.Effect<void, GitFailed> => {
  const ref = carriedRefFor(trakId)
  const path = worktreePathFor(repoRoot, trakId)
  const unclaimed = Effect.flatMap(refTip(proc, repoRoot, "read kept changes", ref), (left) =>
    left === undefined
      ? Effect.void
      : Effect.fail(
          new GitFailed({
            op: "keep uncommitted changes",
            reason: leftBehindSaid(ref, repoRoot),
            carried: ref,
          }),
        ),
  )
  return Effect.zipRight(
    unclaimed,
    Effect.zipRight(
      Effect.flatMap(identityEnv(proc, repoRoot), (env) =>
        scriptIn(
          proc,
          path,
          "keep uncommitted changes",
          CARRY_OUT_SCRIPT,
          [ref, `the uncommitted changes of ${trakId}, kept across a remake of its sandbox`],
          env,
        ),
      ),
      sandboxes.transfer(trakId, "fetch uncommitted changes", repoRoot, path, (remote) => [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        remote,
        `+${ref}:${ref}`,
      ]),
    ),
  )
}

/** Why a sandbox is not made again while `ref` holds changes an earlier remake left behind. */
const leftBehindSaid = (ref: string, repoRoot: string) =>
  `the uncommitted changes an earlier remake could not put back are still kept at ${ref} in ${repoRoot}, so the sandbox is not made again until they are applied or the ref is deleted (git update-ref -d ${ref})`

/**
 * `carryIn` under a runner: this machine's copy of the ref into the new sandbox, then the
 * changes applied there. A failure of either says where the changes still are.
 */
const carryInSandboxed = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  trakId: string,
): Effect.Effect<void, GitFailed> => {
  const ref = carriedRefFor(trakId)
  const path = worktreePathFor(repoRoot, trakId)
  const putBack = Effect.zipRight(
    sandboxes.transfer(trakId, "push uncommitted changes", repoRoot, path, (remote) => [
      "push",
      "--quiet",
      "--no-verify",
      remote,
      `+${ref}:${ref}`,
    ]),
    scriptIn(proc, path, "put back uncommitted changes", CARRY_IN_SCRIPT, [ref]),
  ).pipe(
    Effect.mapError(
      (e) =>
        new GitFailed({
          op: e.op,
          reason: `the uncommitted changes carried across the remake of ${trakId}'s sandbox did not apply, and are kept at ${ref} in ${repoRoot}: ${e.reason}`,
          carried: ref,
        }),
    ),
  )
  // Gone here once they are back, so the ref being here always means *left behind*. Past
  // the mapping above, because by now the changes are in the checkout: a delete that fails
  // is a warning, not changes left behind — the ref it leaves only holds a later remake
  // back until a person deletes it.
  const forget = git(proc, repoRoot, "forget kept changes", ["update-ref", "-d", ref]).pipe(
    Effect.catchTag("GitFailed", (e) =>
      Effect.logWarning(
        `${trakId}: the uncommitted changes are back in the sandbox, but ${ref} could not be deleted in ${repoRoot}, so the sandbox is not made again until it is (git update-ref -d ${ref}): ${e.reason}`,
      ),
    ),
  )
  return Effect.zipRight(putBack, forget)
}

/** `carryOut` and `carryIn` with no runner: a checkout on this machine is never made again. */
const noSandbox = (op: string, trakId: string) =>
  Effect.fail(
    new GitFailed({ op, reason: `${trakId} has no sandbox, so there is nothing to carry across` }),
  )

const carryWith = (
  where: Where,
  proc: ProcessShape,
  repoRoot: string,
  record: RecordedOn,
): Pick<VcsShape, "carryOut" | "carryIn" | "leftBehind" | "carryTarget"> => ({
  leftBehind: (trakId) =>
    refTip(proc, repoRoot, "read kept changes", carriedRefFor(trakId)).pipe(
      Effect.map((tip) => (tip === undefined ? undefined : carriedRefFor(trakId))),
    ),
  carryOut: (trakId) =>
    where(
      trakId,
      () => noSandbox("keep uncommitted changes", trakId),
      (sandboxes) => carryOutSandboxed(proc, repoRoot, sandboxes, trakId),
    ),
  carryIn: (trakId) =>
    where(
      trakId,
      () => noSandbox("put back uncommitted changes", trakId),
      (sandboxes) => carryInSandboxed(proc, repoRoot, sandboxes, trakId),
    ),
  // A checkout on this machine shares this repository's refs, so the target is already there.
  carryTarget: (trakId, target) =>
    where(
      trakId,
      () => Effect.void,
      (sandboxes) => carryTargetSandboxed(proc, repoRoot, sandboxes, trakId, target, record),
    ),
})

/**
 * `confirmOnItsBranch` then `stageAndCommit`, as one script: each command is a runner
 * `exec`, and under a provider every one of them is a connection paid for. The order and
 * the judgements are theirs — the branch read before anything is staged, the commit only
 * where the staged status prints anything. Exit 3 with the branch `HEAD` reads on stdout
 * is the checkout off its branch; git exits 1 or 128 and never 3.
 *
 * **Each read is an assignment of its own**, because `set -e` stops the script only
 * there: a substitution inside `[ … ]` that fails reads as empty, and an empty status
 * would skip the commit and exit 0 — a step's work read as none.
 */
const COMMIT_SCRIPT = `set -e
head=$(git rev-parse --abbrev-ref HEAD)
if [ "$head" != "$1" ]; then printf '%s' "$head"; exit 3; fi
git add -A
pending=$(git status --porcelain)
if [ -n "$pending" ]; then git commit --quiet --no-verify -m "$2"; fi`

/**
 * The commit identity this machine has now, as the environment git reads it from. Asked
 * on every commit rather than trusting the seed's `identity` steps: those run once, at the seed, and a
 * sandbox seeded while this machine had no identity refuses every commit after with
 * `Author identity unknown`. A key this machine has no value for is left to the sandbox.
 */
const identityEnv = (
  proc: ProcessShape,
  repoRoot: string,
): Effect.Effect<Record<string, string>, GitFailed> =>
  Effect.gen(function* () {
    const env: Record<string, string> = {}
    for (const [key, suffix] of [
      ["user.name", "NAME"],
      ["user.email", "EMAIL"],
    ] as const) {
      // `config --get` documents exit 1 as the key not being set.
      const args = ["config", "--get", key]
      const exit = yield* runGit(proc, repoRoot, "read git identity", args)
      if (exit.code === 1) continue
      if (exit.code !== 0) return yield* Effect.fail(gitFailed("read git identity", args, exit))
      env[`GIT_AUTHOR_${suffix}`] = exit.out.trim()
      env[`GIT_COMMITTER_${suffix}`] = exit.out.trim()
    }
    return env
  })

const commitInSandbox = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  message: string,
): Effect.Effect<void, GitFailed> => {
  const op = "commit"
  return Effect.gen(function* () {
    const env = yield* identityEnv(proc, repoRoot)
    const spawned = yield* proc.spawn({
      command: "sh",
      args: ["-c", COMMIT_SCRIPT, "sh", worktree.branch, message],
      cwd: worktree.path,
      env,
      stdin: undefined,
      holdStdin: false,
    })
    const out = [...(yield* Stream.runCollect(spawned.lines))].join("\n").trim()
    const exited = yield* spawned.exited
    if (exited.code === 0) return
    if (exited.code === 3) return yield* Effect.fail(offItsBranch(worktree, out))
    const exit = { code: exited.code, signal: exited.signal, stderr: exited.stderr, out }
    return yield* Effect.fail(gitFailed(op, ["add", "-A", "&&", "commit"], exit))
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )
}

/**
 * `commitWork` under a runner: the commit in the sandbox, then the fetch — from the
 * sandbox, or through `origin` — then the answer off this machine's copy. **A fetch that
 * fails fails the commit**: the answer is read off a copy the fetch did not bring up to
 * date, and a stale copy reads committed work as none — which `removeWorktree` would
 * later delete as an empty branch. A push that fails fails it too, so no event names a
 * commit `origin` does not hold.
 */
const commitSandboxed = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  worktree: Worktree,
  message: string,
  record: RecordedOn,
): Effect.Effect<CommitSha | undefined, GitFailed> =>
  Effect.gen(function* () {
    const trakId = trakOfBranch(worktree.branch)
    if (trakId !== undefined) {
      if (!(yield* hasSandbox(sandboxes, trakId))) {
        return yield* absentAtCommit(proc, repoRoot, sandboxes, worktree, trakId)
      }
      yield* commitInSandbox(proc, repoRoot, worktree, message)
      yield* recordFromSandbox(proc, repoRoot, sandboxes, trakId, record, worktree.path)
    }
    return yield* committed(proc, repoRoot, worktree)
  })

/**
 * A commit whose trak has no sandbox. **It fails, and never reads the answer off this
 * machine's copy**: whatever the sandbox held past that copy is gone, and a stale copy
 * reads lost work as nothing to commit. `lost` first, so the next `awake` asks the runner
 * again — and the work that meets the absent sandbox there is told what it starts from.
 */
const absentAtCommit = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  worktree: Worktree,
  trakId: string,
): Effect.Effect<never, GitFailed> =>
  Effect.gen(function* () {
    yield* sandboxes.lost(trakId)
    const tip = yield* branchTip(proc, repoRoot, worktree.branch)
    return yield* Effect.fail(
      new GitFailed({
        op: "commit work",
        reason: `${trakId} has no sandbox, so whatever it held past this machine's ${worktree.branch} at ${tip ?? "nothing"} is gone and nothing was committed`,
      }),
    )
  })

/**
 * Where a trak's commits are recorded before the log names them: this machine's
 * repository, fetched from the sandbox, or `origin`, pushed to by whichever side holds
 * the checkout and fetched from into the cache checkout. `origin` under an external store
 * only — see `GitCliLayer`.
 */
type RecordedOn = "here" | "origin"

/**
 * The trak's branch out of its sandbox, to where its commits are recorded: fetched here,
 * or pushed to `origin` from the checkout at `checkout` and fetched into the cache. Every
 * fetch out of a sandbox goes through this, so the cache never moves past `origin`.
 */
const recordFromSandbox = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  trakId: string,
  record: RecordedOn,
  checkout: string = worktreePathFor(repoRoot, trakId),
): Effect.Effect<void, GitFailed> =>
  record === "origin"
    ? throughOrigin(proc, repoRoot, checkout, trakId)
    : fetchFromSandbox(sandboxes, repoRoot, trakId)

/**
 * `trak/<id>` pushed to `origin` from the repository at `cwd`, forced: the trak's branch
 * is the trak's own, and an agent that amended a commit has moved it in a way no
 * fast-forward follows. One ref, under the `transfer` rule. `credentials` names the token
 * a sandboxed push signs in with; a push on this machine inherits it.
 */
const pushTrak = (
  proc: ProcessShape,
  cwd: string,
  trakId: string,
  credentials: readonly string[],
): Effect.Effect<void, GitFailed> => {
  const op = "push trak branch to origin"
  const ref = `refs/heads/${branchFor(trakId)}`
  const args = ["push", "--quiet", "--no-verify", "origin", `+${ref}:${ref}`]
  return Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "git",
      args,
      cwd,
      env: NO_PROMPT,
      credentials,
      stdin: undefined,
      holdStdin: false,
    })
    const out = [...(yield* Stream.runCollect(spawned.lines))].join("\n")
    const exited = yield* spawned.exited
    if (exited.code === 0) return
    const exit = { code: exited.code, signal: exited.signal, stderr: exited.stderr, out }
    return yield* Effect.fail(
      new GitFailed({
        op,
        reason: `${gitFailed(op, args, exit).reason}\nNothing names this commit until origin holds it.`,
      }),
    )
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
    Effect.timeoutFail({
      duration: REMOTE_PATIENCE,
      onTimeout: () =>
        new GitFailed({
          op,
          reason: `git ${args.join(" ")} had no answer from origin after ${Duration.format(REMOTE_PATIENCE)}`,
        }),
    }),
  )
}

/** The cache checkout's `trak/<id>`, forced to what `origin` holds — `fetchFromSandbox`'s reason. */
const fetchFromOrigin = (
  proc: ProcessShape,
  repoRoot: string,
  trakId: string,
): Effect.Effect<void, GitFailed> => {
  const ref = `refs/heads/${branchFor(trakId)}`
  return Effect.asVoid(
    gitRemote(proc, repoRoot, "fetch trak branch from origin", [
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "origin",
      `+${ref}:${ref}`,
    ]),
  )
}

/**
 * The sandbox's `trak/<id>` onto `origin`, then into the cache checkout. **Either failing
 * fails the caller**: a commit is recorded only once `origin` holds it, and the answer is
 * read off the cache, which a fetch that failed left short of it.
 */
const throughOrigin = (
  proc: ProcessShape,
  repoRoot: string,
  checkout: string,
  trakId: string,
): Effect.Effect<void, GitFailed> =>
  Effect.zipRight(
    pushTrak(proc, checkout, trakId, ["GH_TOKEN"]),
    fetchFromOrigin(proc, repoRoot, trakId),
  )

/**
 * The cache checkout's `trak/<id>` onto `origin`, for a trak whose checkout is on this
 * machine. Nothing where there is no branch yet: there is nothing to record.
 */
const pushedFromHere = (
  proc: ProcessShape,
  repoRoot: string,
  trakId: string,
): Effect.Effect<void, GitFailed> =>
  Effect.flatMap(branchExists(proc, repoRoot, "read branch", branchFor(trakId)), (held) =>
    held ? pushTrak(proc, repoRoot, trakId, []) : Effect.void,
  )

/**
 * `commitWork` and `fetchWork`: a commit, and a turn's end, each bringing the trak's
 * branch to where its commits are recorded — this machine's repository, or `origin` and
 * then the cache.
 */
const recordWith = (
  where: Where,
  proc: ProcessShape,
  repoRoot: string,
  record: RecordedOn,
): Pick<VcsShape, "commitWork" | "fetchWork"> => ({
  commitWork: (worktree, message) =>
    where(
      trakOfBranch(worktree.branch),
      () => commitHere(proc, repoRoot, worktree, message, record),
      (sandboxes) => commitSandboxed(proc, repoRoot, sandboxes, worktree, message, record),
    ),
  fetchWork: (trakId) =>
    where(
      trakId,
      () => (record === "origin" ? pushedFromHere(proc, repoRoot, trakId) : Effect.void),
      (sandboxes) => recordFromSandbox(proc, repoRoot, sandboxes, trakId, record),
    ),
})

/**
 * `moveOntoBase` in the checkout, as one `sh -c` so a sandboxed checkout pays one exec.
 * Its arguments are the branch, the merged head and the base. Exit 4 is `Unmoved`, exit 5
 * `Refused` with the reason on stdout, and 0 prints the base's tip the branch now stands
 * on. **The push is the last command that can fail**, so a 0 is the only exit once
 * `origin` has changed.
 *
 * - A merged head this checkout lacks — a commit made on the forge — is fetched by its
 *   sha, which a forge keeps serving after it deletes the branch. Still absent refuses.
 * - **Owed is proved, never assumed.** The branch and the merged head share a commit,
 *   and that commit is not in the base: the pull request's own work, which a squash left
 *   out of the base's history. Sharing only a commit the base holds is a branch already
 *   moved, or one whose pull request merged by a merge commit — `Unmoved`. A git that
 *   cannot answer either question refuses.
 * - The lease is on what `origin` held when asked — nothing, where the forge deleted the
 *   branch — and `origin` holding a commit that is neither on the branch nor in the
 *   merged head refuses before anything moves, since the rebase would drop it.
 *
 * `rev-parse`, `merge-base` and `ls-remote` in an assignment, never a pipe: `set -e`
 * sees only the last command of a pipe.
 */
const MOVE_SCRIPT = `set -e
branch=$1 merged=$2 base=$3
present() { git cat-file -e "$1^{commit}" 2>/dev/null; }
head=$(git rev-parse --abbrev-ref HEAD)
if [ "$head" != "$branch" ]; then printf 'the checkout is on %s, not %s' "$head" "$branch"; exit 5; fi
if ! said=$(git fetch --quiet --no-tags origin "+refs/heads/$base:refs/remotes/origin/$base" 2>&1); then
  printf 'could not fetch %s from origin: %s' "$base" "$said"; exit 5
fi
onto=$(git rev-parse "origin/$base")
if ! present "$merged"; then git fetch --quiet --no-tags origin "$merged" >/dev/null 2>&1 || true; fi
if ! present "$merged"; then printf 'the merged head %s is on neither this checkout nor origin' "$merged"; exit 5; fi
set +e
shared=$(git merge-base "$merged" HEAD); met=$?
set -e
if [ $met -eq 1 ]; then exit 4; fi
if [ $met -ne 0 ]; then printf 'git could not say where %s meets %s' "$branch" "$merged"; exit 5; fi
set +e
git merge-base --is-ancestor "$shared" "$onto"; inbase=$?
set -e
if [ $inbase -eq 0 ]; then exit 4; fi
if [ $inbase -ne 1 ]; then printf 'git could not say whether %s is in %s' "$shared" "$base"; exit 5; fi
was=$(git rev-parse HEAD)
held=$(git ls-remote origin "refs/heads/$branch")
held=\${held%%[[:space:]]*}
if [ -n "$held" ] && [ "$held" != "$was" ]; then
  if ! present "$held"; then git fetch --quiet --no-tags origin "$held" >/dev/null 2>&1 || true; fi
  if ! present "$held" || { ! git merge-base --is-ancestor "$held" "$was" && ! git merge-base --is-ancestor "$held" "$merged"; }; then
    printf 'origin holds commits on %s that this checkout does not' "$branch"; exit 5
  fi
fi
if ! said=$(git rebase --no-verify --onto "$onto" "$merged" 2>&1); then
  git rebase --abort >/dev/null 2>&1 || true
  printf '%s' "$said"; exit 5
fi
if ! said=$(git push --quiet --no-verify --force-with-lease="refs/heads/$branch:$held" origin "HEAD:refs/heads/$branch" 2>&1); then
  git reset --quiet --keep "$was"
  printf 'origin refused the push: %s' "$said"; exit 5
fi
printf '%s' "$onto"`

/** `MOVE_SCRIPT` in `worktree`'s checkout — here, or in its sandbox by its `cwd`. */
const moveInCheckout = (
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  merged: CommitSha,
  base: BranchName,
): Effect.Effect<BranchMove, GitFailed> => {
  const op = "move branch onto base"
  return Effect.gen(function* () {
    const env = yield* identityEnv(proc, repoRoot)
    const spawned = yield* proc.spawn({
      command: "sh",
      args: ["-c", MOVE_SCRIPT, "sh", worktree.branch, merged, base],
      cwd: worktree.path,
      env: { ...NO_PROMPT, ...env },
      credentials: ["GH_TOKEN"],
      stdin: undefined,
      holdStdin: false,
    })
    const out = [...(yield* Stream.runCollect(spawned.lines))].join("\n").trim()
    const exited = yield* spawned.exited
    if (exited.code === 0) return BranchMove.Moved({ onto: CommitSha.make(out) })
    if (exited.code === 4) return BranchMove.Unmoved()
    if (exited.code === 5) return BranchMove.Refused({ why: out })
    const exit = { code: exited.code, signal: exited.signal, stderr: exited.stderr, out }
    return yield* Effect.fail(gitFailed(op, ["rebase", "--onto", `origin/${base}`, merged], exit))
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
    Effect.timeoutFail({
      duration: REMOTE_PATIENCE,
      onTimeout: () =>
        new GitFailed({
          op,
          reason: `moving ${worktree.branch} onto origin/${base} had no answer after ${Duration.format(REMOTE_PATIENCE)}`,
        }),
    }),
  )
}

/**
 * `Vcs.moveOntoBase`: the move, then — where it moved — this machine's copy brought level
 * by `fetchWork`, and the recorded base set to the new start, so the next `createWorktree`
 * hands the trak a base its branch holds and its first commit is not read as the old work.
 *
 * **Once the push has landed the answer is `Moved`, whatever follows.** The two steps
 * after it only keep this machine's records, and a failure there is logged rather than
 * returned: a refusal would say the branch is where it was when `origin` says otherwise.
 * What they leave stale is a wider changes view, and the next turn's `fetchWork` brings
 * the branch level.
 */
const moveWith =
  (
    fetchWork: VcsShape["fetchWork"],
    proc: ProcessShape,
    repoRoot: string,
  ): VcsShape["moveOntoBase"] =>
  (worktree, merged, base) =>
    Effect.gen(function* () {
      const move = yield* moveInCheckout(proc, repoRoot, worktree, merged, base)
      if (move._tag !== "Moved") return move
      const trakId = trakOfBranch(worktree.branch)
      yield* Effect.andThen(
        trakId === undefined ? Effect.void : fetchWork(trakId),
        git(proc, repoRoot, "record base", ["update-ref", baseRefFor(worktree.branch), move.onto]),
      ).pipe(
        Effect.catchTag("GitFailed", (e) =>
          Effect.logWarning(
            `${worktree.branch} moved onto ${move.onto} and is pushed, but its records here were not brought level: ${e.reason}`,
          ),
        ),
      )
      return move
    })

/**
 * The cache checkout at `cache`: a clone of `origin` of the repository at `startDir`
 * where nothing is there yet, and fetched from it where it is. The clone is made beside
 * `cache` and moved into place, so one cut short is never taken for a cache.
 *
 * The branch the cache stands on is fast-forwarded to `origin`'s, since a trak with no
 * `from` starts from it. One that will not fast-forward is left where it is with a
 * warning: the cache is still usable, and only new traks' bases are older.
 *
 * The commit identity is `startDir`'s, written into the cache, as a sandbox is handed it.
 * The tool's own paths are ignored here at once: every trak's checkout is under this
 * repository, and a commit before the first trak's create would take its projection.
 */
const cacheCheckout = (
  proc: ProcessShape,
  startDir: string,
  cache: string,
): Effect.Effect<string, GitFailed> =>
  Effect.gen(function* () {
    const origin = yield* git(proc, startDir, "read origin", ["remote", "get-url", "origin"])
    const cloned = existsSync(cache) ? false : yield* cloneCache(proc, origin, cache)
    if (!cloned) {
      yield* gitRemote(proc, cache, "fetch cache checkout", ["fetch", "--quiet", "origin"])
      yield* fastForwardCache(proc, cache)
    }
    const identity = yield* identityEnv(proc, startDir)
    for (const [key, value] of [
      ["user.name", identity["GIT_AUTHOR_NAME"]],
      ["user.email", identity["GIT_AUTHOR_EMAIL"]],
    ] as const) {
      // Written only where it differs: two copies booting together each take the config's
      // lock to write, and the second's write fails while the first holds it.
      const held = yield* runGit(proc, cache, "read cache identity", ["config", "--get", key])
      if (value !== undefined && (held.code !== 0 || held.out.trim() !== value)) {
        yield* git(proc, cache, "write cache identity", ["config", key, value])
      }
    }
    yield* ensureIgnored(proc, cache)
    return yield* git(proc, cache, "find cache checkout", ["rev-parse", "--show-toplevel"])
  })

/**
 * `origin` cloned beside `cache` and moved into place: true where this copy's clone is the
 * cache, false where another engine copy booting at the same moment moved its clone into
 * place first — this one's is deleted, and the caller fetches the other's. Any other
 * failure of the move fails the boot.
 */
const cloneCache = (
  proc: ProcessShape,
  origin: string,
  cache: string,
): Effect.Effect<boolean, GitFailed> =>
  Effect.gen(function* () {
    // Named for this build alone, so no other build's clone, in this process or another,
    // is ever this one's.
    const making = `${cache}.cloning-${randomUUID()}`
    yield* fsStep("make cache checkout", () => {
      mkdirSync(dirname(cache), { recursive: true })
    })
    yield* gitRemote(proc, dirname(cache), "clone cache checkout", [
      "clone",
      "--quiet",
      origin,
      making,
    ])
    return yield* fsStep("make cache checkout", () => {
      try {
        renameSync(making, cache)
        return true
      } catch (e) {
        const code = e instanceof Error && "code" in e ? e.code : undefined
        if ((code !== "ENOTEMPTY" && code !== "EEXIST") || !existsSync(cache)) throw e
        rmSync(making, { recursive: true, force: true })
        return false
      }
    })
  })

const fastForwardCache = (proc: ProcessShape, cache: string): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const args = ["merge", "--ff-only", "--quiet", "@{upstream}"]
    const exit = yield* runGit(proc, cache, "fast-forward cache checkout", args)
    if (exit.code === 0) return
    yield* Effect.logWarning(
      `the cache checkout ${cache} is left where it stands — ${gitFailed("fast-forward cache checkout", args, exit).reason} — so a new trak starts from an older base`,
    )
  })

/** A filesystem step of `op`, failing as git's own would. */
const fsStep = <A>(op: string, step: () => A): Effect.Effect<A, GitFailed> =>
  Effect.try({
    try: step,
    catch: (e) => new GitFailed({ op, reason: e instanceof Error ? e.message : String(e) }),
  })

/**
 * `removeWorktree` under a runner: a last fetch, then `release`, then `removeWorktree`
 * itself, for a checkout on this machine and the branch. **A stopped sandbox is started
 * for the fetch**, as a running one is reached: a fetch at a turn's end that failed is
 * only a warning, so a stopped sandbox can hold commits this machine does not, and
 * `release` deletes them. A fetch that fails is `releaseUnfetched`'s to judge.
 *
 * **A `Held` removal fetches nothing**, because the fetch could only bring what this
 * machine has: the one line it logs is the whole account of a sandbox released without a
 * command sent into it. `status` is still asked — it is the runner's own, not a command
 * in the sandbox — so a sandbox already gone is not released a second time.
 */
const removeSandboxed = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  worktree: Worktree,
  removal: Removal,
  record: RecordedOn,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const trakId = trakOfBranch(worktree.branch)
    if (trakId !== undefined) {
      const state = yield* sandboxes.status(trakId)
      if (removal._tag === "Held" && state !== "absent") {
        yield* Effect.logInfo(
          `${worktree.branch}: its sandbox is released with nothing run in it — ${removal.why}`,
        )
      } else if (removal._tag === "Reach" && state !== "absent") {
        yield* recordFromSandbox(proc, repoRoot, sandboxes, trakId, record).pipe(
          Effect.catchTag("GitFailed", (e) =>
            releaseUnfetched(proc, repoRoot, worktree.branch, removal.kept, e),
          ),
        )
      }
      if (state !== "absent") yield* sandboxes.release(trakId)
    }
    // A checkout this machine holds goes too, wherever the trak is placed: one made here
    // before `HostTraks` kept a record of it is routed as sandboxed, and the record git
    // keeps for it refuses `branch -D` with "used by worktree" on every archive.
    yield* removeWorktree(proc, repoRoot, worktree)
  })

/**
 * What the removal has to run in the trak's sandbox. `Reach` with no runner file, and for
 * a branch naming no trak — neither has a sandbox to skip anything in, which is the guard
 * `removeSandboxed` makes on the same reading.
 */
const removalFor = (
  where: Where,
  proc: ProcessShape,
  repoRoot: string,
  worktree: Worktree,
  kept: KeptWork,
): Effect.Effect<Removal, GitFailed> =>
  where(
    trakOfBranch(worktree.branch),
    () => Effect.succeed(Removal.Reach({ kept })),
    () =>
      trakOfBranch(worktree.branch) === undefined
        ? Effect.succeed(Removal.Reach({ kept }))
        : Effect.map(heldHere(proc, repoRoot, worktree.branch, kept), (held) =>
            held.safe ? Removal.Held({ why: held.why }) : Removal.Reach({ kept }),
          ),
  )

/**
 * Whether the sandbox holds nothing this machine does not, and the sentence that says
 * why — asked before the removal reaches in, and again where its last fetch failed.
 *
 * `At` is held against the branch's tip here, which is sound because `commitSandboxed`
 * fails a commit whose fetch fails: every commit the log recorded was fetched.
 */
const heldHere = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
  kept: KeptWork,
): Effect.Effect<{ readonly safe: boolean; readonly why: string }, GitFailed> =>
  Effect.gen(function* () {
    const tip = kept._tag === "At" ? yield* branchTip(proc, repoRoot, branch) : undefined
    return KeptWork.$match(kept, {
      Merged: () => ({ safe: true, why: "the branch is merged" }),
      At: ({ head }) =>
        tip === head
          ? { safe: true, why: `this machine holds ${branch} at ${head}, its last recorded commit` }
          : {
              safe: false,
              why: `this machine holds ${branch} at ${tip ?? "nothing"}, not at ${head}, its last recorded commit, so the commits between them are only in the sandbox`,
            },
      Unsure: ({ why }) => ({
        safe: false,
        why: `${why}, so whatever it wrote and did not commit, or committed and did not fetch, is only in the sandbox`,
      }),
    })
  })

/**
 * A last fetch that failed, `failed`, judged against what the log says of the work:
 * logged and passed where the sandbox holds nothing more, and keeping it would only keep
 * paying for it. Anywhere else the sandbox may hold work this machine does not, so the
 * removal fails with what could be lost, and the sandbox is kept for a retry.
 *
 * Reached where a `Reach` removal was the caller's answer and the fetch was not what made
 * it one — an `external` teardown had to run in the checkout first.
 */
const releaseUnfetched = (
  proc: ProcessShape,
  repoRoot: string,
  branch: BranchName,
  kept: KeptWork,
  failed: GitFailed,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const held = yield* heldHere(proc, repoRoot, branch, kept)
    if (held.safe) {
      return yield* Effect.logWarning(
        `${branch}: the last fetch from its sandbox failed; releasing it anyway, because ${held.why}: ${failed.reason}`,
      )
    }
    return yield* Effect.fail(
      new GitFailed({
        op: failed.op,
        reason: `${failed.reason}\nThe sandbox is kept: ${held.why}.`,
        ...(failed.runner === undefined ? {} : { runner: failed.runner }),
      }),
    )
  })

/**
 * A trak's branch fetched before anything merges it. **A merge refuses until a fetch
 * succeeds**: this machine's copy may be short of what was committed since the last one,
 * and merging it would land less than the trak did. A trak with no sandbox has nothing
 * further to give, and its copy here is the whole of it.
 */
const fetchBeforeMerge = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  branch: BranchName,
  record: RecordedOn,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const trakId = trakOfBranch(branch)
    if (trakId === undefined || !(yield* sandboxes.holds(trakId))) return
    if (!(yield* hasSandbox(sandboxes, trakId))) return
    yield* recordFromSandbox(proc, repoRoot, sandboxes, trakId, record).pipe(
      Effect.mapError(
        (e) =>
          new GitFailed({
            op: "fetch before merge",
            reason: `${branch} could not be fetched from its sandbox, so this machine's copy may be short of its commits and nothing merges it until a fetch succeeds: ${e.reason}`,
          }),
      ),
    )
  })

/**
 * `carryTarget` under a runner. The target is fetched before it is pushed, by
 * `fetchBeforeMerge` — a resolving step that merges a copy short of the target's commits
 * resolves against less than the target holds, and the conflict comes back at the next
 * merge — and then pushed under its own name, never over the trak's own branch, which is
 * checked out in its sandbox. Nothing is pushed where this machine holds no such branch.
 */
const carryTargetSandboxed = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  trakId: string,
  target: BranchName,
  record: RecordedOn,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    if (target === branchFor(trakId) || !(yield* hasSandbox(sandboxes, trakId))) return
    yield* fetchBeforeMerge(proc, repoRoot, sandboxes, target, record)
    if (!(yield* branchExists(proc, repoRoot, "read merge target", target))) return
    yield* pushToSandbox(sandboxes, repoRoot, trakId, target, "push merge target")
  })

/**
 * `merge` under a runner. A parent's checkout is in its own sandbox, so the child's
 * branch is pushed in there first and merged where the parent's checkout is; the parent
 * is fetched afterwards, so `contains` and the parent's diff read the merge here. A
 * fetch after the merge that fails is logged: the merge stands, and the parent's next
 * fetch brings it.
 */
const mergeSandboxed =
  (proc: ProcessShape, repoRoot: string, permits: GoalPermits, record: RecordedOn) =>
  (
    sandboxes: SandboxesShape,
    into: MergeInto,
    branch: BranchName,
    message: string,
  ): Effect.Effect<MergeOutcome, GitFailed> =>
    Effect.gen(function* () {
      yield* fetchBeforeMerge(proc, repoRoot, sandboxes, branch, record)
      const parent =
        into._tag === "Checkout" ? trakOfCheckout(repoRoot, into.worktree.path) : undefined
      if (into._tag !== "Checkout" || parent === undefined || !(yield* sandboxes.holds(parent))) {
        return yield* merge(proc, repoRoot, permits, into, branch, message)
      }
      yield* pushToSandbox(sandboxes, repoRoot, parent, branch, "push into parent sandbox")
      // Run again whole where the sandbox could not be reached: `mergeInto` is re-runnable —
      // a merge that went in reads as *already up to date*, and one left conflicted fails
      // its retry with the unmerged paths still there, which `mergeRefusal` reads.
      const outcome = yield* sandboxes.retried(
        parent,
        "merge in parent sandbox",
        Effect.zipRight(
          confirmOnItsBranch(proc, into.worktree),
          mergeInto(proc, into.worktree.path, branch, message),
        ),
      )
      if (outcome._tag === "Merged") {
        yield* recordFromSandbox(
          proc,
          repoRoot,
          sandboxes,
          parent,
          record,
          into.worktree.path,
        ).pipe(
          Effect.catchTag("GitFailed", (e) =>
            Effect.logWarning(
              `${into.worktree.branch}: merged in its sandbox, not fetched: ${e.reason}`,
            ),
          ),
        )
      }
      return outcome
    })

// ---------------------------------------------------------------------------
// Landing in the project's sandbox
// ---------------------------------------------------------------------------
//
// Under an external store `origin` is the record, so a merge onto the default branch or a goal
// branch runs where `origin` is reached from — sandbox `project` — and is pushed before
// the merge is reported. The cache checkout is fetched afterwards, so `wouldConflict` and
// `contains` read the result.

/** What the landing script prints before its answer, so git's own output is never read as one. */
const LANDED = "orkestra-landing:"

/** How many times a landing merges again because `origin`'s branch moved under its push. */
const LAND_TRIES = 3

/**
 * One landing, in the project's checkout at `$1`: `$ORKESTRA_INTO` and `$ORKESTRA_MERGE`
 * fetched from `origin`, the merge made in a linked checkout of its own, and pushed. Never
 * the project's own checkout, which the fetch before every spawn there moves — a second
 * spawn would move it under this merge. Signs in to GitHub through the helper the fetch
 * before the spawn set on the checkout.
 *
 * Prints `merged <sha>`; `conflicted` and the paths, with the merge aborted; or `moved`,
 * where the push was refused because `origin`'s branch moved since the fetch. Any other
 * refusal exits non-zero. **Running it twice leaves what running it once does**: a merge
 * already pushed reads as *already up to date*, and pushing it again moves nothing.
 */
const LAND_PROJECT = `set -e
repo=$1
cd "$repo"
w=$(mktemp -d)
trap 'cd "$repo" && { git worktree remove --force "$w" 2>/dev/null || rm -rf "$w"; git worktree prune; }' EXIT
dest="refs/remotes/origin/$ORKESTRA_INTO"
ours="refs/remotes/origin/$ORKESTRA_MERGE"
remote() { git ${GITHUB_SSH.map(([ssh]) => `-c url.https://github.com/.insteadOf=${ssh}`).join(" ")} "$@"; }
remote fetch --quiet --no-tags origin "+refs/heads/$ORKESTRA_INTO:$dest" "+refs/heads/$ORKESTRA_MERGE:$ours"
base=$(git rev-parse "$dest")
git worktree add --quiet --detach "$w" "$base"
cd "$w"
if ! git merge --no-ff --no-verify -m "$ORKESTRA_MESSAGE" "$ours" >&2; then
  paths=$(git diff --name-only --diff-filter=U)
  [ -n "$paths" ] || exit 1
  git merge --abort
  echo "${LANDED}conflicted"
  printf '%s\\n' "$paths"
  exit 0
fi
if remote push --quiet --no-verify origin "HEAD:refs/heads/$ORKESTRA_INTO"; then
  echo "${LANDED}merged $(git rev-parse HEAD)"
  exit 0
fi
remote fetch --quiet --no-tags origin "+refs/heads/$ORKESTRA_INTO:$dest"
[ "$(git rev-parse "$dest")" != "$base" ] || exit 1
echo "${LANDED}moved"`

/** A branch as `origin` names it: `origin/<branch>` read as `<branch>`, and any other name as it is. */
const onOrigin = (branch: BranchName): string =>
  branch.startsWith("origin/") ? branch.slice("origin/".length) : branch

/** What one run of `LAND_PROJECT` answered. */
type Landing = MergeOutcome | "moved"

/** The answer `LAND_PROJECT` printed, read from its own lines only. */
const landingOf = (lines: readonly string[]): Landing | undefined => {
  const at = lines.findIndex((line) => line.startsWith(LANDED))
  const said = lines[at]?.slice(LANDED.length)
  if (said === "moved") return "moved"
  if (said?.startsWith("merged ") === true) {
    return MergeOutcome.Merged({ sha: CommitSha.make(said.slice("merged ".length).trim()) })
  }
  const [first, ...rest] = lines.slice(at + 1).filter((line) => line !== "")
  return said === "conflicted" && first !== undefined
    ? MergeOutcome.Conflicted({ paths: [first, ...rest] })
    : undefined
}

/** One run of `LAND_PROJECT` in the project's sandbox, `GH_TOKEN` handed by name. */
const landOnce = (
  proc: ProcessShape,
  place: CheckoutPlace,
  env: Readonly<Record<string, string>>,
): Effect.Effect<Landing, GitFailed> => {
  const op = "land in the project's sandbox"
  return Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "sh",
      args: ["-c", LAND_PROJECT, "sh", place.path],
      cwd: place.path,
      env: { ...NO_PROMPT, ...env },
      credentials: ["GH_TOKEN"],
      inProject: true,
      stdin: undefined,
      holdStdin: false,
    })
    const lines = [...(yield* Stream.runCollect(spawned.lines))]
    const exited = yield* spawned.exited
    const landing = exited.code === 0 ? landingOf(lines) : undefined
    if (landing !== undefined) return landing
    const said = exited.stderr.trim()
    return yield* Effect.fail(
      new GitFailed({
        op,
        reason: `merging ${env["ORKESTRA_MERGE"] ?? "?"} into ${env["ORKESTRA_INTO"] ?? "?"} on origin exited ${String(exited.code ?? exited.signal ?? "?")}${said === "" ? "" : `: ${said}`}`,
      }),
    )
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )
}

/**
 * The cache checkout brought to what a landing pushed: the branch fetched, and the default
 * branch the cache stands on fast-forwarded. A failure is logged: `origin` holds the merge,
 * and the next fetch brings it.
 */
const levelAfterLanding = (
  proc: ProcessShape,
  repoRoot: string,
  into: MergeInto,
  destination: BranchName,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* gitRemote(proc, repoRoot, "fetch landed branch", [
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      destination,
    ])
    if (into._tag === "Host") yield* fastForwardCache(proc, repoRoot)
  }).pipe(
    Effect.catchTag("GitFailed", (e) =>
      Effect.logWarning(
        `${destination}: landed on origin, not fetched into the cache: ${e.reason}`,
      ),
    ),
  )

/**
 * `merge` onto the default branch or a goal branch under an external store: in the project's
 * sandbox, pushed to `origin` before it answers, and tried again through a lost connection
 * by `retried`, since `LAND_PROJECT` is safe to run twice. A push `origin` refused because
 * its branch moved merges again from the new tip, up to `LAND_TRIES` times; any other
 * refusal fails the landing, so nothing reports a merge `origin` does not hold.
 *
 * `branch` is read as the branch `origin` holds: a sub-goal's merge names it as
 * `origin/<branch>`, the remote-tracking name a merge in the cache resolves, and a trak's
 * by its bare name. The landing fetches both from `origin` as `refs/heads/<branch>`.
 */
const landInProject = (
  proc: ProcessShape,
  repoRoot: string,
  sandboxes: SandboxesShape,
  place: CheckoutPlace,
  into: MergeInto,
  branch: BranchName,
  message: string,
): Effect.Effect<MergeOutcome, GitFailed> =>
  Effect.gen(function* () {
    const op = "land in the project's sandbox"
    const destination = into._tag === "Goal" ? into.branch : yield* defaultBranch(proc, repoRoot)
    if (destination === undefined) {
      return yield* Effect.fail(
        new GitFailed({ op, reason: "`origin` names no default branch to land on" }),
      )
    }
    const env = {
      ...(yield* identityEnv(proc, repoRoot)),
      ORKESTRA_INTO: destination,
      ORKESTRA_MERGE: onOrigin(branch),
      ORKESTRA_MESSAGE: message,
    }
    const attempt = (tried: number): Effect.Effect<MergeOutcome, GitFailed> =>
      Effect.flatMap(sandboxes.retried(place.trak, op, landOnce(proc, place, env)), (landing) => {
        if (landing !== "moved") return Effect.succeed(landing)
        if (tried < LAND_TRIES) return attempt(tried + 1)
        return Effect.fail(
          new GitFailed({
            op,
            reason: `origin's ${destination} moved under each of ${String(LAND_TRIES)} pushes, so ${branch} is not landed`,
          }),
        )
      })
    const outcome = yield* attempt(1)
    if (outcome._tag === "Merged") yield* levelAfterLanding(proc, repoRoot, into, destination)
    return outcome
  })

/**
 * The project's place where a merge into `into` lands there — under an external store, with
 * the project's sandbox in use, onto the default branch or a goal branch — and
 * `undefined` for every other merge, which runs as it does with no external store.
 */
const landingPlace = (
  held: Option.Option<SandboxesShape>,
  record: RecordedOn,
  into: MergeInto,
): Effect.Effect<{ sandboxes: SandboxesShape; place: CheckoutPlace } | undefined> =>
  Option.match(held, {
    onNone: () => Effect.succeed(undefined),
    onSome: (sandboxes) =>
      record !== "origin" || into._tag === "Checkout"
        ? Effect.succeed(undefined)
        : Effect.map(sandboxes.project, (place) =>
            place === undefined ? undefined : { sandboxes, place },
          ),
  })

/**
 * `Vcs.merge`. Asked of the project rather than of one trak: the branch and the checkout it
 * goes into may each be in a sandbox or not, and `mergeSandboxed` asks of each.
 */
const mergeWith =
  (
    held: Option.Option<SandboxesShape>,
    where: Where,
    proc: ProcessShape,
    repoRoot: string,
    permits: GoalPermits,
    record: RecordedOn,
  ): VcsShape["merge"] =>
  (into, branch, message) =>
    Effect.flatMap(landingPlace(held, record, into), (landing) =>
      landing === undefined
        ? where(
            undefined,
            () => merge(proc, repoRoot, permits, into, branch, message),
            (sandboxes) =>
              mergeSandboxed(proc, repoRoot, permits, record)(sandboxes, into, branch, message),
          )
        : landInProject(proc, repoRoot, landing.sandboxes, landing.place, into, branch, message),
    )

/**
 * `proc` with every spawn a read — `exec --if-running` in a sandbox, so it never starts a
 * stopped one — and `stopped` set once any of them found the sandbox not running.
 */
const readingOnly = (proc: ProcessShape, stopped: Ref.Ref<boolean>): ProcessShape => ({
  ...proc,
  spawn: (spec) =>
    Effect.map(proc.spawn({ ...spec, ifRunning: true }), (spawned) => ({
      ...spawned,
      exited: Effect.tap(spawned.exited, (exited) =>
        exited.stopped === true ? Ref.set(stopped, true) : Effect.void,
      ),
    })),
})

/**
 * The uncommitted diff under a runner: the same git commands, each a read. **A stopped
 * sandbox answers nothing uncommitted**, because nothing is readable there and a read
 * never starts one — and a stopped sandbox has no turn writing into it.
 */
const uncommittedSandboxed = (
  proc: ProcessShape,
  worktree: Worktree,
  only: string | undefined,
): Effect.Effect<Changes, GitFailed> =>
  Effect.gen(function* () {
    const stopped = yield* Ref.make(false)
    const changes = yield* uncommittedIn(readingOnly(proc, stopped), worktree, only)
    return (yield* Ref.get(stopped)) ? { files: [] } : changes
  })

/**
 * `workingTree` in a sandboxed checkout, as one read: the scratch index has to be beside
 * the checkout's own, which this machine does not hold, so the copy, the `add`, the
 * `rm` and the `write-tree` are one script there. A stopped sandbox has no tree to read,
 * which is a failure — the caller then runs the check whole.
 */
const WORKING_TREE_SCRIPT = `set -e
i=$(git rev-parse --path-format=absolute --git-path index)
s=$(mktemp)
trap 'rm -f "$s"' EXIT
if [ -f "$i" ]; then cp "$i" "$s"; else rm -f "$s"; fi
export GIT_INDEX_FILE="$s"
git add -A .
if [ "$1" = generated ]; then git rm --cached -r -q --ignore-unmatch -- '${GENERATED}'; fi
git write-tree`

const workingTreeSandboxed = (
  proc: ProcessShape,
  checkout: string,
  leaveOutGenerated: boolean,
): Effect.Effect<string, GitFailed> => {
  const op = "hash working tree"
  const args = ["-c", WORKING_TREE_SCRIPT, "sh", leaveOutGenerated ? "generated" : "all"]
  return Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "sh",
      args,
      cwd: checkout,
      env: {},
      stdin: undefined,
      holdStdin: false,
      ifRunning: true,
    })
    const out = yield* Stream.runCollect(spawned.lines)
    const exited = yield* spawned.exited
    if (exited.stopped === true) {
      return yield* Effect.fail(
        new GitFailed({
          op,
          reason: "the sandbox is stopped, so its checkout has no tree to read",
        }),
      )
    }
    const exit = { code: exited.code, signal: exited.signal, stderr: exited.stderr, out: "" }
    if (exited.code !== 0) return yield* Effect.fail(gitFailed(op, ["write-tree"], exit))
    return [...out].join("\n").trim()
  }).pipe(
    Effect.scoped,
    Effect.catchTag("ProcessFailed", (e) => Effect.fail(gitFailedFrom(op, e))),
  )
}

/** `Vcs.workingTree`: the project's own, a checkout here, or one in its sandbox. */
const workingTreeWith =
  (where: Where, proc: ProcessShape, repoRoot: string): VcsShape["workingTree"] =>
  (checkout, leaveOutGenerated) =>
    checkout === undefined
      ? workingTree(proc, repoRoot, leaveOutGenerated)
      : where(
          trakOfCheckout(repoRoot, checkout.path),
          () => workingTree(proc, checkout.path, leaveOutGenerated),
          (sandboxes) =>
            Effect.flatMap(sandboxes.placeOf(checkout.path), (place) =>
              place === undefined
                ? workingTree(proc, checkout.path, leaveOutGenerated)
                : workingTreeSandboxed(proc, checkout.path, leaveOutGenerated),
            ),
        )

/**
 * The git on this machine, or a refusal to start.
 *
 * A machine dependency nothing in the manifest can express — see
 * `logic/version.ts` — and it is checked beside the repository probe for the
 * same reason: an engine that discovers it halfway through has already spent a
 * turn, and the way it would discover this one is a merge preview that quietly
 * never predicts a conflict.
 */
const confirmVersion = (proc: ProcessShape, cwd: string): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    if (versionConfirmed) return
    const line = yield* git(proc, cwd, "read git version", ["--version"])
    if (gitTooOld(line)) {
      return yield* Effect.fail(
        new GitFailed({
          op: "read git version",
          reason: `Orkestra needs git ${MIN_GIT} or newer and this machine reports "${line}" — \`git merge-tree --write-tree\`, which is how a merge is predicted before you press anything, arrived in ${MIN_GIT}.`,
        }),
      )
    }
    versionConfirmed = true
  })

/**
 * `startDir` rather than the root itself, mirroring `FsLibraryLayer`: which
 * repository we are in is runtime input, and a CLI is invoked from wherever the
 * user happens to be standing. Failing at startup is the point — a trak that
 * discovers there is no repository halfway through has already spent a turn.
 */
export const GitCliLayer = (
  startDir: string,
  // The cache checkout, under an external store: the repository every call below works in, a
  // clone of `startDir`'s `origin`, and a trak's commits — and, with the project's sandbox
  // in use, its landings — recorded on `origin` before the log names them. With none the
  // repository is `startDir`'s, and commits stay here.
  cache?: string,
): Layer.Layer<Vcs, GitFailed, Process> =>
  Layer.effect(
    Vcs,
    Effect.gen(function* () {
      const proc = yield* Process
      const started = yield* git(proc, startDir, "find repository", [
        "rev-parse",
        "--show-toplevel",
      ])
      yield* confirmVersion(proc, started)
      const repoRoot = cache === undefined ? started : yield* cacheCheckout(proc, started, cache)
      const record: RecordedOn = cache === undefined ? "here" : "origin"
      const permits = goalPermits()
      // Asked on every call that depends on it, for the runner file is read on each spawn.
      const held = yield* Effect.serviceOption(Sandboxes)
      const where = whereFor(held)
      const during = duringWith(yield* Effect.serviceOption(Preparation))
      const recorded = recordWith(where, proc, repoRoot, record)
      return {
        createWorktree: createWith(where, during, proc, repoRoot, record),
        ...recorded,
        moveOntoBase: moveWith(recorded.fetchWork, proc, repoRoot),
        removeWorktree: (worktree, removal) =>
          where(
            trakOfBranch(worktree.branch),
            () => removeWorktree(proc, repoRoot, worktree),
            (sandboxes) => removeSandboxed(proc, repoRoot, sandboxes, worktree, removal, record),
          ),
        removalFor: (worktree, kept) => removalFor(where, proc, repoRoot, worktree, kept),
        // Only ever a checkout `remakeCheckout` made, which is never in a sandbox.
        removeCheckout: (worktree) => removeCheckout(proc, repoRoot, worktree),
        deleteBranch: (worktree) => deleteBranch(proc, repoRoot, worktree),
        forgetTrak: (trakId) => forgetRecords(proc, repoRoot, branchFor(trakId)),
        ...carryWith(where, proc, repoRoot, record),
        // The path is derived from the id here rather than asked for, which is the
        // whole point of the id being the key: a caller with no `Worktree` yet is
        // the one that needs the answer.
        hasCheckout: (trakId) =>
          where(
            trakId,
            () => hasCheckout(proc, repoRoot, worktreePathFor(repoRoot, trakId)),
            (sandboxes) => hasSandbox(sandboxes, trakId),
          ),
        remakeCheckout: (trakId) => remakeCheckout(proc, repoRoot, held, trakId, during),
        // The branch name is derived here for the same reason the path is: the
        // caller asking is the one that has an id and nothing else.
        hasBranch: (trakId) => branchExists(proc, repoRoot, "read branch", branchFor(trakId)),
        branchTip: (trakId) => branchTip(proc, repoRoot, branchFor(trakId)),
        branchFromOrigin: (trakId) =>
          record === "origin"
            ? fetchFromOrigin(proc, repoRoot, trakId)
            : Effect.fail(
                new GitFailed({
                  op: "fetch trak branch from origin",
                  reason: "this repository's branches are the record here, not origin's",
                }),
              ),
        merge: mergeWith(held, where, proc, repoRoot, permits, record),
        wouldConflict: (into, branch) => wouldConflict(proc, repoRoot, into, branch),
        contains: (into, branch) => contains(proc, repoRoot, into, branch),
        createGoalBranch: (branch, from) => createGoalBranch(proc, repoRoot, branch, from),
        pushGoal: (goal, branch) => permits(goal)(pushGoal(proc, repoRoot, goal, branch)),
        removeGoalCheckout: (goal) => permits(goal)(removeGoalCheckout(proc, repoRoot, goal)),
        hostBranch: () => hostBranch(proc, repoRoot),
        defaultBranch: () => defaultBranch(proc, repoRoot),
        originTip: (branch) =>
          refTip(proc, repoRoot, "read origin branch tip", `refs/remotes/origin/${branch}`),
        dirty: (checkout) => dirtyLines(proc, checkout?.path ?? repoRoot),
        workingTree: workingTreeWith(where, proc, repoRoot),
        headTree: () => git(proc, repoRoot, "read head tree", ["rev-parse", "HEAD^{tree}"]),
        publishProofs: (tree, text, prints = []) =>
          publishProofs(proc, repoRoot, tree, text, prints),
        readProofs: (tree, prints) => readProofs(proc, repoRoot, tree, prints),
        ensureIgnored: () => ensureIgnored(proc, repoRoot),
        changes: (range, only) =>
          ChangeRange.$match(range, {
            Branch: (r) => branchChanges(proc, repoRoot, r.worktree, only),
            Commits: (r) => committedChanges(proc, repoRoot, r.from, r.to, only),
            Uncommitted: (r) =>
              where(
                trakOfBranch(r.worktree.branch),
                () => uncommittedChanges(proc, repoRoot, r.worktree, only),
                () => uncommittedSandboxed(proc, r.worktree, only),
              ),
          }),
        hostStatus: () => hostStatus(proc, repoRoot),
        fetch: () => fetchOrigin(proc, repoRoot),
        pull: () => pull(proc, repoRoot),
        reconcile: () => reconcile(proc, repoRoot),
        stashAnd: (press) => stashAnd(proc, repoRoot, press),
        push: () => push(proc, repoRoot),
        projectFiles: () => projectFiles(proc, repoRoot),
        grepProject: (text, limit) => grepProject(proc, repoRoot, text, limit),
      } satisfies VcsShape
    }),
  )
