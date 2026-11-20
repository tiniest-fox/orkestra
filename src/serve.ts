// The HTTP server for an engine nobody hosts. `pnpm serve` boots this; reachable from the
// client via fetch, and it serves the built client itself at `/` once `client/dist` exists —
// one origin for a browser that is not behind Vite's dev server. What it finds there is
// reported at boot.
//
// `pnpm serve [--dir <path>] [--host]` — the repository it drives, defaulting to the
// directory it was started in. This checkout is where the code lives; `--dir` is where
// the work is.
//
// Booting and the read endpoints cost nothing — they read `.orkestra/.database/`. The action
// endpoints (`/api/traks/:id/act`, `/resume`) spawn a real `claude`, the same as
// `pnpm ork "<desc>"`.
//
// **It reads none of the variables a host starts an engine with**, and refuses one. Its store
// is SQLite, its push keys, users and tools are its own, it has no runner and no backup,
// nothing is refused as runners-only or a drill, and it asks no host for a credential, a
// `connection:` token or a GitHub token — a host starts an engine through its own entry point. How
// the boot goes is `app/serve-engine.ts`.
//
// **It refuses `ORKESTRA_STORE` rather than ignoring it.** Only a host's entry point opens an
// external store, so this engine cannot open one; booting on SQLite instead would serve an
// empty project to someone who meant the store's rows, and say nothing about it.

import { serveEngine } from "./app/serve-engine.js"

const STORE = "ORKESTRA_STORE"

if ((process.env[STORE] ?? "") !== "") {
  console.error(
    `refused: ${STORE} names an external store, which only a hosted engine opens — this engine runs on SQLite. Unset ${STORE} to boot.`,
  )
  process.exit(1)
}

await serveEngine({ argv: process.argv.slice(2), env: process.env })
