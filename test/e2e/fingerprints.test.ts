// A check with `fingerprint:`, end to end: a test file is skipped on a later tree only
// where everything it touched is unchanged, `ork proofs publish` hands GitHub only what ran,
// and a failing file checked against main leaves the other files' prints standing. The
// fixture project and the runs are `test/support/fingerprints.ts`'s.

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { PACKAGE_ROOT } from "../../src/app/packaged.js"
import { proofsCommand } from "../../src/app/proofs.js"
import { THIS_MACHINE } from "../../src/workflow/adapters/passes-file.js"
import {
  anotherHook,
  BASE,
  commitAll,
  config,
  LIB,
  project,
  TEMP,
  uses,
} from "../support/fingerprints.js"
import { addOrigin, commitOnHost, git } from "../support/git.js"

const TOP = (value: string) => `export const top = ${value}\n`

const NOMAP = (unused: string) => `export const kept = (): number => 1
export function dropped(): number {
  return ${unused}
}
`

const EARLY = (later: string) => `export const kept = (): number => 1
export function later(): number {
  ${later}return 1
}
`

const FILES: Record<string, string> = {
  ...BASE,
  // A hook timeout no hook can meet: the recorder's own `afterAll` must not be held to it.
  "vitest.config.ts": config("", "hookTimeout: 1"),
  "lib.ts": LIB("2"),
  "top.ts": TOP("1"),
  "nomap.ts": NOMAP("2"),
  "early.ts": EARLY(""),
  "data/x.txt": "x\n",
  "data/y.txt": "y\n",
  "called.test.ts": uses(`  expect(used(1)).toBe(2)`, `import { used } from "./lib.ts"`),
  "calls-edited.test.ts": uses(
    `  expect(unused(1)).toBeGreaterThan(0)`,
    `import { unused } from "./lib.ts"`,
  ),
  "top.test.ts": uses(`  expect(top).toBeGreaterThan(0)`, `import { top } from "./top.ts"`),
  "nomap.test.ts": uses(`  expect(kept()).toBe(1)`, `import { kept } from "./nomap.ts"`),
  "git.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-git-"))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  execFileSync("git", ["init", "--quiet"], { cwd: dir, env })
  expect(used(1)).toBe(2)`,
    `import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { used } from "./lib.ts"`,
  ),
  "git-c.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-git-c-"))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  execFileSync("git", ["-C", dir, "init", "--quiet"], { env })
  expect(used(1)).toBe(2)`,
    `import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { used } from "./lib.ts"`,
  ),
  "addon.node": "not an addon\n",
  "addon.test.ts": uses(
    `  expect(() => process.dlopen({ exports: {} }, join(import.meta.dirname, "addon.node"))).toThrow()
  expect(used(1)).toBe(2)`,
    `import { join } from "node:path"
import { used } from "./lib.ts"`,
  ),
  "unlisted.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-true-"))
  execFileSync("true", [], { cwd: dir })
  expect(used(1)).toBe(2)`,
    `import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { used } from "./lib.ts"`,
  ),
  "unhashable.test.ts": uses(
    `  expect(readFileSync("/dev/null", "utf8")).toBe("")
  expect(used(1)).toBe(2)`,
    `import { readFileSync } from "node:fs"
import { used } from "./lib.ts"`,
  ),
  "copied.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-copy-"))
  copyFileSync(join(import.meta.dirname, "data/x.txt"), join(dir, "x.txt"))
  expect(readFileSync(join(dir, "x.txt"), "utf8").length).toBeGreaterThan(0)`,
    `import { copyFileSync, readFileSync } from "node:fs"
${TEMP}`,
  ),
  "symlinked.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-link-"))
  symlinkSync(join(import.meta.dirname, "data/y.txt"), join(dir, "y.txt"))
  expect(readFileSync(join(dir, "y.txt"), "utf8").length).toBeGreaterThan(0)`,
    `import { readFileSync, symlinkSync } from "node:fs"
