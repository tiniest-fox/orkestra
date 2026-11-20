// `pnpm --filter @orkestra/desktop install-app` — the packaged `Orkestra.app` into
// `/Applications`, replacing whatever is there. The last step of `pnpm app`.
//
// One input, built first and reported by name when missing: the bundle `package.ts`
// writes. `/Applications` is writable by the user on a Mac they administer, so no sudo.
//
// A running Orkestra is quit first — its process would otherwise keep running on files
// that are gone — and that stops every engine the app itself started, exactly as Quit
// from the menu does. The app asks before quitting when a trak on one of those engines
// is mid-turn, so the quit is waited for rather than assumed: if it has not gone within
// the deadline, this fails and says why, and nothing in `/Applications` has been touched.
//
// The target path only ever holds a whole app. The copy is staged beside it, the old app
// is moved aside — never deleted first: `fs.rm` works depth-first, so a delete that
// fails part-way has already taken `Info.plist` and `MacOS/` and leaves a bundle that
// cannot launch — the staged copy is renamed in, and only then is the displaced app
// removed. Each move is one `rename` inside `/Applications`, which needs write
// permission on the folder alone. A displaced app that cannot be removed is reported
// and left, since the new one is installed by then. `ditto` is what macOS itself copies
// bundles with — it keeps the signature, the symlinks under `Frameworks/` and every
// mode bit.

import { execFile } from "node:child_process"
import { lstat, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const run = promisify(execFile)

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = join(HERE, "build")

const NAME = "Orkestra"
const BUNDLE_ID = "dev.orkestra.desktop"

const arch = process.arch === "arm64" ? "arm64" : "x64"
const BUNDLE = join(BUILD, `${NAME}-darwin-${arch}`, `${NAME}.app`)
const TARGET = join("/Applications", `${NAME}.app`)
// Neither is `.app`, so Launch Services never sees a second Orkestra while a swap is in flight.
const STAGING = join("/Applications", `.${NAME}.installing`)
const DISPLACED = join("/Applications", `.${NAME}.previous`)

const QUIT_DEADLINE_MS = 30_000
const QUIT_POLL_MS = 500

const present = async (path: string, writtenBy: string): Promise<void> => {
  await readFile(join(path, "Contents", "Info.plist")).catch(() => {
    throw new Error(`${path} is missing — \`${writtenBy}\` writes it`)
  })
}

/**
 * Asked of System Events by bundle id, so a shell run from a checkout does not count.
 * Not `application id "…" is running`: that errors on a machine where no app carries
 * the id, which is every first install.
 */
const isRunning = async (): Promise<boolean> => {
  const { stdout } = await run("osascript", [
    "-e",
    `tell application "System Events" to (bundle identifier of processes) contains "${BUNDLE_ID}"`,
  ])
  return stdout.trim() === "true"
}

/** Recursive rather than a loop: one look at a time, the next taken only after a pause. */
const gone = async (deadline: number): Promise<void> => {
  if (!(await isRunning())) return
  if (Date.now() > deadline) {
    throw new Error(
      `${NAME} is still running after ${String(QUIT_DEADLINE_MS / 1000)}s — it may be asking ` +
        "whether to stop a turn in flight. Answer it, or quit it yourself, then run " +
        "`pnpm --filter @orkestra/desktop install-app` again. Nothing was replaced.",
    )
  }
  await sleep(QUIT_POLL_MS)
  return gone(deadline)
}

const quit = async (): Promise<void> => {
  // Returns once the app has taken the event, not once it has exited — the app may be
  // asking about a turn in flight, which is what the wait is for.
  await run("osascript", ["-e", `tell application id "${BUNDLE_ID}" to quit`])
  await gone(Date.now() + QUIT_DEADLINE_MS)
}

await present(BUNDLE, "pnpm --filter @orkestra/desktop package")

if (await isRunning()) {
  console.log(`${NAME} is running — quitting it first (this stops any engine it started)`)
  await quit()
  console.log(`quit ${NAME}`)
}

// Leftovers of a run that died mid-swap. An unremovable `.previous` fails here, before
// anything is copied — the same failure, one run earlier, is the only way one exists.
await rm(STAGING, { recursive: true, force: true })
await rm(DISPLACED, { recursive: true, force: true })

await run("ditto", [BUNDLE, STAGING])
const installed = await lstat(TARGET).then(
  () => true,
  () => false,
)
if (installed) await rename(TARGET, DISPLACED)
await rename(STAGING, TARGET)
console.log(`installed ${TARGET}`)

if (installed) {
  await rm(DISPLACED, { recursive: true, force: true }).catch((e: unknown) => {
    console.log(`the previous app is still at ${DISPLACED} — remove it yourself: ${String(e)}`)
  })
}
