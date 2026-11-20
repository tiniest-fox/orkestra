// A `Vcs` with no git underneath: every branch's history as file snapshots in
// memory, and every checkout a real directory on disk.
//
// For the flow tests whose subject is not git. What a flow wants to know about a
// worktree — that the directory a step is told to work in exists, and that what it
// wrote is kept — still holds, because the directories are real. Only the history
// is modelled, and a flow reads that through the port alone. The shared cases of
// `vcsContract`, which judge a `Vcs` by the port and the files on disk, hold it to
// the same answers git gives.
//
// What it leaves out on purpose:
//
// - a remote: every sync press is refused as git refuses it with no `origin`, no
//   proofs are published or read, and no goal branch is made or merged into;
// - git's patch text: `changes` is a plain line diff, renames only where the content
//   is identical;
// - line-level merges: a file both sides changed is a conflict;
// - a commit made in a checkout by anything but `commitWork`;
// - the checkout's own `.gitignore`: a snapshot leaves out `IGNORED_PATHS` and
//   nothing else, whatever the file says;
// - `.gitattributes`: no file is `linguist-generated`, so `changes` collapses nothing and
//   `workingTree` hashes every file whichever it is asked for;
// - anything but a regular file's bytes: no symlink, no executable bit;
// - a binary file in `grepProject`: every file is searched as text;
// - `git status`'s folding of an untracked directory into one `?? dir/` line —
//   `dirty` names every file in it.
//
// Its state lives as long as the layer, so a second layer built over the same
// directory finds no branches. A flow that rebuilds its layers stays on git.

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { Effect, Either, Layer } from "effect"
import { parseUnifiedDiff } from "../../src/vcs/logic/diff.js"
import { pullRefusal, pushRefusal, reconcileRefusal } from "../../src/vcs/logic/host-status.js"
import {
  branchFor,
  IGNORED_PATHS,
  ignoreFileWith,
  worktreeFor,
  worktreePathFor,
} from "../../src/vcs/logic/paths.js"
import { Vcs, type VcsShape } from "../../src/vcs/ports/vcs.js"
import type { Changes } from "../../src/vcs/types/changes.js"
import type { ProjectGrep, ProjectMatch } from "../../src/vcs/types/project-files.js"
import { GitFailed } from "../../src/vcs/types/errors.js"
import {
  HostHead,
  type HostStatus,
  type StashedPress,
  StashedSync,
  SyncRefusal,
} from "../../src/vcs/types/host-status.js"
import {
  BranchMove,
  BranchName,
  ChangeRange,
  CommitSha,
  MergeInto,
  MergeOutcome,
  Removal,
  type Worktree,
} from "../../src/vcs/types/worktree.js"

/** Every file in a tree, by its path from the root with `/` between segments. */
type Files = ReadonlyMap<string, Buffer>

interface Commit {
  /** Creation order. A parent is always older than its child, which `mergeBase` uses. */
  readonly seq: number
  readonly parents: readonly CommitSha[]
  readonly files: Files
}

interface Repo {
  readonly root: string
  /** The branch the host checkout is on. The fake never detaches it. */
  readonly host: BranchName
  readonly commits: Map<CommitSha, Commit>
  readonly branches: Map<BranchName, CommitSha>
  /** What git keeps under `refs/orkestra/base/`: where each branch started. */
  readonly bases: Map<BranchName, CommitSha>
  /** What git keeps under `refs/orkestra/fork/`: the branch each one forked from, by name. */
  readonly forks: Map<BranchName, BranchName>
  /** The checkout paths git would list in `worktree list`. */
  readonly checkouts: Set<string>
}

const failed = (op: string, reason: string): GitFailed => new GitFailed({ op, reason })

// -- trees on disk ----------------------------------------------------------

const escaped = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")

