// `src/check-stages.ts`, run the way a check script runs it: `node "$ORKESTRA_STAGES"
// 'pnpm test'` in a project of its own, with the unit files and the recording setup file the
// engine hands a check. At the root beside `docs-check.test.ts` for the same reason: an
// entry-point script that is neither a flow nor a contract.
//
// The project is a fresh directory whose `node_modules` links to this checkout's, so its
// vitest and its happy-dom are the ones this repository runs. Its config names no setup file of
// the engine's and no `server.fs.allow`, as a project that has not adopted the recording
// would; the setup file stands in for the engine's and sits outside the project, as the
// engine's install does.

import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { CHECK_STAGES, PACKAGE_ROOT } from "../src/app/packaged.js"

/**
 * `dir`'s `node_modules` as a real directory holding a link to each entry of this checkout's.
 * pnpm 12 refuses a project whose `node_modules`, or its task state inside, is a symlink.
 */
const linkModules = (dir: string): void => {
  const from = join(PACKAGE_ROOT, "node_modules")
  const to = join(dir, "node_modules")
  mkdirSync(to)
  // pnpm's own state is left out: it refuses to write through a link.
  for (const entry of readdirSync(from).filter((e) => !e.startsWith(".pnpm-"))) {
    symlinkSync(join(from, entry), join(to, entry))
  }
}

/** A test file that notes it ran, then asserts `body`. */
const testFile = (name: string, body: string): string => `import { appendFileSync } from "node:fs"
import { expect, test } from "vitest"
appendFileSync("ran", "${name}\\n")
test("${name}", () => {
  ${body}
})
`

const PROJECT: Record<string, string> = {
  "package.json": `{ "type": "module", "scripts": { "test": "vitest run" } }\n`,
  "vitest.config.js": `import { defineConfig } from "vitest/config"
export default defineConfig({
  test: { environment: "happy-dom", include: ["*.test.js"], setupFiles: ["./own-setup.js"] },
})
`,
  "own-setup.js": `globalThis.order = [...(globalThis.order ?? []), "own"]\n`,
  "passes.test.js": testFile("passes", "expect(1).toBe(1)"),
  "proven.test.js": testFile("proven", "expect(1).toBe(1)"),
  "fails.test.js": testFile("fails", "expect(1).toBe(2)"),
  "setup.test.js": testFile(
    "setup",
    `expect(typeof document.createElement).toBe("function")
  expect(globalThis.order).toEqual(["recording", "own"])`,
  ),
}

/**
 * This process's environment less the engine's unit files. Under a check, the engine hands
 * this suite its own `ORKESTRA_UNITS_PROVEN` and `ORKESTRA_UNITS_OUT`. A fixture run that
 * inherited them would skip a fixture file the engine's list happens to name, and would
 * write the fixture's files into the engine's record.
 */
const ownEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("ORKESTRA_UNITS_")),
  )

const lines = (file: string): readonly string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .sort()

describe("check-stages, on a test stage", () => {
  it("leaves out proven files, records passing ones and lists the setup file under happy-dom", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "check-stages-")))
    for (const [name, text] of Object.entries(PROJECT)) writeFileSync(join(dir, name), text)
    linkModules(dir)
    const engine = realpathSync(mkdtempSync(join(tmpdir(), "check-stages-engine-")))
    const setup = join(engine, "recording.js")
    writeFileSync(setup, `globalThis.order = [...(globalThis.order ?? []), "recording"]\n`)
    writeFileSync(join(engine, "proven"), "proven.test.js\n")
    writeFileSync(join(engine, "out"), "")

    const ran = spawnSync(process.execPath, [CHECK_STAGES, "pnpm test"], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...ownEnv(),
        ORKESTRA_UNITS_PROVEN: join(engine, "proven"),
        ORKESTRA_UNITS_OUT: join(engine, "out"),
        ORKESTRA_RECORDING_VITEST: setup,
      },
    })

    expect({ status: ran.status, output: ran.stdout + ran.stderr }).toMatchObject({ status: 1 })
    expect(ran.stdout).toContain("test files: 3 ran, 1 already proven")
    expect(lines(join(dir, "ran"))).toEqual(["fails", "passes", "setup"])
    expect(lines(join(engine, "out"))).toEqual(["passes.test.js", "setup.test.js"])
    // The report is plain text, even where the worker drew the assertion's diff in color.
    expect(ran.stdout).toContain("FAIL fails.test.js > fails")
    expect(ran.stdout).not.toContain("\u001b[")
  }, 60_000)
})

