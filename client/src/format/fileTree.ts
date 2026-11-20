/**
 * A list of files as a compressed directory tree — nested for the Changes sheet on a phone
 * and the change map's buckets, and flattened for the desktop's pinned column.
 *
 * **Compressed: a run of directories with a single child is one row.**
 * `client/src/features/trak-detail` is a line, not four, which is what makes a tree
 * affordable at 160px — an uncompressed one puts eleven files above the fold where this
 * puts eighteen. The price is that a folder's depth depends on what else changed in the
 * slice, so the same directory sits at different indents in two slices. That is inherent
 * to compressing and is not a bug to chase.
 *
 * **The nested shape exists for the sheet's stacked sticky headers.** A sticky header is
 * pushed out by the end of its own group, so each directory has to be an element holding
 * its children — in a flat list two rows at the same depth pin to the same offset and the
 * later draws over the earlier. The flat rows are the same walk written down, so the two
 * surfaces cannot disagree about what the tree holds.
 *
 * **Directory rows are labels, not presses.** The index exists to say what is in the diff
 * and to jump to a file; a collapsible tree would be a second fold state competing with
 * the cards' own.
 *
 * **Generic over what a file is**, because the Changes tab folds the diff's own files and
 * the change map folds the files an agent named, which carry a reason and no hunks. One
 * folding for both, so the same directory reads the same way on the two surfaces.
 *
 * Kind `pure`: `api/types`, a sibling pure module, and no React.
 */

import type { FileChangeDto } from "../api/types"

/** All the tree needs of a file: where it is. */
interface Pathed {
  readonly path: string
}

/**
 * One node of the tree: a joined run of directories with what is under it, or a file.
 *
 * A file node carries the whole file, because the sheet's rows draw more of it than the
 * flat index does — the counts, and `binary` — and a node that copied out three fields
 * would grow a fourth every time the sheet did.
 */
export type TreeNode<F extends Pathed> =
  | {
      readonly kind: "dir"
      readonly label: string
      readonly depth: number
      readonly children: readonly TreeNode<F>[]
    }
  | {
      readonly kind: "file"
      readonly label: string
      readonly depth: number
      readonly file: F
    }

/** One line of the flat index: a `TreeNode` without the nesting. */
export type IndexRow =
  | { readonly kind: "dir"; readonly label: string; readonly depth: number }
  | {
      readonly kind: "file"
      readonly label: string
      readonly depth: number
      readonly path: string
      readonly change: FileChangeDto["change"]
    }

/** A directory being built up: what is directly under it, in first-seen order. */
interface Node<F extends Pathed> {
  readonly dirs: Map<string, Node<F>>
  readonly files: { readonly name: string; readonly file: F }[]
}

const node = <F extends Pathed>(): Node<F> => ({ dirs: new Map(), files: [] })

const insert = <F extends Pathed>(root: Node<F>, file: F): void => {
  const parts = file.path.split("/")
  const name = parts.at(-1) ?? file.path
  let here = root
  for (const part of parts.slice(0, -1)) {
    const next = here.dirs.get(part) ?? node<F>()
    here.dirs.set(part, next)
    here = next
  }
  here.files.push({ name, file })
}

/**
 * A directory's own label, joining every single-child directory below it onto one row.
 *
 * The run stops at the first directory that has a sibling or a file beside it, because
 * that is the first point where the path genuinely branches and a reader has a choice to
 * see.
 */
const compress = <F extends Pathed>(
  label: string,
  from: Node<F>,
): { readonly label: string; readonly at: Node<F> } => {
  let text = label
  let here = from
  while (here.files.length === 0 && here.dirs.size === 1) {
    const [only] = [...here.dirs.entries()]
    if (only === undefined) break
    text = `${text}/${only[0]}`
    here = only[1]
  }
  return { label: text, at: here }
}

/** Directories before the files that sit beside them, so a run of files is never split by
 *  a folder appearing halfway down it. */
const walk = <F extends Pathed>(at: Node<F>, depth: number): readonly TreeNode<F>[] => {
  const out: TreeNode<F>[] = []
  for (const [name, child] of at.dirs) {
    const run = compress(name, child)
    out.push({ kind: "dir", label: run.label, depth, children: walk(run.at, depth + 1) })
  }
  for (const { name, file } of at.files) out.push({ kind: "file", label: name, depth, file })
  return out
}

/**
 * The whole slice as a compressed tree. A file at the repository root takes depth 0 and
 * no directory node, which is the one shape a tree of joined runs cannot express as a run.
 */
export const fileTree = <F extends Pathed>(files: readonly F[]): readonly TreeNode<F>[] => {
  const root = node<F>()
  for (const file of files) insert(root, file)
  return walk(root, 0)
}

const flatten = (nodes: readonly TreeNode<FileChangeDto>[], out: IndexRow[]): void => {
  for (const branch of nodes) {
    if (branch.kind === "dir") {
      out.push({ kind: "dir", label: branch.label, depth: branch.depth })
      flatten(branch.children, out)
    } else
      out.push({
        kind: "file",
        label: branch.label,
        depth: branch.depth,
        path: branch.file.path,
        change: branch.file.change,
      })
  }
}

/**
 * Every row of the index, in the tree's own order.
 *
 * **That is not the order the diff draws its cards in.** Those follow the order the wire
 * sent, which is git's own sort, where a directory and the files beside it interleave. At
 * a handful of files the two read the same; on a wide branch they diverge, and only a real
 * trak will say whether that is disorienting.
 */
export const indexRows = (files: readonly FileChangeDto[]): readonly IndexRow[] => {
  const rows: IndexRow[] = []
  flatten(fileTree(files), rows)
  return rows
}
