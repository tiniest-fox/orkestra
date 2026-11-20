// `pnpm ui [--dir <path>]` — the engine and the client together, on a port pair the
// project keeps.
//
// The pair is derived from the project's path rather than asked of the OS, so the URL
// for a given worktree is the same every boot and can be bookmarked, kept in a tab, or
// pointed at by a browser automation. Two worktrees of this repository are two paths, so
// they get two pairs and can run at once.
//
// **One engine per project, though.** A taken pair is stepped past when another project
// holds it and refused when this one does — see `pickPair`, which is where the difference
// is read. Two engines *can* run from this one checkout, on two repositories: what may
// not be doubled is a daemon over one `.orkestra/.database/`.
//
// Three values reach the two halves through the environment: `src/serve.ts` reads
// `ORKESTRA_API_PORT` and `ORKESTRA_PROJECT_DIR`, and `client/vite.config.ts` reads both
// ports — the client's to bind and the API's to proxy. None of them can be derived on the
// other side (the client's tsconfig omits node's types on purpose, and `--dir` is a
// choice rather than a derivation), which is why this file is what puts them there.

// oxlint-disable-next-line eslint/no-restricted-imports -- starts pnpm ui:both, from outside the engine
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"
import {
  answeringFor,
  basePort,
  PAIR_ATTEMPTS,
  pickPair,
  portFree,
  PROJECT_DIR_ENV,
  projectDir,
  readDaemonRecord,
} from "./app/discovery.js"

/** The repository the engine will drive. Not necessarily the one this file is in. */
const PROJECT = projectDir(process.argv.slice(2)).root

/**
 * This checkout, from this file rather than from the cwd.
 *
 * `pnpm ui:both` is *this* repository's script, so the spawn has to land here whatever
 * directory the command was typed in — with `--dir`, the project is somewhere else and
 * `pnpm` would resolve the script against that repository's `package.json` instead.
 */
const CHECKOUT = fileURLToPath(new URL("..", import.meta.url))

// What `src/serve.ts` binds unless told `--host`, and what `client/vite.config.ts`
// binds outright. `pnpm ui` never passes `--host`: the dev server in front of the engine
// has no guard, so a phone is pointed at the engine.
const HOST = "127.0.0.1"

/**
 * The two halves are spawned through `pnpm ui:both` rather than by calling `concurrently`
 * here, because a binary named only in TypeScript is a binary `knip` cannot see — it reads
 * `package.json` scripts. The script owns the flags; this file owns the numbers.
 */
/**
 * Say where the engine already running for this project is, and refuse to add another.
 *
 * The client half is named only when something holds its port: reached from a bare
 * `pnpm serve` there is an engine and no UI, and printing a URL nothing serves sends a
 * person to a dead tab.
 *
 * **The `ui:stop` it names carries `--dir`, always.** `ui:stop` resolves its own project
 * from its own command line, so a bare one typed here stops nothing and reports that
 * nothing is running — the refusal would have sent a person to a command that
 * contradicts it. Naming the flag is right in the cwd case too, just redundant.
 */
const refuse = async (api: number): Promise<void> => {
  console.log(`an engine for ${PROJECT} is already running.`)
  if (!(await portFree(api + 1))) console.log(`ui   http://${HOST}:${String(api + 1)}`)
  console.log(`api  http://${HOST}:${String(api)}`)
  console.log(``)
  console.log(`Not starting a second one: two daemons over one \`.orkestra/.database/\``)
  console.log(`share no permit, so both would drive a trak and append to one log.`)
  console.log(`Stop the one that is running with \`pnpm ui:stop --dir ${PROJECT}\`.`)
  process.exitCode = 1
}

const main = async (): Promise<void> => {
  // The record first, because it is the only thing that knows where a daemon that
  // stepped past a taken pair ended up. Checking the derived pair alone would find it
  // free and bind a second engine beside the first.
  const record = await Effect.runPromise(readDaemonRecord(PROJECT))
  if (record !== undefined && (await answeringFor(record.port)) === PROJECT) {
    await refuse(record.port)
    return
  }

  const { api, client, ours } = await pickPair(PROJECT, basePort(PROJECT), PAIR_ATTEMPTS)
  if (ours) {
    await refuse(api)
    return
  }
  console.log(`ui   http://${HOST}:${String(client)}`)
  console.log(`api  http://${HOST}:${String(api)}`)

  const child = spawn("pnpm", ["ui:both"], {
    stdio: "inherit",
    cwd: CHECKOUT,
    env: {
      ...process.env,
      ORKESTRA_API_PORT: String(api),
      ORKESTRA_CLIENT_PORT: String(client),
      [PROJECT_DIR_ENV]: PROJECT,
    },
  })
  child.on("exit", (code) => {
    process.exitCode = code ?? 1
  })
}

// Only when run, never when imported: an unguarded call here would spawn a pair of
// servers inside the test run.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e: unknown) => {
    console.error(String(e))
    process.exitCode = 1
  })
}
