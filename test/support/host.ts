// What the supervisor's tests share: a stand-in project on disk, and the fake engine as the
// thing a project's engine is launched from.

import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { nodeLaunch } from "../../src/supervisor/engine.js"

export const FAKE_LAUNCH = nodeLaunch(
  fileURLToPath(new URL("fake-engine.ts", import.meta.url)),
  process.execPath,
  { NODE_OPTIONS: `--import ${import.meta.resolve("tsx")}` },
)

export const project = (id: string): { readonly id: string; readonly path: string } => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), `ork-host-${id}-`)))
  mkdirSync(join(path, ".orkestra"))
  return { id, path }
}
