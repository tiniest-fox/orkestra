// The file adapter against a real, throwaway `.orkestra` directory. Slower
// than the memory suite and worth it: everything above this file takes lines
// on disk round-tripping as given.

import { appendFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { Process } from "../../src/agent/ports/process.js"
import { FileRunsLayer } from "../../src/workflow/adapters/runs-file.js"
import { FileStoreLayer } from "../../src/workflow/adapters/store-file.js"
import { storeContract, storeCorruptionContract, storeUnfencedContract } from "./store.js"

// `orkestraDir` walks up looking for `.orkestra`; a bare temp dir has none, so
// the scratch fixture has to look like a project the same way `vcs.ts`'s
// throwaway repo does.
const layer = (scratchDir: string) => {
  mkdirSync(join(scratchDir, ".orkestra"), { recursive: true })
  return FileStoreLayer(scratchDir)
}

// The `Runs` a file store is deployed beside, writing `run.json` into the same trak
// directory. Only this test process is alive, and nothing here spawns or kills.
const runs = (scratchDir: string) => {
  mkdirSync(join(scratchDir, ".orkestra"), { recursive: true })
  return FileRunsLayer(scratchDir).pipe(
    Layer.provide(
      Layer.succeed(Process, {
        spawn: () => Effect.die("not used by the Store contract"),
        isAlive: (pid) => Effect.succeed(pid === process.pid),
        kill: () => Effect.die("not used by the Store contract"),
        startTime: () => Effect.succeed(undefined),
        killExec: () => Effect.die("not used by the Store contract"),
      }),
    ),
  )
}

storeContract({ label: "file", layer, runs })
storeUnfencedContract({ label: "file", layer, runs })

const logIn = (scratchDir: string, id: string): string =>
  join(scratchDir, ".orkestra", ".database", "traks", id, "log.jsonl")

storeCorruptionContract({
  label: "file",
  layer,
  runs,
  corrupt: (scratchDir, id) => {
    appendFileSync(logIn(scratchDir, id), "not valid json{\n")
  },
  // A directory where the log should be, rather than a `chmod`: `EISDIR` is
  // the same everywhere, and a permission bit does not stop root — which is
  // what CI often is.
  unreadable: (scratchDir, id) => {
    const path = logIn(scratchDir, id)
    rmSync(path)
    mkdirSync(path)
  },
})