/**
 * `IGNORED_PATHS` as expressions over a path. Only the shapes that list uses: a
 * leading `**`, a `*` inside one segment, and a trailing `/` for a directory.
 * Checkouts sit under one of them, which is what keeps a snapshot of the host from
 * taking in every worktree.
 */
const IGNORED: readonly RegExp[] = IGNORED_PATHS.map((pattern) => {
  const directory = pattern.endsWith("/")
  const body = pattern.replace(/^\*\*\//, "").replace(/\/$/, "")
  const glob = body.split("*").map(escaped).join("[^/]*")
  return new RegExp(`(?:^|/)${glob}${directory ? "/" : "$"}`)
})

const ignored = (relative: string): boolean => IGNORED.some((pattern) => pattern.test(relative))

/** What `git add -A` would stage in `root`: every file, less `.git` and the ignored. */
const snapshot = (root: string): Files => {
  const files = new Map<string, Buffer>()
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const at = relative === "" ? entry.name : `${relative}/${entry.name}`
      if (entry.name === ".git") continue
      if (entry.isDirectory() && !ignored(`${at}/`)) walk(at)
      if (entry.isFile() && !ignored(at)) files.set(at, fs.readFileSync(path.join(root, at)))
    }
  }
  walk("")
  return files
}

const same = (a: Buffer | undefined, b: Buffer | undefined): boolean =>
  a === undefined ? b === undefined : b !== undefined && a.equals(b)

const sameFiles = (a: Files, b: Files): boolean =>
  a.size === b.size && [...a].every(([at, content]) => same(content, b.get(at)))

const allPaths = (...trees: readonly Files[]): readonly string[] => {
  const paths = new Set<string>()
  for (const tree of trees) for (const at of tree.keys()) paths.add(at)
  return [...paths].sort()
}

/** Move the files under `root` from `before` to `after`, touching only what differs. */
const writeTree = (root: string, before: Files, after: Files): void => {
  for (const at of allPaths(before, after)) {
    const content = after.get(at)
    if (same(before.get(at), content)) continue
    const file = path.join(root, at)
    if (content === undefined) {
      fs.rmSync(file, { force: true })
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
  }
}

// -- the line diff ----------------------------------------------------------

/** Git's own test: a NUL in the first 8000 bytes. */
const isBinary = (content: Buffer): boolean => content.subarray(0, 8000).includes(0)

const linesOf = (content: Buffer | undefined): readonly string[] => {
  const text = content?.toString("utf8") ?? ""
  if (text === "") return []
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines
}

interface Edit {
  readonly kind: "context" | "del" | "add"
  readonly text: string
}

/** Past this many cells the table is skipped and the file reads as replaced whole. */
const TABLE_CAP = 4_000_000

const del = (text: string): Edit => ({ kind: "del", text })
const add = (text: string): Edit => ({ kind: "add", text })

/** A longest-common-subsequence edit script — fine at the sizes a test writes. */
const editsOf = (a: readonly string[], b: readonly string[]): readonly Edit[] => {
  if (a.length * b.length > TABLE_CAP) return [...a.map(del), ...b.map(add)]
  const width = b.length + 1
  const common = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        a[i] === b[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0)
    }
  }
  const edits: Edit[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const left = a[i]
    const right = b[j]
    if (left !== undefined && left === right) {
      edits.push({ kind: "context", text: left })
      i += 1
      j += 1
    } else if (
      right === undefined ||
      (left !== undefined && (common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0))
    ) {
      edits.push(del(left ?? ""))
      i += 1
    } else {
      edits.push(add(right))
      j += 1
    }
  }
  return edits
}

const CONTEXT = 3

/** Which edits a hunk carries: every change, and up to three lines of context either side. */
const shownEdits = (edits: readonly Edit[]): readonly boolean[] => {
  const shown = edits.map((e) => e.kind !== "context")
  for (const order of [[...edits.keys()], [...edits.keys()].toReversed()]) {
    let since = CONTEXT + 1
    for (const i of order) {
      since = edits[i]?.kind === "context" ? since + 1 : 0
      if (since <= CONTEXT) shown[i] = true
    }
  }
  return shown
}

