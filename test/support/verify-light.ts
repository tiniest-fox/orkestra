// What the `verify-light*.test.ts` files share: `.orkestra/checks/verify-light.sh`, run
// whole in a repository of its own, and what its test stage selects, measured from the tree
// the check last passed on. Each case is a real vitest run inside the check, so the cases
// are spread over several files: one file runs on one worker, and its cases one at a time.
//
// The repository copies the two check scripts and their selection tables, and stubs every stage but the root suite,
// which is real vitest over a few source files and their tests, so what the stage reports
// is vitest's own selection.

import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { onTestFinished } from "vitest"
import { addOrigin, git } from "./git.js"

export const CHECKS = fileURLToPath(new URL("../../.orkestra/checks/", import.meta.url))
const MODULES = fileURLToPath(new URL("../../node_modules", import.meta.url))
const STAGES = fileURLToPath(new URL("../../src/check-stages.ts", import.meta.url))

export const json = (value: unknown): string => `${JSON.stringify(value, undefined, 2)}\n`

/** A workspace with the scripts `verify.sh` narrows, and the apps it checks. */
const workspace = (dir: string): void => {
  writeFileSync(
    join(dir, "package.json"),
    json({
      name: "fixture",
      private: true,
      scripts: {
        verify:
          "pnpm fmt:check && pnpm check && pnpm lint && pnpm knip && pnpm docs:check && pnpm test && pnpm --filter @orkestra/client verify && pnpm --filter @orkestra/desktop verify",
        "fmt:check": "true",
        check: "tsc --noEmit && tsc --noEmit -p shared",
        lint: "oxlint src test shared && oxlint client && oxlint desktop",
        knip: "true",
        "docs:check": "true",
        test: "vitest run --globals",
      },
    }),
  )
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - client\n  - desktop\n")
  for (const app of ["client", "desktop"]) {
    mkdirSync(join(dir, app))
    writeFileSync(
      join(dir, app, "package.json"),
      json({
        name: `@orkestra/${app}`,
        private: true,
        scripts: {
          verify: "pnpm check && pnpm test && pnpm build",
          check: "tsc --noEmit",
          test: "vitest run",
        },
      }),
    )
  }
  mkdirSync(join(dir, ".orkestra", "checks"), { recursive: true })
  for (const script of ["verify.sh", "verify-light.sh", "verify.select.yaml"]) {
    copyFileSync(join(CHECKS, script), join(dir, ".orkestra", "checks", script))
  }
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src", "sum.ts"), "export const sum = (a: number, b: number) => a + b\n")
  writeFileSync(
    join(dir, "src", "sum.test.ts"),
    'import { sum } from "./sum"\n\nit("adds", () => expect(sum(1, 2)).toBe(3))\n',
  )
  // A template, read off disk by the module that loads them, and a test that imports it.
  mkdirSync(join(dir, "src", "prompts", "templates"), { recursive: true })
  mkdirSync(join(dir, "src", "prompts", "adapters"))
  writeFileSync(join(dir, "src", "prompts", "templates", "step.md"), "Do the step.\n")
  writeFileSync(
    join(dir, "src", "prompts", "adapters", "builtin.ts"),
    'import { readFileSync } from "node:fs"\n\nexport const step = () => readFileSync(new URL("../templates/step.md", import.meta.url), "utf8")\n',
  )
  writeFileSync(
    join(dir, "src", "prompts", "adapters", "builtin.test.ts"),
    'import { step } from "./builtin"\n\nit("reads", () => expect(step()).toContain("step"))\n',
  )
  // The test that reads the check scripts, and one that reads the shipped fleet.
  mkdirSync(join(dir, "test", "e2e"), { recursive: true })
  writeFileSync(join(dir, "test", "verify-light.test.ts"), 'it("reads", () => {})\n')
  writeFileSync(join(dir, "test", "e2e", "open-pr.test.ts"), 'it("reads", () => {})\n')
  mkdirSync(join(dir, "src", "library", "shipped", "agents"), { recursive: true })
  writeFileSync(join(dir, "src", "library", "shipped", "agents", "build.md"), "Build it.\n")
  // An engine a test starts as a child process, and a module of the engine's that no test
  // imports: the test reaches the module only through the child. The test leaves a mark
  // where it ran, so a case can tell it ran rather than another file.
  mkdirSync(join(dir, "src", "app"))
  writeFileSync(
    join(dir, "src", "app", "expiry-sweep.ts"),
    'export const gone = "its holder is gone"\n',
  )
  mkdirSync(join(dir, "test", "support"))
  writeFileSync(
    join(dir, "test", "support", "fake-engine.ts"),
    'import { gone } from "../../src/app/expiry-sweep"\n\nconsole.log(gone)\n',
  )
  writeFileSync(
    join(dir, "test", "support", "host.ts"),
    'export const ENGINE = new URL("./fake-engine.ts", import.meta.url).pathname\n',
  )
  writeFileSync(
    join(dir, "test", "e2e", "engine-boot.test.ts"),
    'import { writeFileSync } from "node:fs"\nimport { ENGINE } from "../support/host"\n\nit("starts", () => writeFileSync(new URL("ran", import.meta.url), ENGINE))\n',
  )
  modules(dir)
  writeFileSync(join(dir, ".gitignore"), "node_modules\nran\n")
}

