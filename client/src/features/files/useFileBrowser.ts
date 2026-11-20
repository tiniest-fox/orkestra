/**
 * Where the file browser stands: shut, showing the tree, or showing one file — at a line
 * where a search result opened it — and which folders of the tree are open.
 *
 * **Held by the traks list rather than the panel**, because two things open it: the Files
 * cell or mark, and a line the ⌘K palette found. The folders live here too, so stepping
 * into a file and back finds the tree as it was left.
 *
 * Kind `hook`: local state and nothing fetched.
 */

import { useState } from "react"
import { foldersOf } from "./browseTree"

/**
 * How a markdown file is drawn on a desk: as formatted text, or as its numbered lines.
 * Every other file, and every file on a phone, draws its lines whichever this says.
 */
export type FileView = "rendered" | "source"

/**
 * The file on screen, the line a search opened it at, and which view it is in.
 *
 * **The view starts over with every file opened** and is never kept: a file opens rendered
 * unless a line was asked for, because a line is a place in the source.
 */
export interface OpenFile {
  readonly path: string
  readonly line: number | undefined
  readonly view: FileView
}

export interface FileBrowser {
  readonly open: boolean
  /** `undefined` while the tree is showing. */
  readonly file: OpenFile | undefined
  readonly folders: ReadonlySet<string>
  /** Open on the tree, or shut, as the cell's press toggles it. */
  readonly toggle: () => void
  /** Open on this file, with every folder above it open behind it. */
  readonly openFile: (path: string, line?: number) => void
  /** Switch the open file between rendered and source. */
  readonly setView: (view: FileView) => void
  readonly toggleFolder: (path: string) => void
  /** From a file back to the tree. */
  readonly back: () => void
  readonly close: () => void
}

export const useFileBrowser = (): FileBrowser => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<OpenFile | undefined>(undefined)
  const [folders, setFolders] = useState<ReadonlySet<string>>(() => new Set())
  return {
    open,
    file,
    folders,
    toggle: () => {
      setOpen(!open)
      setFile(undefined)
    },
    openFile: (path, line) => {
      setOpen(true)
      setFile({ path, line, view: line === undefined ? "rendered" : "source" })
      setFolders(new Set([...folders, ...foldersOf(path)]))
    },
    // The line goes with a switch to rendered, so coming back to the source does not mark
    // a search hit the person has already moved away from.
    setView: (view) => {
      if (file !== undefined)
        setFile({ path: file.path, line: view === "rendered" ? undefined : file.line, view })
    },
    toggleFolder: (path) => {
      const next = new Set(folders)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      setFolders(next)
    },
    back: () => {
      setFile(undefined)
    },
    close: () => {
      setOpen(false)
      setFile(undefined)
    },
  }
}