/** `@@` ranges as git writes them: an empty side starts at the line before. */
const span = (start: number, count: number): string =>
  count === 0 ? `${String(start - 1)},0` : `${String(start)},${String(count)}`

const hunksOf = (edits: readonly Edit[]): readonly string[] => {
  const shown = shownEdits(edits)
  const out: string[] = []
  let oldLine = 1
  let newLine = 1
  let open: { oldStart: number; newStart: number; body: string[] } | undefined
  const close = (): void => {
    if (open === undefined) return
    const oldCount = oldLine - open.oldStart
    const newCount = newLine - open.newStart
    out.push(`@@ -${span(open.oldStart, oldCount)} +${span(open.newStart, newCount)} @@`)
    out.push(...open.body)
    open = undefined
  }
  edits.forEach((edit, i) => {
    if (shown[i] !== true) close()
    else open ??= { oldStart: oldLine, newStart: newLine, body: [] }
    const marker = edit.kind === "add" ? "+" : edit.kind === "del" ? "-" : " "
    open?.body.push(`${marker}${edit.text}`)
    if (edit.kind !== "add") oldLine += 1
    if (edit.kind !== "del") newLine += 1
  })
  close()
  return out
}

/** One file's patch, in the unified format `parseUnifiedDiff` reads. */
const filePatch = (at: string, before: Buffer | undefined, after: Buffer | undefined): string => {
  const head = [`diff --git a/${at} b/${at}`]
  if (before === undefined) head.push("new file mode 100644")
  if (after === undefined) head.push("deleted file mode 100644")
  const from = before === undefined ? "/dev/null" : `a/${at}`
  const to = after === undefined ? "/dev/null" : `b/${at}`
  if ((before !== undefined && isBinary(before)) || (after !== undefined && isBinary(after))) {
    return [...head, `Binary files ${from} and ${to} differ`].join("\n")
  }
  const hunks = hunksOf(editsOf(linesOf(before), linesOf(after)))
  return [...head, `--- ${from}`, `+++ ${to}`, ...hunks].join("\n")
}

/**
 * The changes between two trees, through the same parser and caps git's patch
 * goes through. A file removed and one added with identical content are one rename.
 */
const diffOf = (before: Files, after: Files): Changes => {
  const removed = [...before.keys()].filter((at) => !after.has(at)).sort()
  const patches: string[] = []
  const moved = new Set<string>()
  for (const at of [...after.keys()].filter((p) => !before.has(p)).sort()) {
    const content = after.get(at)
    const from = removed.find(
      (r) =>
        !moved.has(r) &&
        content !== undefined &&
        content.length > 0 &&
        same(before.get(r), content),
    )
    if (from === undefined) {
      patches.push(filePatch(at, undefined, content))
      continue
    }
    moved.add(from)
    patches.push(`diff --git a/${from} b/${at}\nrename from ${from}\nrename to ${at}`)
  }
  for (const at of removed.filter((r) => !moved.has(r))) {
    patches.push(filePatch(at, before.get(at), undefined))
  }
  for (const at of allPaths(before).filter((p) => after.has(p))) {
    if (!same(before.get(at), after.get(at))) {
      patches.push(filePatch(at, before.get(at), after.get(at)))
    }
  }
  return parseUnifiedDiff(patches.join("\n"))
}

// -- history ----------------------------------------------------------------

const NOTHING: Files = new Map()

const filesAt = (repo: Repo, sha: CommitSha | undefined): Files =>
  sha === undefined ? NOTHING : (repo.commits.get(sha)?.files ?? NOTHING)

const commit = (repo: Repo, parents: readonly CommitSha[], files: Files): CommitSha => {
  const seq = repo.commits.size + 1
  const sha = CommitSha.make(seq.toString(16).padStart(40, "0"))
  repo.commits.set(sha, { seq, parents, files })
  return sha
}

