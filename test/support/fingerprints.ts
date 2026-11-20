// What the `fingerprints*.test.ts` files share: a small vitest project in a fresh
// repository, and a check with `fingerprint:` over it, run by the shell adapter with the
// recording hook loaded, over the file store and real git. Each run of `project` is one
// nested vitest run, which is why the cases are spread over several files: one file runs
// on one worker, and its runs take their turn one after another.
//
// The units each run is handed are put together the way `unitsFor` in
// `src/workflow/runtime.ts` puts them together: the units proven on the tree, the units
// whose print still holds, and both stores written once the run ends.
//
// None of these files is ever skipped on its own print, and that is right. Their fixtures
// do on purpose what the hook cannot account for, and the family rule they test carries
// those doubts into their own recording. Making them skip means deleting those cases, or
// having the hook discard a nested recording's doubts — which lets the hook's own rules
// decide whether the test of them runs.

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Layer } from "effect"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { CHECK_STAGES, RECORDING, SHIPPED_AGENTS, PACKAGE_ROOT } from "../../src/app/packaged.js"
import type { Check } from "../../src/library/types/check.js"
import { Lib } from "../../src/library/ports/library.js"
import { loadLibrary } from "../../src/library/adapters/library-fs.js"
import { loadedHook } from "../../src/recording/index.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { ShellChecksLayer } from "../../src/workflow/adapters/checks-shell.js"
import { ShellEnvironmentLayer } from "../../src/workflow/adapters/environment-shell.js"
import { FilePassesLayer, THIS_MACHINE } from "../../src/workflow/adapters/passes-file.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { Checks } from "../../src/workflow/ports/checks.js"
import { Passes } from "../../src/workflow/ports/passes.js"
import { git } from "./git.js"
import { library } from "./library.js"
import { testRepo } from "./vcs-fixture.js"

const VITEST = join(PACKAGE_ROOT, "node_modules", "vitest", "vitest.mjs")

/** This checkout's hook, by the name `checks-shell.ts` gives the copy a check loads. */
const OWN_HOOK = RECORDING.hook.endsWith(".ts")
  ? loadedHook(readFileSync(RECORDING.hook, "utf8")).file
  : basename(RECORDING.hook)

/**
 * Whether another build's recording hook records this run — an engine recording its own
 * check, on a build from before this checkout's hook changed. Every process a fixture
 * starts inherits that copy ahead of the one its check hands it, and the first copy a
 * process loads is the only one that records, so each case would test the engine's hook
 * rather than this one. Skipped then; GitHub runs the checkout's own.
 */
export const anotherHook = (process.env["NODE_OPTIONS"] ?? "")
  .split(/\s+/)
  .filter((option) => option.startsWith("--import=file:"))
  .map((option) => basename(fileURLToPath(option.slice("--import=".length))))
  .some((hook) => /^(?:orkestra-)?recording-hook\b/.test(hook) && hook !== OWN_HOOK)

const CHECK = `#!/bin/bash
# ---
# description: the fixture's tests
# units: vitest
# fingerprint: [git]
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

/** A vitest config; `head` is code above it and `test` more of its `test:` options. */
export const config = (head = "", test = "") => `import { defineConfig } from "vitest/config"
${head}
const setup = process.env.ORKESTRA_RECORDING_VITEST
export default defineConfig({
  cacheDir: ".vite-cache",
  plugins: [
    {
      // A compiled module whose map leads nowhere: what a plugin that drops maps leaves.
      name: "no-map",
      transform: (code, id) => (id.endsWith("/nomap.ts") ? { code, map: { mappings: "" } } : undefined),
    },
  ],
  test: { include: ["*.test.ts"], setupFiles: setup === undefined ? [] : [setup], ${test} },
})
`

const REPORTER = `import { appendFileSync } from "node:fs"
import { relative } from "node:path"
export default class {
  onTestModuleEnd(module) {
    const out = process.env.ORKESTRA_UNITS_OUT
    if (out && module.state() === "passed") appendFileSync(out, relative(process.cwd(), module.moduleId) + "\\n")
  }
}
`

export const LIB = (unused: string) => `export const used = (x: number): number => x + 1
export function unused(x: number): number {
  return x * ${unused}
}
`

export const TEMP = `import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"`

