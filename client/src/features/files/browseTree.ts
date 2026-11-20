/**
 * The project's tree as the browser draws it: the rows on screen, given which folders are
 * open. `format/fileTree` builds the nesting — folders before files, a chain of lone
 * folders folded into one row — and this walks it, stopping at every shut folder.
 *
 * A folded folder has no path of its own in that tree, so the walk builds one from its
 * parent's and its label: `src/app` for a row labelled `src/app` at the top, and that is
 * the name the open set holds.
 */

import { fileTree, type TreeNode } from "../../format/fileTree"

export type BrowseRow =
  | {
      readonly kind: "dir"
      readonly path: string
      readonly label: string
      readonly depth: number
      readonly open: boolean
    }
  | { readonly kind: "file"; readonly path: string; readonly label: string; readonly depth: number }

interface Pathed {
  readonly path: string
}

const walk = (
  nodes: readonly TreeNode<Pathed>[],
  parent: string,
  open: ReadonlySet<string>,
  out: BrowseRow[],
): void => {
  for (const node of nodes) {
    if (node.kind === "file") {
      out.push({ kind: "file", path: node.file.path, label: node.label, depth: node.depth })
      continue
    }
    const path = parent === "" ? node.label : `${parent}/${node.label}`
    const isOpen = open.has(path)
    out.push({ kind: "dir", path, label: node.label, depth: node.depth, open: isOpen })
    if (isOpen) walk(node.children, path, open, out)
  }
}

export const browseRows = (
  paths: readonly string[],
  open: ReadonlySet<string>,
): readonly BrowseRow[] => {
  const out: BrowseRow[] = []
  walk(fileTree(paths.map((path) => ({ path }))), "", open, out)
  return out
}

/**
 * Every folder a file sits under, outermost first — what opening that file has to open so
 * its row is on screen. Each prefix, because a folded row's path is one of them and the
 * others cost nothing in the set.
 */
export const foldersOf = (path: string): readonly string[] => {
  const parts = path.split("/").slice(0, -1)
  return parts.map((_, at) => parts.slice(0, at + 1).join("/"))
}
