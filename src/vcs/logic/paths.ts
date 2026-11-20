// logic: where a trak's checkout and branch go. Pure, and the only place that
// decides either — the adapter asks, and the tests assert against the same answer.

import { BranchName, type CommitSha, WorktreePath, type Worktree } from "../types/worktree.js"

/**
 * Inside `.orkestra` and dot-prefixed, beside `.database` and `.logs`: runtime
 * data the tool owns, next to the policy a human edits. Gitignored, because a
 * checkout of a repository is not part of that repository.
 */
const WORKTREE_BASE = ".orkestra/.worktrees"

/**
 * Absolute, always — `repoRoot` comes from `git rev-parse --show-toplevel`.
 *
 * A relative path would be resolved against `process.cwd()`, which is not the
 * repository root whenever `ork` is run from a subdirectory. The path is handed
 * to git *and* used as the `cwd` of every agent turn, so the two would disagree
 * about which directory the trak is working in.
 *
 * Joined by hand rather than with `node:path`: this is `logic/`, and the rule
 * that keeps the filesystem in `adapters/` does not make an exception for the
 * cheap half of it.
 *
 * Separate from `worktreeFor` because the adapter has to name the path *before*
 * it can know the base: whether a checkout is already registered is what decides
 * where the base comes from. Asking for the whole `Worktree` at that point meant
 * passing a `CommitSha.make("unresolved")` in to read `.path` back off it — a
 * brand asserting something false about a value nothing had resolved yet.
 */
export const worktreePathFor = (repoRoot: string, trakId: string): WorktreePath =>
  WorktreePath.make(`${repoRoot}/${WORKTREE_BASE}/${trakId}`)

/** What a goal's checkout is named under, which no trak id starts with. */
const GOAL_PREFIX = "goal-"

/**
 * The trak whose checkout `cwd` is, or sits inside, or `undefined` for any other
 * directory — the project checkout, a goal's checkout, anywhere else. What decides
 * whether a spawn runs in the trak's sandbox: under a runner, the sandbox holds the
 * checkout at this same path.
 */
export const trakOfCheckout = (repoRoot: string, cwd: string): string | undefined => {
  const base = `${repoRoot}/${WORKTREE_BASE}/`
  if (!cwd.startsWith(base)) return undefined
  const id = cwd.slice(base.length).split("/")[0] ?? ""
  return id === "" || id.startsWith(GOAL_PREFIX) ? undefined : id
}

/**
 * The sandbox that holds the project rather than a trak, under an external store: its checkout
 * is the cache checkout's path, moved to `origin`'s default branch before each spawn. No
 * minted trak id is one word, so no trak's sandbox shares the id.
 */
export const PROJECT_SANDBOX = "project"

/** A directory in a trak's checkout: the trak, and the directory as its sandbox spells it. */
export interface CheckoutPlace {
  readonly trak: string
  readonly path: string
}

/**
 * The trak whose checkout a directory is in, under any spelling of the project, and the
 * directory under the first spelling — the resolved one, which the sandbox mirrors.
 * `paths` are spellings of the one directory, its resolved one among them where it has
 * one. Every checkout path is built from git's toplevel, which resolves symlinks, while
 * the project may have been opened through one; comparing one spelling of each would
 * read a sandboxed trak's directory as this machine's with nothing saying so.
 */
export const checkoutPlaceOf = (
  projects: readonly [string, ...string[]],
  paths: readonly string[],
): CheckoutPlace | undefined => {
  const [resolved] = projects
  for (const project of projects) {
    for (const path of paths) {
      const trak = trakOfCheckout(project, path)
      if (trak !== undefined) return { trak, path: `${resolved}${path.slice(project.length)}` }
    }
  }
  return undefined
}

/**
 * The engine's checkout of a goal branch, beside its traks' checkouts. Prefixed so no
 * trak id can name it.
 */
export const goalCheckoutPathFor = (repoRoot: string, goal: string): WorktreePath =>
  WorktreePath.make(`${repoRoot}/${WORKTREE_BASE}/${GOAL_PREFIX}${goal}`)

