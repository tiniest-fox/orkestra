/**
 * The file tree a navigator's content draws — an overview part's planned files, a change
 * map bucket's changed ones.
 *
 * **Folders are rows of their own, and a folder holding only one folder is folded into
 * it** — `format/fileTree`'s folding, so a directory reads the same here as on the Changes
 * tab. A file's row carries its kind as a letter, its name, its counts where a diff gave
 * them, and its reason under the name.
 *
 * **A file that has something to open is a press, and opens it inline under its row**, at
 * the panel's full width inside its padding; a second press shuts it, and one is open at a
 * time. Its whole reason is something to open as well, where two lines cut it — the row
 * decides that, since only it can measure the cut (`FileTreeRow`). Which one is open is the
 * figure's, since it is also what tells the navigator to hold its height.
 */

import type { ReactNode } from "react"
import type { ChangeKind } from "../format/changeMap"
import { fileTree, type TreeNode } from "../format/fileTree"
import FileTreeRow from "./FileTreeRow"

/** One file as the tree draws it. */
export interface TreeFile {
  readonly kind: ChangeKind
  readonly path: string
  readonly oldPath: string | undefined
  readonly why: string | undefined
  /** Where a diff gave them. */
  readonly counts: { readonly added: number; readonly deleted: number } | undefined
  /** Named, and absent from a diff known to be whole. */
  readonly missing: boolean
  /** What opening the file shows under its row, or `undefined` for nothing beyond its reason. */
  readonly body: (() => ReactNode) | undefined
}

/** The panel's 10px, then 14px a folder. */
const indentPx = (depth: number): number => 10 + depth * 14

/** The tree's rows in drawing order, each with its depth. */
const rowsOf = (nodes: readonly TreeNode<TreeFile>[]): readonly TreeNode<TreeFile>[] =>
  nodes.flatMap((node) => [node, ...(node.kind === "dir" ? rowsOf(node.children) : [])])

const FileTree = ({
  files,
  narrow,
  opened,
  onOpen,
}: {
  readonly files: readonly TreeFile[]
  readonly narrow: boolean
  /** The path whose body is showing, if one in this tree is. */
  readonly opened: string | undefined
  readonly onOpen: (path: string | undefined) => void
}): ReactNode => (
  <div className="flex min-w-0 flex-col py-1.25">
    {rowsOf(fileTree(files)).map((node, at) => {
      if (node.kind === "dir")
        return (
          <div
            // A folded folder has no path of its own, and two can share a label at one
            // depth under different parents; the rows of one tree never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            key={at}
            style={{ paddingLeft: indentPx(node.depth) }}
            className="min-w-0 truncate py-1 pr-2.5 font-mono text-sm text-fg-subtle"
          >
            {node.label}/
          </div>
        )
      const { file } = node
      const { body } = file
      const isOpen = opened === file.path
      return (
        <div key={file.path} className="min-w-0">
          <FileTreeRow
            file={file}
            name={node.label}
            indent={indentPx(node.depth)}
            open={isOpen}
            narrow={narrow}
            onToggle={() => {
              onOpen(isOpen ? undefined : file.path)
            }}
          />
          {isOpen && body !== undefined && (
            <div className="min-w-0 px-2.5 pt-1 pb-2.5">{body()}</div>
          )}
        </div>
      )
    })}
  </div>
)

export default FileTree
