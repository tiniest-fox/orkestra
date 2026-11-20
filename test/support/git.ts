// Reading a flow test's real repository, for the assertions a fake Vcs cannot make.
//
// `test/support/vcs-fixture.ts` builds the repository; this is how a test looks
// at what the engine did to it. Both themes that need real git — worktrees and
// spawn — read it the same way, which is why these are here rather than copied.

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Worktree } from "../../src/vcs/index.js"
import type { Trak } from "../../src/workflow/domain/trak.js"

export const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/** The parent repo of a linked worktree, which is where its branch lives. */
export const repoOf = (worktree: string): string =>
  path.dirname(git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"))

/**
 * Loud rather than optional-chained: every assertion using this is about a
 * worktree that exists, so "there wasn't one" is a failure with a name rather
 * than an `undefined` turning up three lines later.
 */
export const worktreeOf = (trak: Trak): Worktree => {
  const worktree = trak.worktree
  if (worktree === undefined) throw new Error(`trak ${trak.id} has no worktree`)
  return worktree
}

/** What a step writing code leaves behind, without needing an agent that writes. */
export const writeWork = (worktree: Worktree, name: string, content: string): void => {
  fs.writeFileSync(path.join(worktree.path, name), content)
}

/** Is it in this checkout? Which is how a test reads what a branch started from. */
export const inWorktree = (worktree: Worktree, name: string): boolean =>
  fs.existsSync(path.join(worktree.path, name))

/**
 * What an agent opening that file would read. Loud when it is not there, for
 * `worktreeOf`'s reason: a test asserting on the text is about a file that exists.
 */
export const readInWorktree = (worktree: Worktree, name: string): string =>
  fs.readFileSync(path.join(worktree.path, name), "utf8")

/**
 * The same command, with a non-zero exit as an answer rather than a throw.
 *
 * Exactly one caller needs it and it is the one below: a merge that conflicts is
 * git *answering*, and `execFileSync` cannot tell that from the command being
 * wrong.
 */
const gitAnswering = (cwd: string, ...args: readonly string[]): string => {
  try {
    return git(cwd, ...args)
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

/**
 * What a step that resolves a conflict does, standing in for the agent that would.
 *
 * The destination comes **inward**, into the trak's own checkout, and the merge is
 * committed there — which is what makes the outward merge afterwards trivial. A
 * test that merely wrote the settled content instead would leave the two branches
 * still disagreeing, and the second press would conflict exactly as the first did.
 */
export const resolveInward = (
  worktree: Worktree,
  from: string,
  settled: Readonly<Record<string, string>>,
): void => {
  gitAnswering(worktree.path, "merge", "--no-verify", "-m", `Merge ${from}`, from)
  for (const [name, content] of Object.entries(settled)) {
    fs.writeFileSync(path.join(worktree.path, name), content)
  }
  git(worktree.path, "add", "-A")
  git(worktree.path, "commit", "--no-verify", "-m", `Merge ${from}`)
}

/** A commit made inside a checkout, the way an agent working in one would. */
export const commitInWorktree = (worktree: Worktree, message: string): void => {
  git(worktree.path, "add", "-A")
  git(worktree.path, "commit", "--no-verify", "-m", message)
}

/**
 * The host repository's own line moving on, after a trak has branched off it.
 *
 * Which is the only way a test can tell one base from another: a trak's branch
 * and the `HEAD` it came from are the same commit until something moves.
 */
export const commitOnHost = (repoDir: string, name: string, content: string): void => {
  fs.writeFileSync(path.join(repoDir, name), content)
  git(repoDir, "add", name)
  git(repoDir, "commit", "-m", `add ${name}`)
}

/** A bare remote for a test repository, and a second clone of it. */
export interface Origin {
  /** The bare repository the test repo now has as `origin`, with `main` pushed and tracked. */
  readonly origin: string
  /** Somebody else's clone — how a commit reaches `origin` that the test repo has not fetched. */
  readonly elsewhere: string
  /** Remove both. Neither is inside the test repo, so its own cleanup does not reach them. */
  readonly remove: () => void
}

/**
 * Give `repoDir` an `origin`. Both repositories live outside it, so neither reads as
 * untracked work in the tree under test.
 */
export const addOrigin = (repoDir: string): Origin => {
  const around = fs.mkdtempSync(path.join(os.tmpdir(), "orkestra-origin-"))
  const origin = path.join(around, "origin.git")
  git(around, "init", "--quiet", "--bare", "--initial-branch=main", origin)
  git(repoDir, "remote", "add", "origin", origin)
  git(repoDir, "push", "--quiet", "--set-upstream", "origin", "main")
  const elsewhere = path.join(around, "elsewhere")
  git(around, "clone", "--quiet", origin, elsewhere)
  git(elsewhere, "config", "user.email", "elsewhere@example.com")
  git(elsewhere, "config", "user.name", "Elsewhere")
  return {
    origin,
    elsewhere,
    remove: () => fs.rmSync(around, { recursive: true, force: true }),
  }
}

/** Somebody else's commit, pushed to `origin` and not yet fetched by the test repo. */
export const landElsewhere = (from: Origin, name: string): void => {
  git(from.elsewhere, "pull", "--quiet", "--ff-only")
  commitOnHost(from.elsewhere, name, `${name}\n`)
  git(from.elsewhere, "push", "--quiet", "origin", "main")
}
