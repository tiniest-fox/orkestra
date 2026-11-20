// A print carries to a second tree: a test file whose inputs are the same on another tree
// is proven there from the print the first tree's run left, for each suite `verify.sh`
// runs. `mammoth-blue-lemur` found two suites where it did not.
//
// - **The engine.** Some of the files a `meter.ts` edit selects were unsure under the hook,
//   so they left no print and ran on every tree. The case runs the public one in this
//   checkout under `verify-light`'s `fingerprint:` and asks for its print back on the same
//   tree — the strictest second tree, since a print that does not hold here holds
//   nowhere.
// - **The client.** Its config listed no recording setup file, so no client file left a
//   print. The case runs the client's real vitest config in a fixture project shaped like
//   this repository, as `verify.sh` runs it — through the stage runner, which lists the
//   setup file the config does not — and then on a second tree that differs by one
//   `README.md` line, where the print holds, and on trees that each change one file the
//   test imports, where it must not.

import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { PACKAGE_ROOT, SHIPPED_AGENTS } from "../../src/app/packaged.js"
import { loadLibrary } from "../../src/library/adapters/library-fs.js"
import { Checks } from "../../src/workflow/ports/checks.js"
import { Passes } from "../../src/workflow/ports/passes.js"
import { anotherHook, BASE, layers, project } from "../support/fingerprints.js"
import { git } from "../support/git.js"

/** `verify-light.sh`'s own list: the list is part of the print's key. */
const SEALED = "[git, sh, sleep, bash, cat, tar, pwd]"

/** The engine files `meter.ts` selects whose print `mammoth-blue-lemur` saw miss. */
const MISSED = ["test/e2e/library-from-disk.test.ts"]

const engineCheck = (files: readonly string[]) => `#!/bin/bash
# ---
# description: some of this checkout's engine test files
# units: vitest
# cache_across: os
# fingerprint: ${SEALED}
# timeout_seconds: 300
# ---
exec node "$ORKESTRA_STAGES" "pnpm test ${files.join(" ")}"
`

/** One run of `engine.sh` over this checkout, and the prints it left that hold here. */
const engineRun = (store: string) =>
  Effect.gen(function* () {
    const check = (yield* loadLibrary(store, SHIPPED_AGENTS)).checks.get("engine")
    if (check === undefined) return yield* Effect.die("no engine check")
    const passes = yield* Passes
    const printKey = yield* passes.printKeyOf(check)
    if (printKey === undefined) return yield* Effect.die("no print key")
    const ran: string[] = []
    const run = yield* (yield* Checks).run(check, PACKAGE_ROOT, undefined, [], {
      proven: [],
      sealed: check.fingerprint ?? [],
      finished: (units, recording) =>
        Effect.gen(function* () {
          ran.push(...units)
          if (recording !== undefined) yield* passes.print(printKey, PACKAGE_ROOT, recording, units)
        }).pipe(Effect.orDie),
    })
    const printed = yield* passes.printed(printKey, PACKAGE_ROOT)
    return { passed: run.passed, ran: ran.toSorted(), printed: [...printed].toSorted() }
  })

/** The fixture's one client test file, from the repository root, as the runner records it. */
const CLIENT_DIR = "client"
const PAGE = `${CLIENT_DIR}/src/page.test.ts`

/**
 * What the fixture's page test imports, one file of each kind Vite makes a module of, and an
 * edit to each that the test still passes on. Vite reads a `?raw`, `?inline` or `?url` file,
 * a JSON file and an asset in the runner and hands the worker a module of data, so each is
 * an input the print has to cover beside the code.
 */
const INPUTS: Record<string, { readonly text: string; readonly edit: string }> = {
  "helper.tsx": { text: `export const helper = (): string => "page"\n`, edit: "// edited\n" },
  "plain.css": { text: "p { color: red; }\n", edit: "a { color: blue; }\n" },
  "raw.css": { text: "/* raw */\n", edit: "a { color: blue; }\n" },
  "inline.css": { text: "/* inline */\n", edit: "a { color: blue; }\n" },
  "url.svg": { text: "<svg></svg>\n", edit: "<!-- edited -->\n" },
  "data.json": { text: `{ "v": 1 }`, edit: " " },
  "asset.png": { text: "not really a png\n", edit: "edited\n" },
}

