// A check with `fingerprint:` whose tests start a child the way this repository's engine
// tests do: a `#!/bin/bash` script the test wrote into its own directory, which execs Node,
// as a test that boots a second engine may do, and a `tsx` child compiling a source
// it has not compiled before, as every child engine does the first run after an edit. What
// each child does is decided by the test's own inputs, so the file is owed a print. The fixture
// project and the runs are `test/support/fingerprints.ts`'s.

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { PACKAGE_ROOT } from "../../src/app/packaged.js"
import {
  anotherHook,
  BASE,
  commitAll,
  config,
  project,
  TEMP,
  uses,
} from "../support/fingerprints.js"

const VITEST = join(PACKAGE_ROOT, "node_modules", "vitest", "vitest.mjs")
const TSX = import.meta.resolve("tsx")

/** The fixture's check, with `bash` sealed as this repository's `verify-light.sh` seals it. */
const SEALED_CHECK = `#!/bin/bash
# ---
# description: the fixture's tests, with bash sealed
# units: vitest
# fingerprint: [git, sh, bash]
# timeout_seconds: 120
# ---
set -euo pipefail
files=()
for f in *.test.ts; do
  grep -qxF "$f" "\${ORKESTRA_UNITS_PROVEN:-/dev/null}" || files+=("$f")
done
[ \${#files[@]} -eq 0 ] && exit 0
exec node "${VITEST}" run --reporter=default --reporter=./reporter.mjs "\${files[@]}"
`

/** A Node child that prints the file it is handed by its path. */
const CHILD = `import { readFileSync } from "node:fs"
process.stdout.write(readFileSync(process.argv[2], "utf8"))
`

/** The same, as TypeScript, which `tsx` compiles when its cache has no copy of this text. */
const COMPILED = (mark: string) => `import { readFileSync } from "node:fs"
const at: string = process.argv[2] ?? ""
process.stdout.write(readFileSync(at, "utf8"))
// ${mark}
`

const SPAWNED: Record<string, string> = {
  ...BASE,
  ".orkestra/checks/sealed.sh": SEALED_CHECK,
  "vitest.config.ts": config("", "cache: false"),
  "child.mjs": CHILD,
  "data/script.txt": "script\n",
  "compiled.ts": COMPILED("first"),
  "data/compiled.txt": "compiled\n",
  // `store.sh`'s shape: written by the test into a directory it made, and run by its path
  // from there with no arguments.
  "script.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-bash-"))
  const child = join(import.meta.dirname, "child.mjs")
  const data = join(import.meta.dirname, "data/script.txt")
  writeFileSync(join(dir, "relay.sh"), \`#!/bin/bash\\nexec node "\${child}" "\${data}"\\n\`, { mode: 0o755 })
  const out = execFileSync(join(dir, "relay.sh"), [], { cwd: dir, encoding: "utf8" })
  expect(out).toBe("script\\n")`,
    `import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
${TEMP}`,
  ),
  // The same script, started with an environment spelled out without `NODE_OPTIONS`, so the
  // hook is not handed on and the Node child it runs records nothing.
  "bare.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-bare-"))
  const child = join(import.meta.dirname, "child.mjs")
  const data = join(import.meta.dirname, "data/script.txt")
  writeFileSync(join(dir, "relay.sh"), \`#!/bin/bash\\nexec node "\${child}" "\${data}"\\n\`, { mode: 0o755 })
  const out = execFileSync(join(dir, "relay.sh"), [], { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" })
  expect(out).toBe("script\\n")`,
    `import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
${TEMP}`,
  ),
  "compiled.test.ts": uses(
    `  const out = execFileSync(process.execPath, ["--import", ${JSON.stringify(TSX)}, join(import.meta.dirname, "compiled.ts"), join(import.meta.dirname, "data/compiled.txt")], { encoding: "utf8" })
  expect(out).toBe("compiled\\n")`,
    `import { execFileSync } from "node:child_process"
import { join } from "node:path"`,
  ),
}

const only = (test: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(SPAWNED).filter(([name]) => !name.endsWith(".test.ts") || name === test),
  )

describe.skipIf(anotherHook)(
  "a check with `fingerprint:` whose tests start children the way the engine tests do",
  () => {
    // The script is a file the test wrote, `bash`, the one tool it starts, is sealed, and the
    // inherited environment hands the hook to its Node child. That is
    // `test/e2e/two-engines*.test.ts`, whose child engines start their `store.sh`.
    it("prints a file whose child is a bash script the test wrote into its own directory", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { run } = yield* project(only("script.test.ts"), "sealed")
            const first = yield* run
            expect(first.outcome.output).not.toContain("FAIL")
            expect(first.ran).toEqual(["script.test.ts"])
            expect((yield* run).printed).toEqual(["script.test.ts"])
          }),
        ).pipe(Effect.orDie),
      )
    }, 120_000)

    it("leaves a file unsure whose script runs without the hook handed on", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { run } = yield* project(only("bare.test.ts"), "sealed")
            const first = yield* run
            expect(first.outcome.output).not.toContain("FAIL")
            expect(first.ran).toEqual(["bare.test.ts"])
            expect((yield* run).printed).toEqual([])
          }),
        ).pipe(Effect.orDie),
      )
    }, 120_000)

    // A text `tsx` has never compiled, so its child compiles it cold: esbuild's
    // `transformSync` starts a worker thread, and today that alone makes the file unsure, so
    // the run keeps no print and the next run on the same tree runs it again. That is
    // `test/e2e/sim.test.ts` and the `two-engines*` files on the run after a failing one,
    // since the failing run was the edited source's first compile.
    it("prints a file whose tsx child compiled a source it had never compiled", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { repo, run } = yield* project(only("compiled.test.ts"), "sealed")
            expect((yield* run).outcome.output).not.toContain("FAIL")
            writeFileSync(join(repo, "compiled.ts"), COMPILED(`cold ${String(Date.now())}`))
            commitAll(repo, "edit compiled.ts")
            const cold = yield* run
            expect(cold.outcome.output).not.toContain("FAIL")
            expect(cold.ran).toEqual(["compiled.test.ts"])
            expect((yield* run).printed).toEqual(["compiled.test.ts"])
          }),
        ).pipe(Effect.orDie),
      )
    }, 120_000)
  },
)
