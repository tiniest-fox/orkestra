// Tier 1: the port derivation is a pure function of the project's path, and the promise
// it makes — the same worktree gets the same URL every boot — is only worth anything if
// it holds across processes. So this asserts the number itself, not just that it is
// stable within one run.
//
// `projectDir` is beside it because it is what decides the string that gets hashed.

import { tmpdir } from "node:os"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { basePort, FIRST_PORT, PAIRS, PROJECT_DIR_ENV, projectDir } from "./discovery.js"

const LAST_PORT = FIRST_PORT + PAIRS * 2 - 2

describe("the port a project gets", () => {
  it("is the same number every time, which is what makes it bookmarkable", () => {
    expect(basePort("/Users/x/Repos/orkestra")).toBe(basePort("/Users/x/Repos/orkestra"))
  })

  it("is a fixed value, so it survives a restart and a different process", () => {
    // Pinned rather than recomputed: a test that hashes the same way as the code cannot
    // catch the hash changing, and the hash changing is the one edit that silently
    // breaks every bookmark.
    expect(basePort("/Users/x/Repos/orkestra")).toBe(34_916)
  })

  it("separates two worktrees of the same repository", () => {
    const main = basePort("/Users/x/Repos/orkestra")
    const worktree = basePort("/Users/x/Repos/orkestra/.claude/worktrees/ports")
    expect(worktree).not.toBe(main)
  })

  it("lands inside the window, on an even number, so the pair fits below the ephemeral range", () => {
    // Every eighth-of-a-percent of the space is one path away, so a spread of paths is
    // the only way to see a boundary the modulo gets wrong.
    for (let i = 0; i < 500; i++) {
      const port = basePort(`/Users/x/Repos/checkout-${String(i)}`)
      expect(port % 2).toBe(0)
      expect(port).toBeGreaterThanOrEqual(FIRST_PORT)
      expect(port).toBeLessThanOrEqual(LAST_PORT)
    }
  })
})

describe("which project a command is about", () => {
  // **`beforeEach` as well as `afterEach`, because the variable is ambient here.** It is
  // an ordinary environment variable and a person's shell can be carrying one, in which
  // case the no-flag case below would read that project rather than the cwd. The engine
  // no longer puts it there — `agent/logic/spawn-env.ts` strips the family from
  // everything it spawns — but this block owning its own environment on both edges is
  // what makes that a fact the suite does not depend on.
  beforeEach(() => {
    delete process.env[PROJECT_DIR_ENV]
  })

  afterEach(() => {
    delete process.env[PROJECT_DIR_ENV]
  })

  it("is where the command was run, when nothing says otherwise", () => {
    expect(projectDir([]).root).toBe(realpathSync.native(process.cwd()))
  })

  it("is what `--dir` names, in either spelling", () => {
    const tmp = realpathSync.native(tmpdir())
    expect(projectDir(["--dir", tmpdir()]).root).toBe(tmp)
    expect(projectDir([`--dir=${tmpdir()}`]).root).toBe(tmp)
  })

  it("takes the flag out, so what is left is the subcommand and its arguments", () => {
    expect(projectDir(["resume", "--dir", tmpdir(), "abc"]).rest).toEqual(["resume", "abc"])
    expect(projectDir([`--dir=${tmpdir()}`, "list"]).rest).toEqual(["list"])
  })

  it("reads $ORKESTRA_PROJECT_DIR, which is how `pnpm ui` tells the halves it spawns", () => {
    process.env[PROJECT_DIR_ENV] = tmpdir()
    expect(projectDir([]).root).toBe(realpathSync.native(tmpdir()))
  })

  it("lets the flag win over the environment — an export outlives the command", () => {
    process.env[PROJECT_DIR_ENV] = tmpdir()
    expect(projectDir(["--dir", "."]).root).toBe(realpathSync.native(process.cwd()))
  })

  it("refuses `--dir` with no path rather than quietly driving the wrong repository", () => {
    expect(() => projectDir(["--dir"])).toThrow("--dir needs a path")
    expect(() => projectDir(["--dir="])).toThrow("--dir needs a path")
  })

  it("keeps a path that does not exist, so the `.orkestra` walk-up is what complains", () => {
    const absent = resolve(tmpdir(), "no-such-project-here")
    expect(projectDir(["--dir", absent]).root).toBe(absent)
  })

  /**
   * The claim that made this a function rather than a `resolve` call. A root that is
   * already a fixed point of `realpath` is a root no other spelling of the same
   * directory can differ from — which on macOS includes `…/GitHub/x` against
   * `…/Github/x`, the pair that would otherwise be two port pairs, two `daemon.json`
   * records and a health answer that never matches.
   *
   * Asserted as the fixed point rather than by shouting a path, because whether two
   * casings name one directory is a property of the volume and not of this function.
   */
  it("is fully resolved, so no second spelling of one directory can differ from it", () => {
    const root = projectDir(["--dir", `${process.cwd()}/./`]).root
    expect(root).toBe(realpathSync.native(root))
    expect(root).toBe(projectDir([]).root)
  })
})