/** `sha` and everything it descends from. */
const ancestry = (repo: Repo, sha: CommitSha): ReadonlySet<CommitSha> => {
  const seen = new Set<CommitSha>()
  const queue = [sha]
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (seen.has(next)) continue
    seen.add(next)
    queue.push(...(repo.commits.get(next)?.parents ?? []))
  }
  return seen
}

const isAncestor = (repo: Repo, older: CommitSha, newer: CommitSha): boolean =>
  ancestry(repo, newer).has(older)

/** The newest commit both descend from — a best common ancestor, as git picks one. */
const mergeBase = (repo: Repo, a: CommitSha, b: CommitSha): CommitSha | undefined => {
  const mine = ancestry(repo, a)
  let best: CommitSha | undefined
  for (const sha of ancestry(repo, b)) {
    const seq = repo.commits.get(sha)?.seq ?? 0
    if (mine.has(sha) && (best === undefined || seq > (repo.commits.get(best)?.seq ?? 0))) {
      best = sha
    }
  }
  return best
}

/**
 * Both sides against their merge base, file by file: one side's change wins, the
 * same change on both is taken once, and two different changes are a conflict.
 */
const mergeTrees = (
  repo: Repo,
  ours: CommitSha,
  theirs: CommitSha,
): { readonly files: Files; readonly conflicts: readonly string[] } => {
  const base = filesAt(repo, mergeBase(repo, ours, theirs))
  const mine = filesAt(repo, ours)
  const yours = filesAt(repo, theirs)
  const files = new Map<string, Buffer>()
  const conflicts: string[] = []
  for (const at of allPaths(base, mine, yours)) {
    const [b, o, t] = [base.get(at), mine.get(at), yours.get(at)]
    const taken = same(o, t) || same(t, b) ? o : same(o, b) ? t : undefined
    if (!same(o, t) && !same(o, b) && !same(t, b)) conflicts.push(at)
    if (taken !== undefined) files.set(at, taken)
  }
  return { files, conflicts }
}

/** Where the trak's branch and the one it forked from last agreed — git's `forkPoint`. */
const forkPoint = (repo: Repo, worktree: Worktree, tip: CommitSha): CommitSha => {
  const forked = repo.forks.get(worktree.branch)
  const fork = forked === undefined ? undefined : repo.branches.get(forked)
  if (fork === undefined) return worktree.base
  const shared = mergeBase(repo, fork, tip)
  if (shared === undefined || shared === tip) return worktree.base
  return isAncestor(repo, worktree.base, shared) ? shared : worktree.base
}

/** The branch and its records, with every fork naming it moved to where it forked from — git's `releaseForks`. */
const forget = (repo: Repo, branch: BranchName): void => {
  const onward = repo.forks.get(branch)
  for (const [child, forked] of repo.forks) {
    if (forked !== branch || child === branch) continue
    if (onward === undefined) repo.forks.delete(child)
    else repo.forks.set(child, onward)
  }
  repo.branches.delete(branch)
  forgetRecords(repo, branch)
}

const forgetRecords = (repo: Repo, branch: BranchName): void => {
  repo.bases.delete(branch)
  repo.forks.delete(branch)
}

const checkedOut = (repo: Repo, at: string): boolean => repo.checkouts.has(at) && fs.existsSync(at)

// -- the port ---------------------------------------------------------------