/**
 * Everything Orkestra keeps out of the repository it is working on, as
 * `.gitignore` patterns — appended to the repository's `info/exclude` by
 * `Vcs.ensureIgnored`. Projects that ran an older engine also carry them in their
 * `.gitignore`, which nothing here reads or edits.
 *
 * **Parent-qualified**, every one: a bare `.database/` is a pattern matching any
 * directory of that name anywhere in the project, so each names `.orkestra` as
 * the parent. Each is prefixed with a double star and a slash, so that parent may
 * sit at any depth — a nested or vendored `.orkestra/` has its runtime data
 * ignored too — and so the line matches verbatim in an exclude file that already
 * carries it that way, which is what `ensureIgnored`'s whole-line comparison needs to avoid
 * appending duplicates.
 *
 * One list rather than a rule per directory, which is why it names paths two
 * other modules own — the event log's `.database/` and the projection's
 * `.trak/`. What a tool leaves in your repository is one statement, and it is
 * worth being able to read it in one place.
 */
export const IGNORED_PATHS: readonly string[] = [
  "**/.orkestra/.trak/",
  "**/.orkestra/.database/",
  // The process registry each checkout holds — a trak's, or the project's — and the temporary file it is written
  // to before the rename — which a crash mid-write leaves behind.
  "**/.orkestra/.processes.json*",
  // The corpus: a folder per trak whose checkout is gone, rewritable from the logs at
  // any time. Not
  // committed, because it is derived — and because a record carries every artifact a
  // trak filed, which is a person's working notes rather than the repository's.
  "**/.orkestra/records/",
  // What `snapshot_logs` writes into a trak's checkout: copies of the engine's logs, for an
  // agent to query, which are never part of the work.
  "**/.orkestra/.snapshots/",
  // The files a person sent with a message, which the checkout holds as the only copy and
  // the work never commits.
  "**/.orkestra/.attachments/",
  // Where the engine says whether a checkout's setup script has finished, for the hook
  // that holds a turn's commands until it has.
  "**/.orkestra/.setup/",
  `**/${WORKTREE_BASE}/`,
  // The one entry a person writes rather than the tool: a private mirror of
  // `.orkestra/`, merged over the team's definitions at load. A fresh clone has it
  // in `info/exclude` from the first trak's start; one a person writes before then
  // shows in `git status` until it.
  "**/.orkestra/.local/",
  // What a project's tools cache inside the repository — pnpm's store, which a container
  // engine once put there to share the checkout's filesystem. A checkout may still hold one,
  // and unignored it is tens of thousands of untracked files for a pull to stash and a commit
  // to sweep up.
  "**/.orkestra/.cache/",
]

/**
 * The comment the entries are appended under, so they are attributable — and
 * only when the file does not already carry it, which is what keeps a project
 * that has been through this before from growing a second Orkestra section.
 */
export const IGNORE_HEADER = "# Orkestra runtime data"

/**
 * An ignore file with whatever is missing appended, or `undefined` when nothing is.
 *
 * Matched on whole trimmed lines rather than on `includes`: a substring test
 * would read `.orkestra/.database/` as already covered by a longer line that
 * merely contains it, and the failure would be silent in the direction that
 * commits a database into someone's repository.
 *
 * The header only comes with the first append. A file that already carries it
 * has been here before, and a second copy is noise.
 */
export const ignoreFileWith = (existing: string): string | undefined => {
  const lines = new Set(existing.split("\n").map((l) => l.trim()))
  const missing = IGNORED_PATHS.filter((p) => !lines.has(p))
  if (missing.length === 0) return undefined
  const added = lines.has(IGNORE_HEADER) ? missing : [IGNORE_HEADER, ...missing]
  // A blank line before, and only when there is something to separate from:
  // this is appended to a file a human wrote and will read again.
  const prefix = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
  return `${existing}${prefix}${added.join("\n")}\n`
}

// seed: begin
/** A remote by name and fetch URL, as the project checkout configures it. */
export interface Remote {
  readonly name: string
  readonly url: string
}

/**
 * The remotes in `git config --get-regexp '^remote\..*\.url$'`'s listing, each line
 * `remote.<name>.url <url>`. A name may hold dots, so it is everything between the
 * section and the variable rather than one segment.
 */
export const remotesIn = (listing: string): readonly Remote[] =>
  listing
    .split("\n")
    .filter((line) => line.includes(" "))
    .map((line) => {
      const space = line.indexOf(" ")
      const key = line.slice(0, space)
      return { name: key.slice("remote.".length, -".url".length), url: line.slice(space + 1) }
    })

/**
 * The URL with any user and password taken out of an `http(s)` one. A checkout cloned
 * with a token in its URL would otherwise write that token into every sandbox; a push
 * there authenticates through the credential helper instead. An SSH URL's user is a
 * login name rather than a credential, and is kept.
 */
export const withoutCredentials = (url: string): string =>
  url.replace(/^(https?:\/\/)[^/@]*@/i, "$1")

