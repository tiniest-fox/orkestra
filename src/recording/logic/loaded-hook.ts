// logic: the recording hook as Node imports it from the checkout — its `.ts` stripped of
// its types, under a name taken from those bytes. Shared by the check runner, which
// writes the copy, and the engine's wiring, which names it among the files a sandbox has
// to hold before a check that loads it runs there.

import { createHash } from "node:crypto"
import { stripTypeScriptTypes } from "node:module"

/** The stripped text, and the file name it is kept under in the temporary directory. */
export const loadedHook = (source: string): { readonly text: string; readonly file: string } => {
  const text = stripTypeScriptTypes(source)
  const name = `orkestra-recording-hook-${createHash("sha256").update(text).digest("hex").slice(0, 16)}`
  return { text, file: `${name}.mjs` }
}