/** A project of failing test files beside one that passes, and its stage's run. */
const FAILING: Record<string, string> = {
  "package.json": `{ "type": "module", "scripts": { "test": "vitest run" } }\n`,
  "vitest.config.js": `export default { test: { include: ["*.test.js"] } }\n`,
  "assertion.test.js": `import { expect, test } from "vitest"
test("compares", () => {
  expect({ a: 1 }).toEqual({ a: 2 })
})
`,
  "thrown.test.js": `import { test } from "vitest"
test("throws (once)", () => {
  throw new Error("boom")
})
`,
  "hook.test.js": `import { beforeAll, describe, test } from "vitest"
describe("a suite", () => {
  beforeAll(() => {
    throw new Error("the hook failed")
  })
  test("never starts", () => {})
})
`,
  "chatty.test.js": `import { expect, test } from "vitest"
test("talks", () => {
  for (let at = 0; at < 35; at++) console.log(\`line \${at}\`)
  expect(true).toBe(false)
})
`,
  "passes.test.js": `import { expect, test } from "vitest"
test("passes", () => expect(1).toBe(1))
`,
}

describe("check-stages, on a failing test stage", () => {
  it("reports each failure from vitest's errors, capped, in path order, with its rerun", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-stages-failing-"))
    for (const [name, text] of Object.entries(FAILING)) writeFileSync(join(dir, name), text)
    linkModules(dir)

    const ran = spawnSync(process.execPath, [CHECK_STAGES, "pnpm test"], {
      cwd: dir,
      encoding: "utf8",
      env: ownEnv(),
    })

    expect(ran.status).toBe(1)
    expect(ran.stdout).toBe(
      [
        "→ pnpm test",
        "`pnpm test` failed, and nothing after it ran.",
        "",
        "test files: 5 ran, 0 already proven",
        "",
        "FAIL assertion.test.js > compares",
        "    AssertionError: expected { a: 1 } to deeply equal { a: 2 }",
        "",
        "    - Expected",
        "    + Received",
        "",
        "      {",
        '    -   "a": 2,',
        '    +   "a": 1,',
        "      }",
        "    at assertion.test.js:3:20",
        "  rerun: pnpm test assertion.test.js -t 'compares'",
        "",
        "FAIL chatty.test.js > talks",
        "    AssertionError: expected true to be false // Object.is equality",
        "",
        "    - Expected",
        "    + Received",
        "",
        "    - false",
        "    + true",
        "    at chatty.test.js:4:16",
        "  console:",
        ...Array.from({ length: 30 }, (_, at) => `    line ${at}`),
        "    (5 more lines of console output)",
        "  rerun: pnpm test chatty.test.js -t 'talks'",
        "",
        "FAIL hook.test.js > a suite",
        "    Error: the hook failed",
        "    at hook.test.js:4:11",
        "  rerun: pnpm test hook.test.js",
        "",
        "FAIL thrown.test.js > throws (once)",
        "    Error: boom",
        "    at thrown.test.js:3:9",
        "  rerun: pnpm test thrown.test.js -t 'throws \\(once\\)'",
        "",
      ].join("\n"),
    )
  }, 60_000)

  it("passes in one line, naming how many files ran and how many were proven", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-stages-passing-"))
    for (const [name, text] of Object.entries(FAILING)) writeFileSync(join(dir, name), text)
    linkModules(dir)
    const proven = join(dir, "proven")
    writeFileSync(proven, "assertion.test.js\n")

    const ran = spawnSync(process.execPath, [CHECK_STAGES, "pnpm test passes assertion"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...ownEnv(), ORKESTRA_UNITS_PROVEN: proven },
    })

    expect({ status: ran.status, stdout: ran.stdout }).toEqual({
      status: 0,
      stdout:
        "→ pnpm test passes assertion\n✓ pnpm test passes assertion — test files: 1 ran, 1 already proven\n",
    })
  }, 60_000)
})

