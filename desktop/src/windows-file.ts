// `windows.json` under the app's own support directory — the reading and writing half of
// `windows.ts`.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parseWindows, type SavedWindow, serializeWindows } from "./windows.js"

export const readWindows = async (file: string): Promise<readonly SavedWindow[]> =>
  parseWindows(await readFile(file, "utf8").catch(() => ""))

export const writeWindows = async (
  file: string,
  windows: readonly SavedWindow[],
): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, serializeWindows(windows), "utf8")
}
