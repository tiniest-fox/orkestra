// One temp directory per vitest run: `TMPDIR` points into it before any worker starts, so
// every folder a test or a helper makes through `os.tmpdir()` goes with it when the run
// ends. No test or helper removes its own — a run stopped at a check's timeout never runs
// that removal, and the folders it left filled the machine's temp directory.
//
// The run's folder is removed in three places, because no one of them always runs:
//
// - `teardown`, at the end of a run that finished;
// - an `exit` handler, on SIGTERM, SIGINT or a crash — vitest answers a signal with
//   `process.exit()` and skips teardown, but Node still fires `exit`, inside the engine's
//   grace before SIGKILL;
// - the sweep at the start of every run, for a run that was SIGKILLed, or whose `exit`
//   handler was still removing when the grace ran out.
//
// **The owner's process id is in the folder's name, never in a file.** Under
// `fingerprint:` the recording hook records every file the runner reads as an input of
// every test file, and a marker read back from a folder gone by the next run would fail
// every print. It records no listing, removal or `kill` in the runner, which is all the
// sweep does.

import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A run's folder: `ork` and the owner's pid in base 36, beside a marker that tells it from
 * anything else of that name.
 */
const NAMED = /^ork([0-9a-z]+)$/
const MARKER = ".orkestra-run"

/**
 * The longest a run's folder may be, in bytes. A Unix socket's path is at most 104 bytes on
 * macOS, and a test opens `hub.sock` in a folder of its own under this one: 64 leaves 40
 * for `/<prefix>XXXXXX/hub.sock`, so a socket test's prefix is at most 24 bytes.
 */
const BUDGET = 64

/**
 * The run's folder, for the processes it starts. A vitest a test starts inherits it and
 * works inside it rather than making one of its own there: one run's folder inside
 * another's passes the budget on macOS, whose temp directory alone is 49 bytes, and the
 * outer run removes everything under its folder anyway. Not `ORKESTRA_*`: a check's process
 * loses the engine's own variables, and the vitest a check runs inside a test needs this.
 */
const OWNED = "ORK_RUN_TMPDIR"

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists and is not ours.
    return error instanceof Error && Reflect.get(error, "code") === "EPERM"
  }
}

/** Removes every run folder whose owner is gone; a live run's, in another checkout too, stays. */
const sweep = (root: string): void => {
  for (const name of readdirSync(root)) {
    const pid = NAMED.exec(name)?.[1]
    if (pid === undefined) continue
    const dir = join(root, name)
    if (!existsSync(join(dir, MARKER))) continue
    const owner = Number.parseInt(pid, 36)
    if (owner !== process.pid && alive(owner)) continue
    rmSync(dir, { recursive: true, force: true })
  }
}

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/** The run's folder, made, and `TMPDIR` pointed at it; returns what undoes both. */
export const setup = (): (() => void) => {
  const root = realpathSync(tmpdir())
  if (process.env[OWNED] === root) return () => undefined
  const before = { tmp: process.env["TMPDIR"], owned: process.env[OWNED] }
  sweep(root)
  const dir = join(root, `ork${process.pid.toString(36)}`)
  if (Buffer.byteLength(dir) > BUDGET) {
    throw new Error(
      `${dir} is ${String(Buffer.byteLength(dir))} bytes, over the ${String(BUDGET)} a run's temp directory may take: a test's socket under it would pass the 104 bytes macOS allows. Point TMPDIR at a shorter directory.`,
    )
  }
  mkdirSync(dir)
  writeFileSync(join(dir, MARKER), "")
  const remove = (): void => rmSync(dir, { recursive: true, force: true })
  process.on("exit", remove)
  process.env["TMPDIR"] = dir
  process.env[OWNED] = dir
  return () => {
    // The stage runner runs one suite after another in one process, so the next one's
    // setup has to find the temp directory as this one did.
    restore("TMPDIR", before.tmp)
    restore(OWNED, before.owned)
    process.off("exit", remove)
    remove()
  }
}
