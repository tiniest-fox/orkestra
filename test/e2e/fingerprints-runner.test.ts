// A check with `fingerprint:` over what the runner resolves or runs itself: a workspace
// package's `exports`, and a config and a globalSetup that run code. The fixture project and
// the runs are `test/support/fingerprints.ts`'s.

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { anotherHook, BASE, commitAll, config, project, uses } from "../support/fingerprints.js"

const SHARED = (mode: string) => `export function mode(): string {
  return "${mode}"
}
export function label(): string {
  return "l"
}
`

const GLOBAL_SETUP = (value: string) => `export default ({ provide }) => {
  provide("value", ${value})
}
`

/** A project whose runner itself runs code: a config calling into a source file, and a globalSetup. */
const RUNNER: Record<string, string> = {
  ...BASE,
  "vitest.config.ts": config(
    `import { mode } from "./shared.ts"`,
    `env: { MODE: mode() }, globalSetup: ["./gs.ts"]`,
  ),
  "shared.ts": SHARED("a"),
  "gs.ts": GLOBAL_SETUP("1"),
  "config.test.ts": uses(
    `  expect(label()).toBe("l")
  expect(typeof process.env.MODE).toBe("string")`,
    `import { label } from "./shared.ts"`,
  ),
  "gs.test.ts": uses(`  expect(inject("value")).toBeDefined()`, `import { inject } from "vitest"`),
}

/**
 * A project with a workspace package, `wsp`, that a test reaches by name: `app/` links it
 * under its own `node_modules`, as a workspace install does, and the test imports `app/`.
 */
const WORKSPACE: Record<string, string> = {
  ...BASE,
  "vitest.config.ts": config("", "cache: false"),
  "wsp/package.json": `{ "name": "wsp", "type": "module", "exports": { ".": "./a.js" } }\n`,
  "wsp/a.js": "export const which = 'a'\n",
  "wsp/b.js": "export const which = 'b'\n",
  "app/entry.ts": `export { which } from "wsp"\n`,
  "ws.test.ts": uses(`  expect(which).toBe("a")`, `import { which } from "./app/entry.ts"`),
  "plain.test.ts": uses(`  expect(1).toBe(1)`),
}

describe.skipIf(anotherHook)(
  "a check with `fingerprint:` whose tests import a workspace package",
  () => {
    it("runs a file again when the package's `exports` changes what its name resolves to", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { repo, run } = yield* project(WORKSPACE, "tests", (dir) => {
              mkdirSync(join(dir, "app", "node_modules"))
              symlinkSync(join(dir, "wsp"), join(dir, "app", "node_modules", "wsp"))
            })
            const all = ["plain.test.ts", "ws.test.ts"]
            const first = yield* run
            expect(first.outcome.output).not.toContain("FAIL")
            expect((yield* run).printed).toEqual(all)

            // Only the manifest changes: both files it can name were there all along.
            writeFileSync(
              join(repo, "wsp/package.json"),
              `{ "name": "wsp", "type": "module", "exports": { ".": "./b.js" } }\n`,
            )
            commitAll(repo, "point wsp at b")
            const edited = yield* run
            expect(edited.printed).toEqual(["plain.test.ts"])
            expect(edited.outcome.output).toContain("ws.test.ts")
          }),
        ).pipe(Effect.orDie),
      )
    }, 120_000)
  },
)

describe.skipIf(anotherHook)("a check with `fingerprint:` whose runner ran code", () => {
  it("runs every test file again when code the runner itself ran has changed", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { repo, run } = yield* project(RUNNER)
          const all = ["config.test.ts", "gs.test.ts"]
          expect((yield* run).ran).toEqual(all)
          expect((yield* run).printed).toEqual(all)

          // The globalSetup, which the runner evaluates and no test imports.
          writeFileSync(join(repo, "gs.ts"), GLOBAL_SETUP("2"))
          expect((yield* run).printed).toEqual([])
          expect((yield* run).printed).toEqual(all)

          // Inside the body of a function the config calls and the test imports but never
          // calls: the test's coverage says uncalled, and the runner's file stays whole.
          writeFileSync(join(repo, "shared.ts"), SHARED("b"))
          expect((yield* run).printed).toEqual([])
        }),
      ).pipe(Effect.orDie),
    )
  }, 120_000)
})