/** A project laid out as this repository's client is, under the client's real config. */
const CLIENT: Record<string, string> = {
  ...BASE,
  "README.md": "# fixture\n",
  "pnpm-workspace.yaml": "packages:\n  - client\n",
  "client/package.json": `{ "name": "@fixture/client", "type": "module", "scripts": { "test": "vitest run" } }\n`,
  "client/vitest.config.ts": readFileSync(join(PACKAGE_ROOT, "client", "vitest.config.ts"), "utf8"),
  "client/test-setup.ts": readFileSync(join(PACKAGE_ROOT, "client", "test-setup.ts"), "utf8"),
  // The config's `globalSetup`, at the path it names.
  "test/support/run-tmpdir.ts": readFileSync(
    join(PACKAGE_ROOT, "test", "support", "run-tmpdir.ts"),
    "utf8",
  ),
  [PAGE]: `import { expect, test } from "vitest"
import data from "./data.json"
import asset from "./asset.png"
import { helper } from "./helper.tsx"
import inline from "./inline.css?inline"
import "./plain.css"
import raw from "./raw.css?raw"
import url from "./url.svg?url"
test("it", () => {
  document.body.innerHTML = \`<p>\${helper()}</p>\`
  expect(document.body.textContent).toBe("page")
  expect([data.v, raw.includes("raw"), inline.includes("inline")]).toEqual([1, true, true])
  expect([typeof url, typeof asset]).toEqual(["string", "string"])
})
`,
  ...Object.fromEntries(
    Object.entries(INPUTS).map(([name, input]) => [`${CLIENT_DIR}/src/${name}`, input.text]),
  ),
  ".orkestra/checks/client.sh": `#!/bin/bash
# ---
# description: the fixture's client tests, as verify.sh runs the client suite
# units: vitest
# cache_across: os
# fingerprint: ${SEALED}
# timeout_seconds: 120
# ---
exec node "$ORKESTRA_STAGES" "pnpm --filter @fixture/client test"
`,
}

const linkClientModules = (repo: string): void =>
  symlinkSync(join(PACKAGE_ROOT, "client", "node_modules"), join(repo, "client", "node_modules"))

const unlinkClientModules = (repo: string) => () =>
  Effect.sync(() => rmSync(join(repo, "client", "node_modules")))

describe.skipIf(anotherHook)("a print carries to a second tree", () => {
  it("proves every engine file the meter.ts edit selects from the print its run left", async () => {
    // The store and the check live outside the checkout, so nothing here writes into it.
    const store = mkdtempSync(join(tmpdir(), "carry-engine-"))
    // A repository only because the engine's layers open one; nothing reads its history.
    git(store, "init", "--quiet")
    mkdirSync(join(store, ".orkestra", "checks"), { recursive: true })
    writeFileSync(join(store, ".orkestra", "checks", "engine.sh"), engineCheck(MISSED), {
      mode: 0o755,
    })
    try {
      const outcome = await Effect.runPromise(
        Effect.scoped(engineRun(store)).pipe(Effect.provide(layers(store, true))),
      )
      expect(outcome).toEqual({ passed: true, ran: MISSED, printed: MISSED })
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  }, 300_000)

  it("proves a client file on a tree that differs by one README line, and on no tree where one of its imports changed", async () => {
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* project(CLIENT, "client", linkClientModules)
          yield* Effect.addFinalizer(unlinkClientModules(fixture.repo))
          const first = yield* fixture.run
          appendFileSync(join(fixture.repo, "README.md"), "one unrelated line\n")
          const readme = yield* fixture.run
          // One edit at a time, each against the print the run before it left.
          const edited: Record<string, unknown> = {}
          for (const [name, input] of Object.entries(INPUTS)) {
            appendFileSync(join(fixture.repo, CLIENT_DIR, "src", name), input.edit)
            const run = yield* fixture.run
            edited[name] = { passed: run.passed, ran: run.ran }
          }
          return { first, readme, edited }
        }),
      ),
    )
    expect(outcome.first).toMatchObject({ passed: true, ran: [PAGE] })
    expect({ printed: outcome.readme.printed, ran: outcome.readme.ran }).toEqual({
      printed: [PAGE],
      ran: [],
    })
    expect(outcome.edited).toEqual(
      Object.fromEntries(Object.keys(INPUTS).map((name) => [name, { passed: true, ran: [PAGE] }])),
    )
  }, 120_000)
})