${TEMP}`,
  ),
  "escape.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-escape-"))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  const up = relative(dir, import.meta.dirname)
  expect(execFileSync("git", ["-C", up, "rev-parse", "--is-inside-work-tree"], { cwd: dir, env, encoding: "utf8" })).toContain("true")`,
    `import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"`,
  ),
  "early.test.ts": uses(`  expect(kept()).toBe(1)`, `import { kept } from "./early.ts"`),
  "network.test.ts": uses(
    `  const socket = connect(9, "192.0.2.1")
  socket.on("error", () => undefined)
  socket.destroy()
  expect(used(1)).toBe(2)`,
    `import { connect } from "node:net"
import { used } from "./lib.ts"`,
  ),
}

const TESTS = Object.keys(FILES).filter((f) => f.endsWith(".test.ts"))

describe.skipIf(anotherHook)("a check with `fingerprint:`", () => {
  it("skips a test file on a later tree only where every input it recorded still holds", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { repo, check, run } = yield* project(FILES)
          const origin = addOrigin(repo)
          expect(check.fingerprint).toEqual(["git"])

          const first = yield* run
          expect(first.outcome.output).not.toContain("FAIL")
          expect(first).toMatchObject({ printed: [], ran: [...TESTS].sort(), passed: true })

          // Inside the body of a function no surviving test calls but one; at the top level
          // of a module; inside an uncalled body of a module with no usable map; two files
          // a test copies or links into a directory of its own; an addon a test loads; and an
          // uncalled body given a declaration twice, which leaves its module failing to
          // compile.
          writeFileSync(join(repo, "lib.ts"), LIB("3"))
          writeFileSync(join(repo, "top.ts"), TOP("2"))
          writeFileSync(join(repo, "nomap.ts"), NOMAP("3"))
          writeFileSync(join(repo, "data/x.txt"), "changed\n")
          writeFileSync(join(repo, "data/y.txt"), "changed\n")
          writeFileSync(join(repo, "addon.node"), "still not an addon\n")
          writeFileSync(join(repo, "early.ts"), EARLY("let z = 1; let z = 2; "))
          commitAll(repo, "edits")
          git(repo, "push", "--quiet", "origin", "main")

          const second = yield* run
          // `git -C <dir>` works in `<dir>`, as `cwd:` would.
          expect(second.printed).toEqual(["called.test.ts", "git-c.test.ts", "git.test.ts"])
          // Everything else ran, and the one that cannot compile failed rather than skipped.
          const rest = TESTS.filter((t) => !second.printed.includes(t) && t !== "early.test.ts")
          expect(second.ran).toEqual(rest.sort())
          expect(second.passed).toBe(false)
          expect(second.outcome.output).toContain("early.test.ts")

          // GitHub is handed only what ran on this tree.
          const published = yield* Effect.either(proofsCommand(repo, ["publish"]))
          expect(published._tag === "Left" ? published.left.reason : "published").toBe("published")
          git(origin.elsewhere, "pull", "--quiet", "--ff-only")
          const read = yield* proofsCommand(origin.elsewhere, ["read", "--check", "tests"])
          expect([...read.out].sort()).toEqual(second.ran)
          origin.remove()
        }),
      ).pipe(Effect.orDie),
    )
  }, 120_000)

  it("hands CI the host's prints by the head's tree, after the base has moved", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { repo, run } = yield* project({
            ...BASE,
            "vitest.config.ts": config(),
            "lib.ts": LIB("2"),
            "called.test.ts": FILES["called.test.ts"] ?? "",
            "other.test.ts": uses(`  expect(1).toBe(1)`),
          })
          const origin = addOrigin(repo)
          git(repo, "checkout", "--quiet", "-b", "feature")
          writeFileSync(join(repo, "other.test.ts"), uses(`  expect(2).toBe(2)`))
          commitAll(repo, "feature")
          git(repo, "push", "--quiet", "origin", "feature")
          expect((yield* run).passed).toBe(true)
          const published = yield* proofsCommand(repo, ["publish"])
          expect(published.note).toContain("2 print(s)")
          const head = git(repo, "rev-parse", "HEAD^{tree}")

          // CI: the base moved, so the merge it builds is a tree the host never ran on.
          const ci = origin.elsewhere
          commitOnHost(ci, "moved.md", "main moved\n")
          git(ci, "fetch", "--quiet", "origin")
          git(ci, "merge", "--quiet", "--no-ff", "--no-edit", "origin/feature")
          symlinkSync(join(PACKAGE_ROOT, "node_modules"), join(ci, "node_modules"))
          const onCi = (trusts: boolean) =>
            Effect.gen(function* () {
              const skipped = mkdtempSync(join(tmpdir(), "fixture-skipped-"))
              const answer = yield* proofsCommand(
                ci,
                ["run", "--check", "tests", "--skipped", skipped, "--prints-from", head],
                { ...THIS_MACHINE, trusts },
              )
              const units = readFileSync(join(skipped, "units"), "utf8")
              rmSync(skipped, { recursive: true, force: true })
              return { answer, units }
            })
          // Vitest loads from pnpm's store, so both prints name `lockfile`: a skeptical CI
          // adopts neither, and a trusting one skips on both.
          const doubted = yield* onCi(false)
          expect(doubted.answer.failed).toBeUndefined()
          expect(doubted.answer.note).toContain("0 proven on this tree, 0 on the host's prints")
          expect(doubted.units).toBe("")
          const trusted = yield* onCi(true)
          expect(trusted.answer.failed).toBeUndefined()
          expect(trusted.answer.note).toContain("0 proven on this tree, 2 on the host's prints")
          expect(trusted.units).toBe("called.test.ts\nother.test.ts\n")
          origin.remove()
        }),
      ).pipe(Effect.orDie),
    )
  }, 120_000)
})

