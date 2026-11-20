// A check with `fingerprint:` whose tests reach past their own process: what a child, a
// vouched tool, a copied tree and the compiler options read is recorded, and `ps` is
// trusted only on a trusting machine. The fixture project and the runs are
// `test/support/fingerprints.ts`'s.

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  anotherHook,
  BASE,
  commitAll,
  config,
  project,
  TEMP,
  uses,
} from "../support/fingerprints.js"

const TSX = import.meta.resolve("tsx")

/** A script a test runs as a child, which prints the file it is handed. */
const CHILD = `import { readFileSync } from "node:fs"
process.stdout.write(readFileSync(new URL(process.argv[2], import.meta.url), "utf8"))
`

/** The same, as TypeScript, which `tsx` compiles into its cache under the temp directory. */
const COMPILED = `import { readFileSync } from "node:fs"
const at: string = process.argv[2] ?? ""
process.stdout.write(readFileSync(new URL(at, import.meta.url), "utf8"))
`

/** A script whose `#!` line runs Node, which prints the file it is handed by its path. */
const SHEBANG = `#!${process.execPath}
process.stdout.write(require("node:fs").readFileSync(process.argv[2], "utf8"))
`

/**
 * A project whose tests reach past their own process: a Node child, one started through
 * `promisify`, one `tsx` compiles, a script whose `#!` line runs Node, a tool a test vouches
 * for, a directory copied whole, `ps`, and a class field the compiler options decide.
 */
const REACHING: Record<string, string> = {
  ...BASE,
  // No results cache: the runner reads it back, and each run's durations rewrite it.
  "vitest.config.ts": config("", "cache: false"),
  "tsconfig.json": `{ "compilerOptions": { "useDefineForClassFields": true } }\n`,
  "child.mjs": CHILD,
  "data/child.txt": "child\n",
  "data/promised.txt": "promised\n",
  "compiled.ts": COMPILED,
  "data/compiled.txt": "compiled\n",
  "data/script.txt": "script\n",
  "data/vouched.txt": "vouched\n",
  "tree/a.txt": "a\n",
  "tree/deep/b.txt": "b\n",
  "child.test.ts": uses(
    `  const out = execFileSync(process.execPath, [join(import.meta.dirname, "child.mjs"), "./data/child.txt"], { encoding: "utf8" })
  expect(out.length).toBeGreaterThan(0)`,
    `import { execFileSync } from "node:child_process"
import { join } from "node:path"`,
  ),
  "promised.test.ts": uses(
    `  const { stdout } = await promisify(execFile)(process.execPath, [join(import.meta.dirname, "child.mjs"), "./data/promised.txt"])
  expect(stdout.length).toBeGreaterThan(0)`,
    `import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"`,
  ),
  "compiled.test.ts": uses(
    `  const out = execFileSync(process.execPath, ["--import", ${JSON.stringify(TSX)}, join(import.meta.dirname, "compiled.ts"), "./data/compiled.txt"], { encoding: "utf8" })
  expect(out.length).toBeGreaterThan(0)`,
    `import { execFileSync } from "node:child_process"
import { join } from "node:path"`,
  ),
  "script.test.ts": uses(
    `  const bin = join(mkdtempSync(join(tmpdir(), "fixture-script-")), "show")
  writeFileSync(bin, ${JSON.stringify(SHEBANG)}, { mode: 0o755 })
  const out = execFileSync(bin, [join(import.meta.dirname, "data/script.txt")], { encoding: "utf8" })
  expect(out.length).toBeGreaterThan(0)`,
    `import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
${TEMP}`,
  ),
  // `cat` is not sealed here: the child is told it is vouched for, and the test reads
  // what it read, which is the whole of the promise a vouch makes.
  "vouched.test.ts": uses(
    `  const file = join(import.meta.dirname, "data/vouched.txt")
  const env = { ...process.env, ORKESTRA_RECORDING_VOUCHED: "cat" }
  const out = execFileSync(process.execPath, ["-e", \`require("node:child_process").execFileSync("cat", [\${JSON.stringify(file)}], { stdio: "inherit" })\`], { encoding: "utf8", env })
  expect(out).toBe(readFileSync(file, "utf8"))`,
    `import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"`,
  ),
  "tree.test.ts": uses(
    `  const dir = mkdtempSync(join(tmpdir(), "fixture-tree-"))
  cpSync(join(import.meta.dirname, "tree"), dir, { recursive: true })
  expect(readFileSync(join(dir, "deep", "b.txt"), "utf8").length).toBeGreaterThan(0)`,
    `import { cpSync, readFileSync } from "node:fs"
${TEMP}`,
  ),
  "ps.test.ts": uses(
    `  const out = execFileSync("ps", ["-p", String(process.pid), "-o", "pid="], { cwd: "/", encoding: "utf8" })
  expect(out.trim()).toBe(String(process.pid))`,
    `import { execFileSync } from "node:child_process"`,
  ),
  "fields.test.ts": uses(
    `  class Base { constructor() { Object.assign(this, { x: 1 }) } }
  class Sub extends Base { x?: number }
  expect(new Sub().x).toBeUndefined()`,
  ),
}

