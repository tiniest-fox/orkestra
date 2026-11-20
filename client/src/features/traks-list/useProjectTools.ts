/**
 * Everything the file browser and the ⌘K palette read, held by the traks list because
 * every screen is under it: where the browser stands, the checkout's files, the open
 * file, and the palette's query with what the engine found for it.
 *
 * **Nothing is asked while neither is open.** The tree is asked for once the panel or the
 * palette opens, the file once one is open, and the search once something is typed —
 * each then polls, as every read of the engine does.
 *
 * **Only one drawer is open at a time.** Every route under the list but `/` is a drawer
 * from the right, and Files is one from the left; both take most of the window, so open
 * together they covered nearly everything. Opening Files leaves the route for `/`, and a
 * route leaving `/` — a row, a ⌘K trak, New Trak — shuts Files. The browser is local
 * state that outlives routes, which is why it is shut rather than merely hidden off `/`:
 * hidden, it would come back unasked when the trak closed.
 */

import { useState } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useFileBrowser, type FileBrowser } from "../files/useFileBrowser"
import { useFileContent, type FileReading } from "../files/useFileContent"
import { useProjectFiles, type FilesRead } from "../files/useProjectFiles"
import { usePaletteKey } from "../palette/usePaletteKey"
import { usePaletteSearch, type PaletteSearch } from "../palette/usePaletteSearch"
import { paletteChord, setPaletteOpen, usePalette } from "../../hooks/usePalette"

export interface ProjectTools {
  readonly browser: FileBrowser
  readonly files: FilesRead
  readonly reading: FileReading
  readonly palette: boolean
  readonly search: PaletteSearch
  readonly openPalette: () => void
  /** The chord that opens the palette here, as a hint spells it. */
  readonly hint: string
  readonly closePalette: () => void
  /** Shut the palette and open a file it found, at a line where a match named one. */
  readonly openFound: (path: string, line?: number) => void
}

export const useProjectTools = (): ProjectTools => {
  const held = useFileBrowser()
  const palette = usePalette()
  usePaletteKey()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  // Adjusted during render rather than in an effect, so no frame paints both drawers.
  const [seen, setSeen] = useState(pathname)
  if (pathname !== seen) {
    setSeen(pathname)
    if (pathname !== "/" && held.open) held.close()
  }
  const leave = (): void => {
    if (pathname !== "/") void navigate({ to: "/" })
  }
  const browser: FileBrowser = {
    ...held,
    toggle: () => {
      if (!held.open) leave()
      held.toggle()
    },
    openFile: (path, line) => {
      leave()
      held.openFile(path, line)
    },
  }
  return {
    browser,
    files: useProjectFiles(browser.open || palette),
    reading: useFileContent(browser.file?.path),
    palette,
    search: usePaletteSearch(palette),
    hint: paletteChord.hint,
    openPalette: () => {
      setPaletteOpen(true)
    },
    closePalette: () => {
      setPaletteOpen(false)
    },
    openFound: (path, line) => {
      setPaletteOpen(false)
      browser.openFile(path, line)
    },
  }
}
