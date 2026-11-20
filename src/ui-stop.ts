// `pnpm ui:stop [--dir <path>]` — stop the `pnpm ui` running for one project, and
// nothing else. `--dir` names the same repository the `pnpm ui` being stopped was given.
//
// **The pid comes from a record, and the record is confirmed before it is believed.**
// `daemon.json` names the pid and the port the engine actually bound, per project. It
// is also routinely stale: under `tsx` a ctrl-C SIGKILLs the daemon before its
// finalizers remove the file — see
// the deferred entry *a signal under tsx outruns the daemon's finalizers*. So a pid read from it is a claim about a process that may have
// exited weeks ago and had its number reissued to something else.
//
// The confirmation is `GET /api/health`, on **the port the record names** rather than
// the one this path derives. Two projects can hash to one pair, and whichever binds
// second steps past it — so the derivation says where a daemon started looking, not
// where it is. The record is what it reports after binding. Health answers with the
// project root, so the daemon there is *identified* rather than assumed, which is the
// same check `src/cli/http.ts` makes before sending a command to one.
//
// Sends SIGTERM, which `src/serve.ts` handles by interrupting its root fiber; the
// client goes with it, because `concurrently -k` kills the other half when one exits.

import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { answeringFor, projectDir, readDaemonRecord } from "./app/discovery.js"

/** The project whose engine is being stopped. */
const PROJECT = projectDir(process.argv.slice(2)).root

/**
 * How long to watch for the port to go quiet, as attempts at 200ms.
 *
 * Shutdown interrupts the drives in flight, and each one kills a `claude` — so this is
 * not instant, and reporting "stopped" while the engine is still unwinding would be the
 * kind of claim that sends someone to look for a process that is on its way out anyway.
 */
const ATTEMPTS = 15

/** Recursive rather than a loop: `no-await-in-loop`, and each probe waits on the last. */
const waitUntilGone = (port: number, root: string, left: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (left === 0) return false
    if ((yield* Effect.promise(() => answeringFor(port))) !== root) return true
    yield* Effect.sleep("200 millis")
    return yield* waitUntilGone(port, root, left - 1)
  })

const main = Effect.gen(function* () {
  const record = yield* readDaemonRecord(PROJECT)
  if (record === undefined) {
    console.log(`no engine is running for ${PROJECT}.`)
    return
  }

  const answering = yield* Effect.promise(() => answeringFor(record.port))

  // A record outliving its daemon is the ordinary case, not a fault: `tsx` SIGKILLs the
  // process before the finalizer that removes the file, so **every** clean stop leaves
  // one. Nothing is running, which is what a stop was asked for — so this says so and
  // succeeds. The file is left alone rather than tidied away: a daemon too busy to
  // answer within the timeout looks exactly like this from out here, and the record is
  // the only thing that would still name it.
  if (answering === undefined) {
    console.log(`no engine is running for ${PROJECT}.`)
    return
  }

  // Something *is* serving on that port and it is not us. That is the surprising one:
  // this project's record has been overtaken, so the pid it names belongs to nothing
  // known and may since have been reissued.
  if (answering !== record.cwd) {
    console.log(
      [
        `daemon.json names pid ${String(record.pid)} on port ${String(record.port)}, but`,
        `the engine answering there is ${answering}.`,
        ``,
        `Refusing to signal a pid this cannot identify. Clear the record with:`,
        ``,
        `  rm .orkestra/.database/daemon.json`,
      ].join("\n"),
    )
    process.exitCode = 1
    return
  }

  // Kept rather than swallowed, and reported only if the port is still answering
  // afterwards. Both signal failures are benign on their own and neither is a verdict:
  // `ESRCH` means it exited between the probe and here, which is the outcome we wanted,
  // and `EPERM` means it is alive and not ours — the case where the report has to say
  // more than "still answering", because trying again will not fix it either.
  const failure = yield* Effect.try(() => process.kill(record.pid, "SIGTERM")).pipe(
    Effect.map(() => undefined),
    Effect.catchAll((e) => Effect.succeed(String(e))),
  )

  const gone = yield* waitUntilGone(record.port, record.cwd, ATTEMPTS)
  if (gone) {
    console.log(`stopped  pid ${String(record.pid)} on ${String(record.port)}  (${record.cwd})`)
    return
  }
  console.log(
    [
      `sent SIGTERM to pid ${String(record.pid)}, but ${String(record.port)} is still`,
      `answering for this project.`,
      failure === undefined
        ? `It may be finishing a turn — run this again to check.`
        : `The signal did not land: ${failure}`,
    ].join(" "),
  )
  process.exitCode = 1
})

// Only when run, never when imported — the same guard `src/ui.ts` carries, and for the
// same reason: this one kills a process.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void Effect.runPromise(main).catch((e: unknown) => {
    console.error(String(e))
    process.exitCode = 1
  })
}
