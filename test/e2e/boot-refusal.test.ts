// The engine's boot on SQLite: `pnpm serve` refuses a project still holding a store file an
// older engine read, and refuses `ORKESTRA_STORE` itself, since this engine opens no external
// store. Each refusal prints one sentence and exits before anything is built.

import { execFileSync, spawn } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
const TSX = import.meta.resolve("tsx")

const SERVE = new URL("../../src/serve.ts", import.meta.url).pathname
const RUNNER = new URL("../fixtures/runner/runner.sh", import.meta.url).pathname

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "orkestra-boot-refusal-")))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** An external store whose process is never started — the refusal comes first. */
const STORE_ENV: Readonly<Record<string, string>> = { ORKESTRA_STORE: "/bin/false" }

/** A project under `name`, with what each case leaves out. */
const projectWith = (
  name: string,
  has: { readonly storeFile?: boolean; readonly origin: boolean; readonly runner: boolean },
): string => {
  const root = join(scratch, name)
  mkdirSync(join(root, ".orkestra"), { recursive: true })
  if (has.storeFile === true) {
    writeFileSync(join(root, ".orkestra", "store.sh"), "#!/bin/bash\nexit 1\n")
    chmodSync(join(root, ".orkestra", "store.sh"), 0o755)
  }
  if (has.runner) copyFileSync(RUNNER, join(root, ".orkestra", "runner.sh"))
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root })
  if (has.origin) {
    execFileSync("git", ["remote", "add", "origin", join(scratch, "nowhere.git")], { cwd: root })
  }
  return root
}

/** `pnpm serve` over `root`, with `store` in its environment: its exit code and everything it printed. */
const served = (root: string, store: Readonly<Record<string, string>>) =>
  new Promise<{ readonly code: number | null; readonly said: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: join(scratch, "home"),
      ORKESTRA_API_PORT: "0",
      ...store,
    }
    const child = spawn(process.execPath, ["--import", TSX, SERVE, "--dir", root], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let said = ""
    child.stdout.on("data", (chunk: Buffer) => {
      said += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      said += chunk.toString()
    })
    child.once("exit", (code) => {
      resolve({ code, said })
    })
  })

describe("an engine booted on SQLite", () => {
  it("refuses a project still holding a store file an older engine read, in one sentence", async () => {
    const { code, said } = await served(
      projectWith("left", { storeFile: true, origin: true, runner: true }),
      {},
    )
    expect(code).toBe(1)
    const lines = said.split("\n").filter((line) => line.startsWith("refused: "))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("is a store file, which no engine reads any more")
  }, 30_000)

  it("refuses ORKESTRA_STORE in one sentence, and opens no store", async () => {
    const root = projectWith("public", { origin: true, runner: true })
    const { code, said } = await served(root, STORE_ENV)
    expect(code).toBe(1)
    const lines = said.split("\n").filter((line) => line.startsWith("refused: "))
    expect(lines).toEqual([
      "refused: ORKESTRA_STORE names an external store, which only a hosted engine opens — this engine runs on SQLite. Unset ORKESTRA_STORE to boot.",
    ])
    expect(existsSync(join(root, ".orkestra", ".database"))).toBe(false)
  }, 30_000)
})