describe.skipIf(anotherHook)(
  "a check with `fingerprint:` whose tests reach past their own process",
  () => {
    it("records what a child, a vouched tool, a copied tree and the compiler options read, and trusts `ps` and the lockfile only on a trusting machine", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { repo, run, skeptical } = yield* project(REACHING)
            const all = [
              "child.test.ts",
              "compiled.test.ts",
              "fields.test.ts",
              "promised.test.ts",
              "ps.test.ts",
              "script.test.ts",
              "tree.test.ts",
              "vouched.test.ts",
            ]
            const first = yield* run
            expect(first.outcome.output).not.toContain("FAIL")
            expect(first.ran).toEqual(all)
            // A cold compile of `compiled.ts` runs `esbuild`, which is not sealed, and whether
            // the first one here was cold is the cache's to say. Once the file it reads changes,
            // `tsx` reads it from its cache, which is no input.
            yield* run
            const compiled = all.filter((t) => t !== "compiled.test.ts")
            writeFileSync(join(repo, "data/compiled.txt"), "changed\n")
            commitAll(repo, "edit data/compiled.txt")
            const cached = yield* run
            expect(cached.printed).toEqual(compiled)
            expect(cached.ran).toEqual(["compiled.test.ts"])
            expect((yield* run).printed).toEqual(all)
            // Every print names `lockfile`, so a skeptical machine skips nothing, `ps` or not.
            expect((yield* skeptical).printed).toEqual([])

            // A file only a Node child read, one only a promisified child read, one a script
            // run by its `#!` line read, one a vouched tool read and the test read after it,
            // one under a directory copied whole, and the source of a child `tsx` compiled,
            // which its cache stands in front of.
            for (const [file, test, text] of [
              ["data/child.txt", "child.test.ts", "changed\n"],
              ["data/promised.txt", "promised.test.ts", "changed\n"],
              ["data/script.txt", "script.test.ts", "changed\n"],
              ["data/vouched.txt", "vouched.test.ts", "changed\n"],
              ["tree/deep/b.txt", "tree.test.ts", "changed\n"],
              ["compiled.ts", "compiled.test.ts", `${COMPILED}// changed\n`],
            ] as const) {
              writeFileSync(join(repo, file), text)
              commitAll(repo, `edit ${file}`)
              const edited = yield* run
              expect(edited.printed).toEqual(all.filter((t) => t !== test))
              expect(edited.ran).toEqual([test])
            }

            // The compiler options, which the runner's transform reads where nothing sees it.
            writeFileSync(
              join(repo, "tsconfig.json"),
              `{ "compilerOptions": { "useDefineForClassFields": false } }\n`,
            )
            expect((yield* run).printed).toEqual([])
          }),
        ).pipe(Effect.orDie),
      )
    }, 120_000)
  },
)
