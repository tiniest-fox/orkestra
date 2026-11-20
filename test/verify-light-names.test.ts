// `.orkestra/checks/verify-light.sh`'s test stage where a change names more files than a
// pipe holds, or where the passed tree leaves generated files out. Apart from
// `verify-light.test.ts` so the two cases, the slowest of its runs of the check, go to a
// worker of their own. The repository and the run are `test/support/verify-light.ts`'s.

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { git } from "./support/git.js"
import { branch, testStage, verifyLight } from "./support/verify-light.js"

/**
 * More files under `at` than a pipe holds the names of: a study's worth of generated files,
 * or a step that touched as many documents. Each name is near the 255-byte limit, so 500
 * of them hold about 110 KiB, past a 64 KiB pipe, for a sixth of the check's per-path work
 * that 3000 short names cost.
 */
const many = (at: string): void => {
  mkdirSync(at, { recursive: true })
  const long = "a-name-long-enough-to-fill-the-pipe-sooner-".repeat(5)
  for (let i = 0; i < 500; i += 1) writeFileSync(join(at, `${long}${String(i)}.md`), "x\n")
}

/**
 * The tree the engine keeps a pass against for a check with `ignores_linguist_generated:`:
 * the checkout as it would be committed, less the files `.gitattributes` marks generated.
 */
const withoutGenerated = (dir: string): string => {
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(tmpdir(), `index-${String(process.pid)}`),
  }
  const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" })
  run("read-tree", "HEAD")
  run("add", "-A")
  run("rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ":(attr:linguist-generated)")
  return run("write-tree").trim()
}

describe("verify-light with many changed names", () => {
  // The engine hands over the tree it kept the pass against, which leaves generated files
  // out, so measured against the checkout every one of them would read as changed.
  it("selects by what changed against a passed tree that left the generated files out", () => {
    const { dir } = branch()
    writeFileSync(join(dir, ".gitattributes"), "studies/** linguist-generated\n")
    many(join(dir, "studies"))
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "a study")
    const passed = withoutGenerated(dir)
    writeFileSync(
      join(dir, "src", "sum.ts"),
      "export const sum = (a: number, b: number) => a + b + 0\n",
    )
    expect(testStage(verifyLight(dir, passed))).toBe(
      "✓ pnpm test — test files: 1 ran, 0 already proven",
    )
  }, 60_000)

  // More changed names than a pipe holds reach `related` before it reads them all.
  it("selects by what changed when more files changed than a pipe holds the names of", () => {
    const { dir, passed } = branch()
    many(join(dir, "notes"))
    writeFileSync(
      join(dir, "src", "sum.ts"),
      "export const sum = (a: number, b: number) => a + b + 0\n",
    )
    expect(testStage(verifyLight(dir, passed))).toBe(
      "✓ pnpm test — test files: 1 ran, 0 already proven",
    )
  }, 60_000)
})