/**
 * The credential helper a push or fetch to GitHub from a sandbox asks: `GH_TOKEN`, which the
 * runner's `pass:` puts in the exec's environment, read when git asks and never stored.
 * Git appends the operation to the command, so `store` and `erase` print nothing and
 * succeed. Scoped to GitHub, so the token is never offered to another host.
 */
export const GITHUB_HELPER = [
  "credential.https://github.com.helper",
  '!f() { if test "$1" = get && test -n "${GH_TOKEN:-}"; then echo username=x-access-token; echo "password=$GH_TOKEN"; fi; }; f',
] as const

/**
 * GitHub's SSH spellings, pushed over HTTPS instead: the sandbox holds no SSH key, and
 * `GH_TOKEN` authenticates only HTTPS. Fetches keep the URL as the checkout has it, except
 * the seed fetch and the project sandbox's fetch before a spawn, which read the same
 * spellings as HTTPS for their one command. Each
 * is beside the pattern matching exactly it, which `config --replace-all` replaces.
 */
export const GITHUB_SSH = [
  ["git@github.com:", "^git@github\\.com:$"],
  ["ssh://git@github.com/", "^ssh://git@github\\.com/$"],
] as const

// seed: end

/**
 * Named after the trak, so a human finding `trak/<id>` in `git branch` knows
 * what made it. Separate from `worktreeFor` for the same reason the path is: the
 * adapter asks whether this branch already exists before it has a base, because
 * an orphaned one is what it adopts instead of creating.
 */
export const branchFor = (trakId: string): BranchName => BranchName.make(`trak/${trakId}`)

/** The trak a branch was named for, or `undefined` for any branch `branchFor` did not make. */
export const trakOfBranch = (branch: BranchName): string | undefined => {
  const prefix = "trak/"
  if (!branch.startsWith(prefix)) return undefined
  const id = branch.slice(prefix.length)
  return id === "" || id.includes("/") ? undefined : id
}

/**
 * Where the branch started, written down as a ref so it survives the process.
 *
 * Keyed on the *branch* rather than the trak id because that is what a caller
 * holding a `Worktree` has, and because the fact is about the branch: this ref
 * is the answer to "what does an empty `trak/<id>` look like", and it is
 * meaningless once the branch is gone.
 *
 * Under `refs/orkestra/` and therefore not under `refs/heads/`: it must not show
 * up in `git branch`, must not be checked out, and is not pushed or fetched by
 * any default refspec. It doubles as a reachability anchor, so the base commit
 * cannot be garbage-collected out from under a trak that is still running.
 */
export const baseRefFor = (branch: BranchName): string => `refs/orkestra/base/${branch}`

/**
 * Which branch this one forked from, written down as a **symbolic** ref — so it
 * stores the name and resolves to wherever that branch is *today*.
 *
 * That is the whole reason it exists beside `baseRefFor`, which stores a sha and
 * is frozen by design. Reading a branch's changes means diffing from where it
 * and its parent last agreed, and after the parent's work has been merged in
 * that point is no longer the fork commit — it is further along the parent. Only
 * a moving end can say so, and a sha cannot move.
 *
 * When the branch it names is deleted, it is moved to that branch's own fork first —
 * see `releaseForks` — since a symbolic ref to nothing is what `git fsck` calls corrupt.
 *
 * Under `refs/orkestra/` for `baseRefFor`'s reasons, and **deleted with
 * `--no-deref`** wherever it is deleted: `git update-ref -d` on a symbolic ref
 * follows it and deletes the branch it names, which here is `main`.
 */
export const forkRefFor = (branch: BranchName): string => `refs/orkestra/fork/${branch}`

/**
 * Where a sandbox's uncommitted and untracked files are kept while it is made again: one
 * commit over the branch tip, here and in the sandbox. Deleted once they are put back, so
 * the ref being here means a remake left them behind — the failure names it — and no
 * later capture overwrites it until a person applies or deletes it.
 */
export const carriedRefFor = (trakId: string): string => `refs/orkestra/carried/${trakId}`

/**
 * `base` is an argument rather than something derived here, because it is the
 * one field of a `Worktree` that is not a naming decision — only git knows where
 * the branch started. Assembling the whole value here anyway keeps a `Worktree`
 * built in exactly one place.
 */
export const worktreeFor = (repoRoot: string, trakId: string, base: CommitSha): Worktree => ({
  path: worktreePathFor(repoRoot, trakId),
  branch: branchFor(trakId),
  base,
})
