// `test/support/run-tmpdir.ts` under a real vitest: a run's temp directory goes when the run
// ends, when it is stopped with SIGTERM, and — after a SIGKILL — at the next run's start,
// and a live run's survives that sweep.
//
// The scratch is under `/tmp` rather than the temp directory this run owns: a run's folder
// under that one would pass the byte budget the setup holds it to.

import { type ChildProcess, spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it, vi } from "vitest"
import { setup } from "./support/run-tmpdir.js"

const SETUP = fileURLToPath(new URL("./support/run-tmpdir.ts", import.meta.url))
const VITEST = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url))

const scratch = realpathSync(mkdtempSync("/tmp/ort-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A project of one test that names the temp directory it sees, then waits forever, or passes. */
const fixture = (name: string, hangs: boolean): { dir: string; tmp: string; seen: string } => {
  const dir = join(scratch, name)
  const tmp = join(dir, "tmp")
  const seen = join(dir, "seen")
  mkdirSync(tmp, { recursive: true })
  writeFileSync(
    join(dir, "vitest.config.mjs"),
    `export default { test: { globalSetup: [${JSON.stringify(SETUP)}], testTimeout: 600000 } }\n`,
  )
  writeFileSync(
    join(dir, "one.test.mjs"),
    [
      `import { writeFileSync } from "node:fs"`,
      `import { tmpdir } from "node:os"`,
      `test("one", async () => {`,
      `  writeFileSync(${JSON.stringify(seen)}, tmpdir())`,
      hangs ? `  await new Promise(() => {})` : "",
      `})`,
      "",
    ].join("\n"),
  )
  return { dir, tmp, seen }
}

/** vitest on `dir`, in a process group of its own so a SIGKILL takes its workers too. */
const vitest = (dir: string, tmp: string): ChildProcess =>
  spawn(process.execPath, [VITEST, "run", "--globals", "--root", dir], {
    cwd: dir,
    env: { ...process.env, TMPDIR: tmp },
    detached: true,
    stdio: "ignore",
  })

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.once("exit", () => resolve())
  })

/** The run's temp directory, once its test has named it. */
const runFolder = (seen: string): Promise<string> =>
  vi.waitFor(() => readFileSync(seen, "utf8"), { timeout: 30_000, interval: 100 })

describe("a run's temp directory", () => {
  it("is removed when the run finishes", async () => {
    const { dir, tmp, seen } = fixture("finishes", false)
    const child = vitest(dir, tmp)
    await exited(child)
    const folder = readFileSync(seen, "utf8")
    expect(folder.startsWith(`${tmp}/ork`)).toBe(true)
    expect(readdirSync(tmp)).toStrictEqual([])
  }, 60_000)

  it("is removed when the run is stopped with SIGTERM", async () => {
    const { dir, tmp, seen } = fixture("term", true)
    const child = vitest(dir, tmp)
    const folder = await runFolder(seen)
    expect(existsSync(folder)).toBe(true)
    child.kill("SIGTERM")
    await exited(child)
    expect(existsSync(folder)).toBe(false)
  }, 60_000)

  it("is swept by the next run after a SIGKILL, and a live run's is not", async () => {
    const { dir, tmp, seen } = fixture("kill", true)
    const killed = vitest(dir, tmp)
    const dead = await runFolder(seen)
    const pid = killed.pid ?? 0
    process.kill(-pid, "SIGKILL")
    await exited(killed)
    expect(existsSync(dead)).toBe(true)
    // A run that is still going, as this test's own process stands for one.
    const live = join(tmp, `ork${process.pid.toString(36)}`)
    mkdirSync(live)
    writeFileSync(join(live, ".orkestra-run"), "")
    const next = fixture("next", false)
    await exited(vitest(next.dir, tmp))
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(live)).toBe(true)
  }, 60_000)

  it("is the one a vitest started inside a run works in, and leaves for that run to remove", () => {
    const outer = realpathSync(tmpdir())
    const teardown = setup()
    try {
      expect(realpathSync(tmpdir())).toBe(outer)
      // The folder it would have made; the listing itself moves with every other worker.
      expect(existsSync(join(outer, `ork${process.pid.toString(36)}`))).toBe(false)
    } finally {
      teardown()
    }
    expect(existsSync(outer)).toBe(true)
  })

  it("is refused past its byte budget, naming the path", () => {
    const long = join(scratch, "x".repeat(64))
    mkdirSync(long)
    const before = process.env["TMPDIR"]
    process.env["TMPDIR"] = long
    try {
      expect(setup).toThrow(`${long}/ork${process.pid.toString(36)} is `)
    } finally {
      process.env["TMPDIR"] = before
    }
  })
})