const createWorktree = (
  repo: Repo,
  trakId: string,
  from: BranchName | undefined,
): Either.Either<Worktree, GitFailed> => {
  const at = worktreePathFor(repo.root, trakId)
  const branch = branchFor(trakId)
  if (checkedOut(repo, at)) {
    const base = repo.bases.get(branch) ?? repo.branches.get(branch)
    if (base !== undefined) return Either.right(worktreeFor(repo.root, trakId, base))
  }
  repo.checkouts.delete(at)
  if (fs.existsSync(at)) return Either.left(failed("create worktree", `'${at}' already exists`))
  if (!repo.branches.has(branch)) {
    const forked = from ?? repo.host
    const start = repo.branches.get(forked)
    if (start === undefined) return Either.left(failed("read base", `no branch named ${forked}`))
    repo.branches.set(branch, start)
    repo.bases.set(branch, start)
    repo.forks.set(branch, forked)
  } else if (!repo.forks.has(branch)) {
    repo.forks.set(branch, from ?? repo.host)
  }
  const tip = repo.branches.get(branch)
  const base = repo.bases.get(branch) ?? tip
  if (base === undefined) return Either.left(failed("read base", `no branch named ${branch}`))
  fs.mkdirSync(at, { recursive: true })
  writeTree(at, NOTHING, filesAt(repo, tip))
  repo.checkouts.add(at)
  return Either.right(worktreeFor(repo.root, trakId, base))
}

/** `createWorktree` for a branch that is there and a checkout that is not, and nothing else. */
const remakeCheckout = (
  repo: Repo,
  trakId: string,
): Either.Either<Worktree | undefined, GitFailed> => {
  const at = worktreePathFor(repo.root, trakId)
  // A directory standing is left alone whatever this layer remembers, so a flow that
  // builds its layers again over the same directory is not handed a checkout made again.
  if (fs.existsSync(at)) return Either.right(undefined)
  const branch = branchFor(trakId)
  if (!repo.branches.has(branch)) {
    return Either.left(
      failed(
        "remake checkout",
        `the checkout at ${at} is gone, and so is ${branch}, so there is nothing to make it again from`,
      ),
    )
  }
  return createWorktree(repo, trakId, undefined)
}

const commitWork = (
  repo: Repo,
  worktree: Worktree,
): Either.Either<CommitSha | undefined, GitFailed> => {
  if (checkedOut(repo, worktree.path)) {
    const tip = repo.branches.get(worktree.branch)
    if (tip === undefined) {
      return Either.left(failed("check checkout branch", `${worktree.branch} is gone`))
    }
    const files = snapshot(worktree.path)
    if (!sameFiles(files, filesAt(repo, tip))) {
      repo.branches.set(worktree.branch, commit(repo, [tip], files))
    }
  }
  const tip = repo.branches.get(worktree.branch)
  return Either.right(tip === undefined || tip === worktree.base ? undefined : tip)
}

const removeCheckout = (repo: Repo, worktree: Worktree): void => {
  if (checkedOut(repo, worktree.path)) fs.rmSync(worktree.path, { recursive: true, force: true })
  repo.checkouts.delete(worktree.path)
}

const removeWorktree = (repo: Repo, worktree: Worktree): void => {
  removeCheckout(repo, worktree)
  if (repo.branches.get(worktree.branch) === worktree.base) forget(repo, worktree.branch)
}

/** The branch a merge lands on, and the directory whose files move with it. */
const destination = (
  repo: Repo,
  into: MergeInto,
): Either.Either<{ readonly branch: BranchName; readonly dir: string }, GitFailed> =>
  MergeInto.$match(into, {
    Checkout: ({ worktree }) =>
      checkedOut(repo, worktree.path)
        ? Either.right({ branch: worktree.branch, dir: worktree.path })
        : Either.left(failed("read checkout branch", `${worktree.path} is not a checkout`)),
    Host: () => Either.right({ branch: repo.host, dir: repo.root }),
    Goal: () => Either.left(failed("fetch goal branch", "no remote in this world")),
  })

/** Both tips, or the git failure a missing one is. */
const tips = (
  repo: Repo,
  op: string,
  ours: BranchName,
  theirs: BranchName,
): Either.Either<readonly [CommitSha, CommitSha], GitFailed> => {
  const [a, b] = [repo.branches.get(ours), repo.branches.get(theirs)]
  if (a === undefined || b === undefined) {
    return Either.left(failed(op, `no branch named ${a === undefined ? ours : theirs}`))
  }
  return Either.right([a, b])
}

