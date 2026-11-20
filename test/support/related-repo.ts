// What the `check-stages-*.test.ts` files on `--related` share: a project of its own, on a
// branch, with a selection file of its own, and the stage runner run in it as a check runs
// it. The tables name only the fixture's paths, so a case shows the runner reads them from
// the file rather than knowing any project's.

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { onTestFinished } from "vitest"
import { CHECK_STAGES, PACKAGE_ROOT } from "../../src/app/packaged.js"
import { git } from "./git.js"

/** A test file that notes it ran, after importing `imports`. */
const marking = (name: string, imports: readonly string[]): string =>
  [
    ...imports.map((path) => `import "${path}"`),
    'import { appendFileSync } from "node:fs"',
    'import { test } from "vitest"',
    `test("${name}", () => appendFileSync(new URL("ran", import.meta.url), "${name}\\n"))`,
    "",
  ].join("\n")

/**
 * Two modules each with its test; a file read off disk and its reader; an entry a test
 * starts, which imports a module no test does; and a held-back test that imports one module
 * and is about a file of its own.
 */
const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "type": "module", "scripts": { "test": "vitest run" } }\n`,
  ".gitignore": "node_modules\nran\n",
  "a.js": "export const a = 1\n",
  "a.test.js": marking("a", ["./a.js"]),
  "b.js": "export const b = 1\n",
  "b.test.js": marking("b", ["./b.js"]),
  "data/table.txt": "one\n",
  "reader.test.js": marking("reader", []),
  "dep.js": "export const dep = 1\n",
  "entry.js": 'import "./dep.js"\n',
  "spawn.test.js": marking("spawn", []),
  "held/subject.js": "export const subject = 1\n",
  "held.test.js": marking("held", ["./a.js", "./held/subject.js"]),
  "select.yaml": `reads:
  "data/*": [reader.test.js]
  "run:entry.js": [spawn.test.js]
held_back:
  - when: ["held/*"]
    tests: [held.test.js]
`,
}

/**
 * The project on a trak's branch, whose one earlier step changed `b.js` and was committed,
 * and the tree that step passed on.
 */
export const relatedRepo = (): { dir: string; passed: string } => {
  const dir = mkdtempSync(join(tmpdir(), "check-stages-related-"))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  symlinkSync(join(PACKAGE_ROOT, "node_modules"), join(dir, "node_modules"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "main")
  git(dir, "checkout", "-q", "-b", "trak/related")
  writeFileSync(join(dir, "b.js"), "export const b = 2\n")
  git(dir, "commit", "-q", "-am", "the earlier step")
  return { dir, passed: git(dir, "rev-parse", "HEAD^{tree}") }
}

/** `path` in the project, rewritten. */
export const edit = (dir: string, path: string): void => {
  writeFileSync(join(dir, path), `${readFileSync(join(dir, path), "utf8")}// edited\n`)
}

/**
 * The runner's `--related` run of `pnpm test` in the project: what it printed, and the test
 * files that ran, sorted. `passed` and `base` are handed over as the engine hands them,
 * `ORKESTRA_PASSED_TREE` and `ORKESTRA_BASE_COMMIT`. The engine's own variables and vitest's
 * from this run are left out, so the run writes no units into the engine's files and its
 * vitest is not a worker of this one.
 */
export const related = (
  dir: string,
  passed?: string,
  base?: string,
): { out: string; ran: string[] } => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith("ORKESTRA_") && !name.startsWith("VITEST") && name !== "NODE_OPTIONS",
    ),
  )
  const run = spawnSync(
    process.execPath,
    [CHECK_STAGES, "--related", "--select", "select.yaml", "pnpm test"],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...env,
        ...(passed === undefined ? {} : { ORKESTRA_PASSED_TREE: passed }),
        ...(base === undefined ? {} : { ORKESTRA_BASE_COMMIT: base }),
      },
    },
  )
  if (run.status !== 0)
    throw new Error(`check-stages exited ${run.status}:\n${run.stdout}${run.stderr}`)
  const ran = join(dir, "ran")
  return {
    out: run.stdout,
    ran: existsSync(ran) ? readFileSync(ran, "utf8").trim().split("\n").sort() : [],
  }
}
