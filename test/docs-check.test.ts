// `pnpm docs:check --changed-since <ref>`, driven the way a reviewer drives it: the
// script on `tsx`, in a repository of its own, stdout read back whole.
//
// At the root beside `jev.test.ts` for the same reason: an entry-point script that is
// neither a flow nor a contract. The gate half of the script is exercised by `pnpm
// verify` on every run; only the listing needs a repository built to order, because
// what it prints depends on a diff.

import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SCRIPT = fileURLToPath(new URL("../src/docs-check.ts", import.meta.url))
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url))

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/**
 * A repository holding the reference set the listing reads — the two root documents,
 * `references/` and a skill — every one of them naming `references/hosting.md`, plus a
 * vendored skill and a `notes/` file that name it too and must not be reported.
 */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "docs-check-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "test")
  mkdirSync(join(dir, "references"))
  mkdirSync(join(dir, ".agents", "skills", "hosting"), { recursive: true })
  mkdirSync(join(dir, ".agents", "skills", "atelier"), { recursive: true })
  mkdirSync(join(dir, "notes"))
  writeFileSync(join(dir, "README.md"), "# Repo\n\nHow to host: `references/hosting.md`.\n")
  writeFileSync(
    join(dir, "CLAUDE.md"),
    [
      "# CLAUDE.md",
      "",
      "See references/hosting.md and `references/hosting.md.bak` for the rest.",
      "Also `.orkestra/COMPOSITION.md`, which the composer reads.",
      "",
      "The old path was `references/host.md`. // docs-check-ignore: an example",
    ].join("\n"),
  )
  writeFileSync(join(dir, "references", "hosting.md"), "# Hosting\n")
  writeFileSync(
    join(dir, ".agents", "skills", "hosting", "SKILL.md"),
    "Start from references/hosting.md, then read references/.\n",
  )
  writeFileSync(join(dir, ".agents", "skills", "atelier", "SKILL.md"), "references/hosting.md\n")
  writeFileSync(join(dir, "notes", "IDEAS.md"), "- rewrite references/hosting.md\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "base")
  return dir
}

interface Run {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

const list = (cwd: string, ...args: readonly string[]): Run => {
  const child = spawnSync(TSX, [SCRIPT, "--changed-since", ...args], { cwd, encoding: "utf8" })
  return { stdout: child.stdout, stderr: child.stderr, status: child.status ?? -1 }
}

describe("docs:check --changed-since", () => {
  it("finds a changed file outside the gate's roots wherever the reference set names it", () => {
    const dir = repository()
    writeFileSync(join(dir, "references", "hosting.md"), "# Hosting\n\nMore.\n")
    mkdirSync(join(dir, ".orkestra"))
    writeFileSync(join(dir, ".orkestra", "COMPOSITION.md"), "# Composition\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-q", "-m", "change")

    const run = list(dir, "HEAD~1")

    expect(run.status).toBe(0)
    expect(run.stdout).toBe(
      [
        ".orkestra/COMPOSITION.md",
        "  CLAUDE.md:4",
        "references/hosting.md",
        "  README.md:3",
        "  CLAUDE.md:3",
        "  .agents/skills/hosting/SKILL.md:1",
        "",
        "docs:check — 2 of 2 changed file(s) named in a reference document",
        "",
      ].join("\n"),
    )
  })

  it("lists a moved file under its old path, so a document still naming it is found", () => {
    const dir = repository()
    git(dir, "mv", "references/hosting.md", "references/running.md")
    git(dir, "commit", "-q", "-m", "move")

    const run = list(dir, "HEAD~1")

    expect(run.status).toBe(0)
    expect(run.stdout).toBe(
      [
        "references/hosting.md",
        "  README.md:3",
        "  CLAUDE.md:3",
        "  .agents/skills/hosting/SKILL.md:1",
        "references/running.md",
        "",
        "docs:check — 1 of 2 changed file(s) named in a reference document",
        "",
      ].join("\n"),
    )
  })

  it("exits 0 with the listing even when the gate would fail on the same documents", () => {
    const dir = repository()
    // docs-check-ignore: a broken path is the point of this test
    writeFileSync(join(dir, "CLAUDE.md"), "Named: `references/hosting.md` and `src/gone.ts`.\n")
    writeFileSync(join(dir, "references", "hosting.md"), "# Hosting\n\nMore.\n")

    const run = list(dir, "HEAD")

    expect(run.status).toBe(0)
    expect(run.stdout).toContain("\n  CLAUDE.md:1\n")
  })

  it("refuses a ref git does not know rather than listing nothing", () => {
    const dir = repository()

    const run = list(dir, "no-such-ref")

    expect(run.status).toBe(1)
    expect(run.stdout).toBe("")
    expect(run.stderr).toContain("no-such-ref")
  })
})