/**
 * This repository's packages, as a checkout has its own — the check lists through vitest's
 * API — beside a `.bin` whose `tsc` and `oxlint` only append the directory they ran in and
 * their arguments to `ran`, which `ranStatic` reads.
 */
const modules = (dir: string): void => {
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true })
  for (const name of readdirSync(MODULES)) {
    // pnpm 12 refuses a task-run state directory that is a link, so each copy keeps its own.
    if (name !== ".bin" && name !== ".pnpm-task-run-state-v1")
      symlinkSync(join(MODULES, name), join(dir, "node_modules", name))
  }
  for (const tool of ["tsc", "oxlint"]) {
    const bin = join(dir, "node_modules", ".bin", tool)
    writeFileSync(
      bin,
      `#!/bin/sh\nroot=$(cd "$(dirname "$0")/../.." && pwd -P)\nprintf '.%s: ${tool} %s\\n' "$(pwd -P | sed "s|^$root||")" "$*" >> "$root/ran"\n`,
    )
    chmodSync(bin, 0o755)
  }
}

/** What the fake `tsc` and `oxlint` ran, one `<dir>: <command>` a line, sorted. */
export const ranStatic = (dir: string): string[] =>
  existsSync(join(dir, "ran"))
    ? readFileSync(join(dir, "ran"), "utf8").trim().split("\n").sort()
    : []

/**
 * What the check prints and how it exits, run as the engine runs it: no arguments, from the
 * checkout, handed the stage runner, and handed the tree it last passed on and the file of
 * units already proven where there are. The engine's other variables, and vitest's from the run this test is in, are left
 * out, so the check writes no units into the engine's files and its vitest is not a worker
 * of ours.
 */
export const lightRun = (
  dir: string,
  passedTree?: string,
  proven?: string,
): { status: number; out: string } => {
  const stripped = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith("ORKESTRA_") &&
        !name.startsWith("VITEST") &&
        name !== "VERIFY_PART" &&
        name !== "NODE_OPTIONS",
    ),
  )
  // The copy's node_modules links this checkout's, so pnpm checking it against the copy's
  // lockfile is meaningless, and pnpm 12 answers a mismatch by installing over the links. A
  // `pnpm` parent sets these for its children; the engine's stage runner starts vitest bare.
  const handed = {
    ...stripped,
    ORKESTRA_STAGES: STAGES,
    pnpm_config_verify_deps_before_run: "false",
    npm_config_verify_deps_before_run: "false",
  }
  const env = {
    ...handed,
    ...(passedTree === undefined ? {} : { ORKESTRA_PASSED_TREE: passedTree }),
    ...(proven === undefined ? {} : { ORKESTRA_UNITS_PROVEN: proven }),
  }
  const run = spawnSync("bash", [join(".orkestra", "checks", "verify-light.sh")], {
    cwd: dir,
    env,
    encoding: "utf8",
  })
  return { status: run.status ?? 1, out: run.stdout }
}

/** What a passing check prints. A failing one throws with what it printed. */
export const verifyLight = (dir: string, passedTree?: string): string => {
  const { status, out } = lightRun(dir, passedTree)
  if (status !== 0) throw new Error(`verify-light exited ${status}:\n${out}`)
  return out
}

/** The root test stage's line in a passing run. */
export const testStage = (out: string): string =>
  out.split("\n").find((line) => /^[✓–] pnpm test/.test(line)) ?? out

/**
 * A trak's branch whose one earlier step changed `sum.ts` and was committed, as the engine
 * commits every step's work, and the tree that step passed its checks on.
 */
export const branch = (): { dir: string; passed: string } => {
  const dir = mkdtempSync(join(tmpdir(), "verify-light-"))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, "init", "-q", "-b", "main")
  workspace(dir)
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "main")
  onTestFinished(addOrigin(dir).remove)
  git(dir, "checkout", "-q", "-b", "trak/light")
  writeFileSync(join(dir, "src", "sum.ts"), "export const sum = (a: number, b: number) => b + a\n")
  git(dir, "commit", "-q", "-am", "the earlier step")
  return { dir, passed: git(dir, "rev-parse", "HEAD^{tree}") }
}

/** The branch with one file rewritten. */
export const edited = (path: string): { dir: string; out: string } => {
  const { dir, passed } = branch()
  writeFileSync(join(dir, path), `${readFileSync(join(dir, path), "utf8")}// edited\n`)
  return { dir, out: verifyLight(dir, passed) }
}