/**
 * `--no-ff`, decided whole before anything is written: a conflict, or uncommitted
 * work in a file the merge would change, leaves both branches and every file as
 * they were.
 */
const merge = (
  repo: Repo,
  into: MergeInto,
  branch: BranchName,
): Either.Either<MergeOutcome, GitFailed> =>
  Either.flatMap(destination(repo, into), (target) =>
    Either.flatMap(
      tips(repo, "merge", target.branch, branch),
      ([ours, theirs]): Either.Either<MergeOutcome, GitFailed> => {
        if (isAncestor(repo, theirs, ours)) return Either.right(MergeOutcome.Merged({ sha: ours }))
        const { files, conflicts } = mergeTrees(repo, ours, theirs)
        const [first, ...rest] = conflicts
        if (first !== undefined)
          return Either.right(MergeOutcome.Conflicted({ paths: [first, ...rest] }))
        const before = filesAt(repo, ours)
        const onDisk = snapshot(target.dir)
        const blocked = allPaths(before, files).filter(
          (at) => !same(before.get(at), files.get(at)) && !same(before.get(at), onDisk.get(at)),
        )
        if (blocked.length > 0) {
          return Either.left(
            failed("merge", `uncommitted changes would be overwritten: ${blocked.join(", ")}`),
          )
        }
        const sha = commit(repo, [ours, theirs], files)
        repo.branches.set(target.branch, sha)
        writeTree(target.dir, before, files)
        return Either.right(MergeOutcome.Merged({ sha }))
      },
    ),
  )

const intoBranch = (repo: Repo, into: MergeInto): BranchName =>
  MergeInto.$match(into, {
    Checkout: ({ worktree }) => worktree.branch,
    Host: () => repo.host,
    Goal: ({ branch }) => BranchName.make(`origin/${branch}`),
  })

const wouldConflict = (
  repo: Repo,
  into: MergeInto,
  branch: BranchName,
): Either.Either<boolean, GitFailed> =>
  Either.map(
    tips(repo, "predict merge", intoBranch(repo, into), branch),
    ([ours, theirs]) =>
      !isAncestor(repo, theirs, ours) && mergeTrees(repo, ours, theirs).conflicts.length > 0,
  )

/** `git status --porcelain`, trimmed: tracked changes first, then untracked files. */
const dirty = (
  repo: Repo,
  checkout: Pick<Worktree, "path" | "branch"> | undefined,
): Either.Either<readonly string[], GitFailed> => {
  const dir = checkout?.path ?? repo.root
  if (!fs.existsSync(dir)) return Either.left(failed("read status", `${dir} is not there`))
  const now = snapshot(dir)
  const then = filesAt(repo, repo.branches.get(checkout?.branch ?? repo.host))
  const paths = allPaths(now, then)
  const tracked = paths.flatMap((at) =>
    !then.has(at)
      ? []
      : !now.has(at)
        ? [`D ${at}`]
        : same(now.get(at), then.get(at))
          ? []
          : [`M ${at}`],
  )
  const untracked = paths.filter((at) => !then.has(at)).map((at) => `?? ${at}`)
  return Either.right([...tracked, ...untracked])
}

/** The slice, or the one file of it `only` names. */
const changes = (repo: Repo, range: ChangeRange, only: string | undefined): Changes => {
  const whole = slice(repo, range)
  return only === undefined ? whole : { files: whole.files.filter((file) => file.path === only) }
}

const slice = (repo: Repo, range: ChangeRange): Changes =>
  ChangeRange.$match(range, {
    Commits: ({ from, to }) =>
      repo.commits.has(from) && repo.commits.has(to)
        ? diffOf(filesAt(repo, from), filesAt(repo, to))
        : { files: [] },
    Branch: ({ worktree }) => {
      const tip = repo.branches.get(worktree.branch)
      if (tip === undefined) return { files: [] }
      return diffOf(filesAt(repo, forkPoint(repo, worktree, tip)), filesAt(repo, tip))
    },
    Uncommitted: ({ worktree }) =>
      checkedOut(repo, worktree.path)
        ? diffOf(filesAt(repo, repo.branches.get(worktree.branch)), snapshot(worktree.path))
        : { files: [] },
  })

