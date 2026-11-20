// A session file of its own for each guard a test makes, so no two guards share sessions
// unless the test hands one path to both — which is how a restart is written.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const freshSessionsFile = (): string =>
  join(mkdtempSync(join(tmpdir(), "orkestra-sessions-")), "sessions.json")
