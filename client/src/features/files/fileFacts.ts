/**
 * What the viewer's band says about a file, and what it draws in place of one it cannot
 * show. Pure, so the sentences are tested with no DOM.
 */

import type { FileContentDto } from "../../api/types"
import { sizeOf } from "../../format/size"

/** The extension as the band names the language, or nothing for a file with none. */
const extensionOf = (path: string): string | undefined => {
  const name = path.split("/").at(-1) ?? path
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? undefined : name.slice(dot + 1)
}

const MARKDOWN = new Set(["md", "markdown", "mdx"])

/** Whether a desk can draw this file rendered — by its extension, in any case. */
export const isMarkdown = (path: string): boolean =>
  MARKDOWN.has(extensionOf(path)?.toLowerCase() ?? "")

/** The band's facts: lines and language for text, the size for anything not drawn. */
export const factsOf = (file: FileContentDto): string => {
  switch (file._tag) {
    case "Text": {
      const lines = `${file.lines.toLocaleString("en-GB")} ${file.lines === 1 ? "line" : "lines"}`
      const ext = extensionOf(file.path)
      return ext === undefined ? lines : `${lines} · ${ext}`
    }
    case "Binary":
    case "TooLarge":
      return sizeOf(file.bytes)
  }
}