export const uses = (body: string, imports = "") => `import { expect, test } from "vitest"
${imports}
test("it", async () => {
${body}
})
`

/** What every fixture project holds. */
export const BASE: Record<string, string> = {
  "package.json": `{ "type": "module" }\n`,
  "reporter.mjs": REPORTER,
  ".orkestra/checks/tests.sh": CHECK,
}

const writeProject = (repo: string, files: Record<string, string>): void => {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(repo, name, ".."), { recursive: true })
    writeFileSync(join(repo, name), text)
  }
  // Beside the ignores the fixture repository already has, which keep the passes store out.
  appendFileSync(join(repo, ".gitignore"), "node_modules\n.vite-cache\n")
  symlinkSync(join(PACKAGE_ROOT, "node_modules"), join(repo, "node_modules"))
}

export const commitAll = (repo: string, message: string): void => {
  git(repo, "add", "-A")
  git(repo, "commit", "--quiet", "-m", message)
}

/** The engine's layers over `repo`, on this machine as it trusts or does not. */
export const layers = (repo: string, trusts: boolean) => {
  const environment = ShellEnvironmentLayer().pipe(
    Layer.provide(Layer.merge(NodeProcessLayer, Layer.succeed(Lib, library()))),
  )
  return Layer.mergeAll(
    ShellChecksLayer(RECORDING, CHECK_STAGES).pipe(
      Layer.provide(Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, environment)),
    ),
    FilePassesLayer(repo, { ...THIS_MACHINE, trusts }),
    GitCliLayer(repo).pipe(Layer.provide(NodeProcessLayer)),
  )
}

/** One run of the check on the checkout as it is: what it was handed, and what it ran. */
const runOnce = (repo: string, check: Check) =>
  Effect.gen(function* () {
    const passes = yield* Passes
    const tree = yield* (yield* Vcs).workingTree(undefined, false)
    const key = yield* passes.unitKeyOf(check, tree)
    const printKey = yield* passes.printKeyOf(check)
    if (key === undefined || printKey === undefined) return yield* Effect.die("no keys")
    const printed = yield* passes.printed(printKey, repo)
    const ran: string[] = []
    const outcome = yield* (yield* Checks).run(check, repo, undefined, [], {
      proven: [...(yield* passes.proven(key)), ...printed],
      sealed: check.fingerprint ?? [],
      finished: (units, recording) =>
        Effect.gen(function* () {
          ran.push(...units)
          yield* passes.prove(key, units)
          if (recording !== undefined) yield* passes.print(printKey, repo, recording, units)
        }).pipe(Effect.orDie),
    })
    return { printed: [...printed].sort(), ran: ran.sort(), passed: outcome.passed, outcome }
  })

/**
 * A fixture project in a fresh repository, committed, its check and a run of it: `run` on a
 * trusting machine, and `skeptical` on one that accepts no assumption. Vitest loads from
 * pnpm's store, so every print names `lockfile` and a skeptical run skips nothing. `prepare`
 * lays out what a file cannot say, such as a link, before the commit.
 */
export const project = (
  files: Record<string, string>,
  name = "tests",
  prepare: (repo: string) => void = () => undefined,
) =>
  Effect.gen(function* () {
    const repo = yield* testRepo
    writeProject(repo, files)
    prepare(repo)
    commitAll(repo, "fixture")
    const check = (yield* loadLibrary(repo, SHIPPED_AGENTS)).checks.get(name)
    if (check === undefined) return yield* Effect.die(`no ${name} check`)
    yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(join(repo, "node_modules"))))
    return {
      repo,
      check,
      run: Effect.provide(runOnce(repo, check), layers(repo, true)),
      skeptical: Effect.provide(runOnce(repo, check), layers(repo, false)),
    }
  })
