// `recents.json` under the app's own support directory — the reading and writing half
// of `recents.ts`.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parseRecents, serializeRecents } from "./recents.js"

export const readRecents = async (file: string): Promise<readonly string[]> =>
  parseRecents(await readFile(file, "utf8").catch(() => ""))

export const writeRecents = async (file: string, recents: readonly string[]): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, serializeRecents(recents), "utf8")
}
