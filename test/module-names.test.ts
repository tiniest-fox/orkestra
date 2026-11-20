// No two modules in one directory may differ only in case once their extension is dropped.
//
// At the root beside `locks.test.ts`: it is not a flow or a contract, it is a fact about
// the tree. An import names a module without its extension, and a resolver tries the
// extensions in its own order — Vite's puts `.ts` ahead of `.tsx`. Beside a `foo.ts`, on
// a case-sensitive disk `./Foo` misses it and finds `Foo.tsx`; on macOS's default
// case-insensitive disk it finds `foo.ts` first, and the client build fails with a
// missing default export. Linux, where the checks run, builds it cleanly, so nothing
// else here sees it.
//
// **Read from disk, not from `git ls-files`.** git answers from its index, which no print
// holds, so asking it ran this file on every check; each directory read here is recorded,
// and the file is skipped until a listing changes. An untracked module counts too, and a
// clash one makes breaks a Mac build all the same. What is never a source is left out:
// installs, build output, and the state and scratch `.gitignore` keeps out of git —
// `SKIPPED` copies that part of it by hand, so a new ignored directory belongs there too.

import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

const MODULE = /\.(?:[cm]?[jt]sx?)$/

/** Directories never walked, by name anywhere, or by path from the root. */
const SKIPPED = {
  names: new Set([
    "node_modules",
    "dist",
    "build",
    "coverage",
    "test-results",
    "playwright-report",
  ]),
  paths: new Set([".orkestra", ".experiments", ".atelier/proof", "test/e2e/logs"]),
}

/** A dot-directory is walked only where the tree keeps modules in one. */
const DOT_WALKED = new Set([".agents", ".atelier"])

const skipped = (path: string, name: string): boolean =>
  SKIPPED.names.has(name) ||
  SKIPPED.paths.has(path) ||
  name.startsWith("example-") ||
  (name.startsWith(".") && !DOT_WALKED.has(path))

/** Every module under `dir`, relative to the root. Links are not followed. */
const modules = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = relative(ROOT, join(dir, entry.name))
    if (entry.isDirectory()) return skipped(path, entry.name) ? [] : modules(join(dir, entry.name))
    return entry.isFile() && MODULE.test(entry.name) ? [path] : []
  })

describe("module names", () => {
  it("never puts two modules in one directory that differ only in case", () => {
    const byFolded = Map.groupBy(modules(ROOT), (path) => path.replace(MODULE, "").toLowerCase())
    const clashes = [...byFolded.values()].filter((paths) => {
      const spellings = new Set(paths.map((path) => path.replace(MODULE, "")))
      return spellings.size > 1
    })
    expect(clashes).toEqual([])
  })
})
