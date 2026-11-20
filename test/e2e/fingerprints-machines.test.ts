// A check with `fingerprint:` on a machine that trusts and on one that does not: the two
// share prints, and only the trusting one skips, since every print names `lockfile`. The fixture
// project and the runs are `test/support/fingerprints.ts`'s.
//
// One scenario over one fixture, cut into steps so no one test holds every nested run:
// the tests run in order, and each starts from the prints and the passes the one before
// it left.

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Scope } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
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

/** A dependency the fixture installs itself, since its `node_modules` is the repository's. */
const DEP = "deps/node_modules/dep"

/** A file in pnpm's store, which the fixture's own lockfile stands for. */
const STORE = "deps/node_modules/.pnpm/dep@1.0.0/node_modules/dep/index.js"

/**
 * A project run on a skeptical machine and on a trusting one. One test file writes under
 * the temp directory outside any directory it made, one links a dependency's directory
 * into one it made, and one reads a file in pnpm's store and a file of the project.
 */
const ASSUMING: Record<string, string> = {
  ...BASE,
  "vitest.config.ts": config(),
  "lib.ts": LIB("2"),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  [`${DEP}/index.js`]: "export const dep = 1\n",
  [STORE]: "export const dep = 1\n",
  "data.txt": "one\n",
  "called.test.ts": uses(`  expect(used(1)).toBe(2)`, `import { used } from "./lib.ts"`),
  "loose.test.ts": uses(
    `  const at = join(tmpdir(), \`fixture-loose-\${String(process.pid)}\`)
  writeFileSync(at, "x")
  rmSync(at)
  expect(used(1)).toBe(2)`,
    `import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { used } from "./lib.ts"`,
  ),
  "linked.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-dep-"))
  symlinkSync(join(import.meta.dirname, "${DEP}"), join(dir, "dep"))
  expect(readFileSync(join(dir, "dep", "index.js"), "utf8")).toContain("dep")`,
    `import { readFileSync, symlinkSync } from "node:fs"
${TEMP}`,
  ),
  "store.test.ts": uses(
    `  expect(readFileSync(join(import.meta.dirname, "${STORE}"), "utf8")).toContain("dep")
  expect(readFileSync(join(import.meta.dirname, "data.txt"), "utf8")).not.toBe("")`,
    `import { readFileSync } from "node:fs"
import { join } from "node:path"`,
  ),
}

describe.skipIf(anotherHook)(
  "a check with `fingerprint:`, on a trusting machine and on another machine",
  () => {
    const scope = Effect.runSync(Scope.make())
    /** A run of the check on each machine, each on a tree of its own. */
    let trust: () => Promise<{
      readonly printed: readonly string[]
      readonly ran: readonly string[]
    }>
    let doubt: typeof trust
    let repo = ""
    const all = ["called.test.ts", "linked.test.ts", "loose.test.ts", "store.test.ts"]

    beforeAll(async () => {
      const made = await Effect.runPromise(Scope.extend(project(ASSUMING), scope))
      repo = made.repo
      // Each run on a tree of its own, so nothing is skipped as proven on the tree.
      let round = 0
      const onNewTree =
        <A, E>(once: Effect.Effect<A, E>) =>
        () => {
          round += 1
          writeFileSync(join(repo, "round.txt"), `${String(round)}\n`)
          commitAll(repo, `round ${String(round)}`)
          return Effect.runPromise(once.pipe(Effect.orDie))
        }
      trust = onNewTree(made.run)
      doubt = onNewTree(made.skeptical)
    }, 120_000)

    afterAll(() => Effect.runPromise(Scope.close(scope, Exit.void)))

    it("runs every file the first time, with no prints yet", async () => {
      expect((await doubt()).ran).toEqual(all)
    }, 120_000)

    it("shares prints between the two machines, and only the trusting one skips on them", async () => {
      // Vitest loads from pnpm's store, so every print names `lockfile`.
      const doubted = await doubt()
      expect(doubted.printed).toEqual([])
      expect(doubted.ran).toEqual(all)
      expect((await trust()).printed).toEqual(all)
    }, 120_000)

    it("lets the lockfile stand for a dependency linked, and for a file in pnpm's store", async () => {
      writeFileSync(join(repo, DEP, "index.js"), "export const dep = 2\n")
      writeFileSync(join(repo, STORE), "export const dep = 2\n")
      expect((await trust()).printed).toEqual(all)
    }, 120_000)

    it("runs a test that read pnpm's store again once a project file it read changes", async () => {
      writeFileSync(join(repo, "data.txt"), "two\n")
      const edited = await trust()
      expect(edited.printed).toEqual(all.filter((t) => t !== "store.test.ts"))
      expect(edited.ran).toEqual(["store.test.ts"])
    }, 120_000)

    it("runs the linker and the store's reader again once the lockfile itself changes", async () => {
      // The lockfile is what the trusting machine's prints of both hold.
      writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n")
      const changed = await trust()
      expect(changed.printed).toEqual(["called.test.ts", "loose.test.ts"])
      expect(changed.ran).toEqual(["linked.test.ts", "store.test.ts"])
    }, 120_000)
  },
)