/** A module three test files import at the top level, so any edit to it reaches all three. */
const SHARED_TOP = (value: string) => `export const base = ${value}\n`

/** A project of three files on one shared module, and a fourth that fails on the branch. */
const CHECKED_AGAINST_MAIN: Record<string, string> = {
  ...BASE,
  "vitest.config.ts": config("", "cache: false"),
  "base.ts": SHARED_TOP("1"),
  "a.test.ts": uses(`  expect(base).toBeGreaterThan(0)`, `import { base } from "./base.ts"`),
  "b.test.ts": uses(`  expect(base).toBeGreaterThan(0)`, `import { base } from "./base.ts"`),
  "c.test.ts": uses(`  expect(base).toBeGreaterThan(0)`, `import { base } from "./base.ts"`),
  "broken.test.ts": uses(`  expect(1).toBe(1)`),
}

describe.skipIf(anotherHook)(
  "a check with `fingerprint:`, after a failing file is checked against main",
  () => {
    it("still skips the files whose recorded inputs are unchanged since they last passed", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { repo, run } = yield* project(CHECKED_AGAINST_MAIN)
            const unchanged = ["a.test.ts", "b.test.ts", "c.test.ts"]

            // The step's work, uncommitted as it is while a step is sent back: an edit every
            // file reaches, and a file that now fails.
            writeFileSync(join(repo, "base.ts"), SHARED_TOP("2"))
            writeFileSync(join(repo, "broken.test.ts"), uses(`  expect(1).toBe(2)`))
            const failing = yield* run
            expect(failing.passed).toBe(false)
            expect(failing.ran).toEqual(unchanged)

            // Is the failure there on main? The agent stashes its work and runs the check,
            // then takes its work back.
            git(repo, "stash", "push", "--include-untracked", "--quiet")
            const onMain = yield* run
            expect(onMain.passed).toBe(true)
            git(repo, "stash", "pop", "--quiet")

            // The fix touches only the failing file. Nothing the other three read has changed
            // since they passed on the branch, so only the fixed file runs.
            writeFileSync(join(repo, "broken.test.ts"), uses(`  expect(2).toBe(2)`))
            const fixed = yield* run
            expect(fixed.passed).toBe(true)
            expect(fixed.printed).toEqual(unchanged)
            expect(fixed.ran).toEqual(["broken.test.ts"])
          }),
        ).pipe(Effect.orDie),
      )
    }, 120_000)
  },
)
