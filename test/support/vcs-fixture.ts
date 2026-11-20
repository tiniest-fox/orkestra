// An isolated git repo for a flow test, as a scoped resource.
//
// Scoped, not `withTestRepo(f)`: the repo has to outlive the *body* of the test,
// not the construction of its layers. A `withTestRepo(f)` callback releases the
// directory as soon as it has built the `Vcs` layer, so every worktree the test
// then asks for is created against a repo that is already gone — and since the
// temp dir sits inside this checkout, `git` walks up and makes the branch in
// orkestra itself. Acquire/release ties the lifetime to `Effect.scoped` in
// `flow.ts`, which closes after the body and its transcript have run.
//
// The repo lives in the OS temp dir for the same reason: outside any checkout,
// a stray `git` that finds no `.git` fails loudly instead of finding ours.
//
// `plainRepo` is the same project with no `.git` at all, for the fake `Vcs` in
// `vcs-snapshots.ts`, which keeps its history in memory. Five git processes a
// test cheaper, and a git call that slips in fails instead of finding a
// repository.

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect, type Scope } from "effect"
import { IGNORED_PATHS } from "../../src/vcs/logic/paths.js"

/** The directory the walk-up looks for — the same name `library-fs.ts` resolves. */
const DIR = ".orkestra"

const git = (repoDir: string, ...args: readonly string[]): void => {
  execFileSync("git", args, { cwd: repoDir, stdio: "pipe" })
}

/** The files every test project starts with, committed or not. */
const writeProject = (repoDir: string): void => {
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Test Repo\n")
  // What makes this look like a project Orkestra has run in: the walk-up every
  // adapter shares finds `.orkestra/` or fails, and `NodeWorkspaceLayer` needs it to
  // know where a merged trak's record goes. Empty and uncommitted — git keeps no
  // empty directory, and nothing here reads a definition off disk.
  fs.mkdirSync(path.join(repoDir, DIR), { recursive: true })
  // Committed by `testRepo`: it keeps `finishWorktree`'s `git add -A` from committing
  // the projection along with the work in a flow that never calls `ensureIgnored`. A
  // project an older engine ran in looks like this; today `Vcs.ensureIgnored` writes
  // the same lines to `info/exclude` instead, which its own contract test covers.
  fs.writeFileSync(path.join(repoDir, ".gitignore"), `${IGNORED_PATHS.join("\n")}\n`)
}

const initRepo = (): string => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "orkestra-test-repo-"))

  git(repoDir, "init", "--initial-branch=main")
  git(repoDir, "config", "user.email", "test@example.com")
  git(repoDir, "config", "user.name", "Test")
  writeProject(repoDir)
  git(repoDir, "add", "README.md", ".gitignore")
  git(repoDir, "commit", "-m", "initial")

  return repoDir
}

/**
 * Removing the directory removes the worktrees with it — they live under
 * `.orkestra/.worktrees` *inside* the repo, and the repo's own metadata goes in
 * the same sweep, so there is nothing left for `git worktree remove` to tidy.
 */
const cleanupRepo = (repoDir: string): void => {
  try {
    fs.rmSync(repoDir, { recursive: true, force: true })
  } catch (e) {
    console.warn(`Failed to clean up test repo: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * A fresh git repo with one commit on `main`, removed when the scope closes.
 */
export const testRepo: Effect.Effect<string, never, Scope.Scope> = Effect.acquireRelease(
  Effect.sync(initRepo),
  (repoDir) => Effect.sync(() => cleanupRepo(repoDir)),
)

/**
 * The same three files in a fresh directory with no `.git`, removed when the scope
 * closes — what the fake `Vcs` takes as its first commit.
 */
export const plainRepo: Effect.Effect<string, never, Scope.Scope> = Effect.acquireRelease(
  Effect.sync(() => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "orkestra-plain-repo-"))
    writeProject(repoDir)
    return repoDir
  }),
  (repoDir) => Effect.sync(() => cleanupRepo(repoDir)),
)