/** A test whose child writes to stderr through the worker's stdio, then asserts `body`. */
const childTest = (
  name: string,
  body: string,
): string => `import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"
test("${name}", () => {
  spawnSync(process.execPath, ["-e", "console.error('from the child')"], { stdio: "inherit" })
  ${body}
})
`

const CHILD: Record<string, string> = {
  "package.json": `{ "type": "module", "scripts": { "test": "vitest run" } }\n`,
  "vitest.config.js": `export default { test: { include: ["*.test.js"] } }\n`,
  "child-passes.test.js": childTest("passes", "expect(1).toBe(1)"),
  "child-fails.test.js": childTest("fails", "expect(1).toBe(2)"),
}

describe("check-stages, on a test whose child writes past vitest's console capture", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-stages-child-"))
  for (const [name, text] of Object.entries(CHILD)) writeFileSync(join(dir, name), text)
  linkModules(dir)
  const run = (filter: string): { status: number | null; stdout: string; stderr: string } => {
    const ran = spawnSync(process.execPath, [CHECK_STAGES, `pnpm test ${filter}`], {
      cwd: dir,
      encoding: "utf8",
      env: ownEnv(),
    })
    return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr }
  }

  it("prints only the pass lines where the stage passes", () => {
    expect(run("child-passes")).toEqual({
      status: 0,
      stdout:
        "→ pnpm test child-passes\n✓ pnpm test child-passes — test files: 1 ran, 0 already proven\n",
      stderr: "",
    })
  }, 60_000)

  it("shows what the child wrote under the failure's report", () => {
    const { status, stdout, stderr } = run("child-fails")
    expect({ status, stderr }).toEqual({ status: 1, stderr: "" })
    expect(stdout).toContain(
      "  rerun: pnpm test child-fails.test.js -t 'fails'\n\nPrinted outside any test's console output:\n\nfrom the child\n",
    )
    expect(stdout.endsWith("from the child\n")).toBe(true)
  }, 60_000)
})

/**
 * A workspace whose root chain reaches a package's chain and a suite, beside two packages
 * `-r` reaches, and scripts whose output a case reads. The root's own `hello` fails, so a
 * run that took the root for one of `-r`'s packages says so.
 */
const WORKSPACE: Record<string, string> = {
  "package.json": `${JSON.stringify({
    name: "fixture",
    type: "module",
    scripts: {
      verify: "pnpm lint && pnpm --filter @fixture/app verify && pnpm test",
      lint: "echo linted",
      test: "vitest run",
      say: "echo first && sh ./say.sh",
      noisy: "sh ./noisy.sh",
      each: "pnpm -r hello",
      hello: "exit 1",
    },
  })}\n`,
  "pnpm-workspace.yaml": "packages:\n  - app\n  - lib\n",
  "app/package.json": `${JSON.stringify({
    name: "@fixture/app",
    scripts: { verify: "pnpm hello && echo built", hello: "echo hello" },
  })}\n`,
  "lib/package.json": `${JSON.stringify({ name: "@fixture/lib", scripts: { hello: "echo hello" } })}\n`,
  "vitest.config.js": `export default { test: { include: ["*.test.js"] } }\n`,
  "passes.test.js": `import { expect, test } from "vitest"\ntest("passes", () => expect(1).toBe(1))\n`,
  "fails.test.js": `import { expect, test } from "vitest"\ntest("fails", () => expect(1).toBe(2))\n`,
  "say.sh": `echo "said: $*"\nexit 1\n`,
  // A duration in the two forms tools print one, then more lines than the cap keeps.
  "noisy.sh": `echo "Finished in 12ms on 3 files"\necho "lib/x.ts (3ms)"\necho\necho\nfor at in $(seq 1 250); do echo "line $at"; done\nexit 1\n`,
}

