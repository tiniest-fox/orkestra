// The file adapter against a real, throwaway `.orkestra` directory, beside the file trak
// store it shares `.database/` with.

import { appendFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { FileGoalStoreLayer } from "../../src/workflow/adapters/goal-store-file.js"
import { FileStoreLayer } from "../../src/workflow/adapters/store-file.js"
import {
  goalStoreContract,
  goalStoreCorruptionContract,
  goalStoreUnfencedContract,
} from "./goal-store.js"

// `orkestraDir` walks up looking for `.orkestra`, which a bare temp dir has none of.
const project = (scratchDir: string): string => {
  mkdirSync(join(scratchDir, ".orkestra"), { recursive: true })
  return scratchDir
}

const layer = (scratchDir: string) => FileGoalStoreLayer(project(scratchDir))
const store = (scratchDir: string) => FileStoreLayer(project(scratchDir))

goalStoreContract({ label: "file", layer, store })
goalStoreUnfencedContract({ label: "file", layer, store })

const logIn = (scratchDir: string, id: string): string =>
  join(scratchDir, ".orkestra", ".database", "goals", id, "log.jsonl")

goalStoreCorruptionContract({
  label: "file",
  layer,
  store,
  corrupt: (scratchDir, id) => {
    appendFileSync(logIn(scratchDir, id), "not valid json{\n")
  },
  // A directory where the log should be, for `store-file.test.ts`'s reason: root ignores
  // a permission bit.
  unreadable: (scratchDir, id) => {
    const path = logIn(scratchDir, id)
    rmSync(path)
    mkdirSync(path)
  },
})