const hostStatus = (repo: Repo): HostStatus => ({
  head: HostHead.Branch({ name: repo.host }),
  origin: false,
})

/** What git answers with no `origin`: a branch that tracks nothing is refused first. */
const stashAnd = (repo: Repo, press: StashedPress): StashedSync => {
  const refused = (press === "pull" ? pullRefusal : reconcileRefusal)(hostStatus(repo), [])
  return refused === undefined ? StashedSync.Restored() : StashedSync.Refused({ refusal: refused })
}

/**
 * The checkout's files as one id: a hash over every path and its bytes, in path order.
 * Not git's tree id, and nothing compares it to one — only to itself, over the same files.
 */
const workingTree = (checkout: string): Either.Either<string, GitFailed> => {
  if (!fs.existsSync(checkout)) {
    return Either.left(failed("hash working tree", `${checkout} is not there`))
  }
  const hash = createHash("sha1")
  for (const [at, content] of [...snapshot(checkout)].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`${at}\0${String(content.length)}\0`).update(content)
  }
  return Either.right(hash.digest("hex"))
}

/** The host checkout's files, sorted as `ls-files` sorts them. */
const projectFiles = (repo: Repo): readonly string[] =>
  [...snapshot(repo.root).keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** `git grep -F -i -n` over the host checkout's files, read off disk. */
const grepProject = (repo: Repo, text: string, limit: number): ProjectGrep => {
  const matches: ProjectMatch[] = []
  const needle = text.toLowerCase()
  for (const [at, content] of [...snapshot(repo.root)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const lines = content.toString("utf8").split("\n")
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(needle)) continue
      if (matches.length === limit) return { matches, cut: true }
      matches.push({ path: at, line: index + 1, text: line })
    }
  }
  return { matches, cut: false }
}

/**
 * One operation, run whole. Every body is synchronous, so two drives forked onto
 * fibers cannot interleave inside one — which git gets from its own locks.
 */
const whole = <A>(
  op: string,
  body: () => Either.Either<A, GitFailed>,
): Effect.Effect<A, GitFailed> =>
  Effect.try({
    try: body,
    catch: (cause) => failed(op, cause instanceof Error ? cause.message : String(cause)),
  }).pipe(Effect.flatMap((answer) => answer))