const workspace = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "check-stages-chain-"))
  for (const [name, text] of Object.entries(WORKSPACE)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  linkModules(dir)
  return dir
}

const stagesIn = (
  dir: string,
  ...args: readonly string[]
): { status: number | null; out: string } => {
  const ran = spawnSync(process.execPath, [CHECK_STAGES, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: ownEnv(),
  })
  return { status: ran.status, out: ran.stdout }
}

describe("check-stages, on a chain", () => {
  const dir = workspace()

  it("resolves a nested chain through --filter, and passes trailing words to its last part", () => {
    expect(stagesIn(dir, "pnpm verify passes")).toEqual({
      status: 0,
      out: [
        "✓ pnpm lint",
        "✓ pnpm --filter @fixture/app hello",
        "✓ echo built",
        "→ pnpm test passes",
        "✓ pnpm test passes — test files: 1 ran, 0 already proven",
        "",
      ].join("\n"),
    })
  }, 60_000)

  it("runs a -r script in every package that has it, and not the root", () => {
    expect(stagesIn(dir, "pnpm each")).toEqual({
      status: 0,
      out: "✓ pnpm --filter @fixture/app hello\n✓ pnpm --filter @fixture/lib hello\n",
    })
  }, 60_000)

  it("passes trailing words to the last part of a static chain", () => {
    expect(stagesIn(dir, "pnpm say hi")).toEqual({
      status: 1,
      out: "✓ echo first\n`sh ./say.sh hi` failed, and nothing after it ran.\n\nsaid: hi\n",
    })
  }, 60_000)

  it("reports a failing static stage without pnpm's lines or durations, its middle cut", () => {
    const numbered = Array.from({ length: 250 }, (_, at) => `line ${at + 1}`)
    expect(stagesIn(dir, "pnpm noisy")).toEqual({
      status: 1,
      out: [
        "`pnpm noisy` failed, and nothing after it ran.",
        "",
        "Finished on 3 files",
        "lib/x.ts",
        "",
        ...numbered.slice(0, 47),
        "",
        "(53 lines cut here. Run `pnpm noisy` to see them.)",
        "",
        ...numbered.slice(100),
        "",
      ].join("\n"),
    })
  }, 60_000)
})

describe("check-stages, on stages run together", () => {
  const dir = workspace()

  it("starts consecutive static stages together under --parallel, reporting in chain order", () => {
    // The first passes only where the second ran while it slept.
    const stages = ["sleep 1; test -f b-ran", "touch b-ran"]
    expect(stagesIn(dir, "--parallel", ...stages)).toEqual({
      status: 0,
      out: "✓ sleep 1; test -f b-ran\n✓ touch b-ran\n",
    })
  }, 60_000)

  it("reports only the earlier of two failing stages, whichever finished first", () => {
    expect(
      stagesIn(dir, "--parallel", "sleep 1; echo first; exit 1", "echo second; exit 1"),
    ).toEqual({
      status: 1,
      out: "`sleep 1; echo first; exit 1` failed, and nothing after it ran.\n\nfirst\n",
    })
  }, 60_000)

  it("stops at the first failing stage", () => {
    const { status, out } = stagesIn(dir, "pnpm test fails", "pnpm test passes")
    expect(status).toBe(1)
    expect(out).toContain("`pnpm test fails` failed, and nothing after it ran.")
    expect(out).not.toContain("pnpm test passes")
  }, 60_000)

  it("runs every test stage after a failure under --keep-going, and no static one", () => {
    const { status, out } = stagesIn(
      dir,
      "--keep-going",
      "pnpm test fails",
      "echo static",
      "pnpm test passes",
    )
    expect(status).toBe(1)
    expect(out).toContain("`pnpm test fails` failed.\n\ntest files: 1 ran, 0 already proven")
    expect(out.slice(out.indexOf("– echo static"))).toBe(
      [
        "– echo static, not run: a stage before it failed",
        "→ pnpm test passes",
        "✓ pnpm test passes — test files: 1 ran, 0 already proven",
        "",
        "Failed: `pnpm test fails`",
        "",
      ].join("\n"),
    )
  }, 60_000)
})