const shape = (repo: Repo): VcsShape => ({
  createWorktree: (trakId, from) =>
    whole("create worktree", () => createWorktree(repo, trakId, from)),
  commitWork: (worktree) => whole("commit", () => commitWork(repo, worktree)),
  removeWorktree: (worktree) =>
    whole("remove worktree", () => Either.right(removeWorktree(repo, worktree))),
  // Every checkout is on this machine, so there is no sandbox a removal could skip.
  removalFor: (_worktree, kept) => Effect.succeed(Removal.Reach({ kept })),
  removeCheckout: (worktree) =>
    whole("remove checkout", () => Either.right(removeCheckout(repo, worktree))),
  deleteBranch: (worktree) =>
    whole("delete branch", () => Either.right(forget(repo, worktree.branch))),
  forgetTrak: (trakId) =>
    whole("forget records", () => Either.right(forgetRecords(repo, branchFor(trakId)))),
  // Every checkout is on this machine, sharing the one history.
  fetchWork: () => Effect.void,
  carryTarget: () => Effect.void,
  carryOut: () => Effect.void,
  carryIn: () => Effect.void,
  leftBehind: () => Effect.succeed(undefined),
  hasCheckout: (trakId) =>
    whole("read checkout", () =>
      Either.right(checkedOut(repo, worktreePathFor(repo.root, trakId))),
    ),
  hasBranch: (trakId) => Effect.sync(() => repo.branches.has(branchFor(trakId))),
  branchTip: (trakId) => Effect.sync(() => repo.branches.get(branchFor(trakId))),
  // No remote in this world, so its branches are the record.
  branchFromOrigin: () => Effect.void,
  remakeCheckout: (trakId) => whole("remake checkout", () => remakeCheckout(repo, trakId)),
  merge: (into, branch) => whole("merge", () => merge(repo, into, branch)),
  wouldConflict: (into, branch) => whole("predict merge", () => wouldConflict(repo, into, branch)),
  // No remote in this world, so no pull request ever held the branch.
  moveOntoBase: () => Effect.succeed(BranchMove.Unmoved()),
  contains: (into, branch) =>
    whole("contains", () =>
      Either.map(tips(repo, "contains", intoBranch(repo, into), branch), ([ours, theirs]) =>
        isAncestor(repo, theirs, ours),
      ),
    ),
  createGoalBranch: () => Effect.fail(failed("create goal branch", "no remote in this world")),
  pushGoal: () => Effect.void,
  removeGoalCheckout: () => Effect.void,
  hostBranch: () => Effect.succeed(repo.host),
  defaultBranch: () => Effect.succeed(undefined),
  originTip: () => Effect.succeed(undefined),
  dirty: (checkout) => whole("read status", () => dirty(repo, checkout)),
  workingTree: (checkout) =>
    whole("hash working tree", () => workingTree(checkout?.path ?? repo.root)),
  headTree: () => Effect.fail(failed("read head tree", "no tree ids in this world")),
  publishProofs: () => Effect.fail(failed("publish proofs", "no remote in this world")),
  readProofs: () => Effect.succeed(undefined),
  ensureIgnored: () =>
    // Where git keeps a main checkout's common directory. `snapshot` skips `.git`, so
    // writing it leaves the tree as clean as git reports it.
    whole("update info/exclude", () => {
      const file = path.join(repo.root, ".git", "info", "exclude")
      const written = ignoreFileWith(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")
      if (written !== undefined) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, written)
      }
      return Either.right(undefined)
    }),
  changes: (range, only) => whole("read changes", () => Either.right(changes(repo, range, only))),
  hostStatus: () => Effect.sync(() => hostStatus(repo)),
  fetch: () => Effect.succeed(SyncRefusal.NoOrigin()),
  pull: () => Effect.sync(() => pullRefusal(hostStatus(repo), [])),
  reconcile: () => Effect.sync(() => reconcileRefusal(hostStatus(repo), [])),
  stashAnd: (press) => Effect.sync(() => stashAnd(repo, press)),
  push: () => Effect.sync(() => pushRefusal(hostStatus(repo))),
  projectFiles: () => Effect.sync(() => ({ root: repo.root, paths: projectFiles(repo) })),
  grepProject: (text, limit) => Effect.sync(() => grepProject(repo, text, limit)),
})

/**
 * The fake over `repoDir`, whose files as they stand become `main`'s one commit.
 * Nothing in it runs git, and it needs no `.git` to be there.
 */
export const SnapshotVcsLayer = (repoDir: string): Layer.Layer<Vcs, GitFailed> =>
  Layer.effect(
    Vcs,
    whole("find repository", () => {
      const repo: Repo = {
        // Resolved, as `git rev-parse --show-toplevel` resolves it: the temp directory
        // is behind a symlink on macOS, and a checkout's path is built from this.
        root: fs.realpathSync(repoDir),
        host: BranchName.make("main"),
        commits: new Map(),
        branches: new Map(),
        bases: new Map(),
        forks: new Map(),
        checkouts: new Set(),
      }
      repo.branches.set(repo.host, commit(repo, [], snapshot(repo.root)))
      return Either.right(shape(repo))
    }),
  )
