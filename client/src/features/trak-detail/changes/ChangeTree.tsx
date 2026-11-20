/**
 * The compressed tree inside the sheet, with a sticky header at every depth.
 *
 * **Stacked: each header pins at `depth × 24px`, so three depths are three visible
 * bands.** That is why this renders the *nested* shape rather than the flat rows the
 * desktop column draws — a sticky header is pushed out by the end of its own group, and
 * in a flat list there is no group to end: two rows at the same depth pin to the same
 * offset and the later draws over the earlier.
 *
 * **z-index runs the other way from depth**, so a parent draws over the child it is
 * pushing out rather than under it. The values stay inside the sheet's own stacking
 * context — `ChangeSheet` isolates them.
 *
 * **Directory rows are labels, never presses** — `fileTree` carries why. Each header is
 * opaque on the sheet's ground, because the rows pass beneath it.
 *
 * **A row carries the file's `+N −M`**, where the desktop index refuses to — that column
 * argues a 160px width the sheet does not have, and the drawn sheet's rows say the counts.
 * A binary file says `binary` instead, which is the same answer its card gives at length.
 *
 * The row heights are the two facts the stacking depends on: a header is exactly the
 * 24px the pin offsets assume, and a file row is a 44px minimum because it acts.
 */

import type { ReactNode } from "react"
import type { FileChangeDto } from "../../../api/types"
import { CHANGE_MARK } from "./ChangeFile"
import type { TreeNode } from "../../../format/fileTree"

/** The indent, shared by both row kinds so a file sits under its own header's text. */
const inset = (depth: number): string => `${String(12 + depth * 12)}px`

/** The row's right edge: the counts in the marks' own inks, or the one word `binary`. */
const Tally = ({ file }: { readonly file: FileChangeDto }): ReactNode =>
  file.binary ? (
    <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">binary</span>
  ) : (
    <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-2xs">
      <span className="text-tone-good">+{String(file.additions)}</span>
      <span className="text-tone-bad">−{String(file.deletions)}</span>
    </span>
  )

const ChangeTree = ({
  nodes,
  at,
  onPick,
}: {
  readonly nodes: readonly TreeNode<FileChangeDto>[]
  /** The path of the file under the top of the diff, which the sheet opens against. */
  readonly at: string | undefined
  readonly onPick: (path: string) => void
}): ReactNode => (
  <>
    {nodes.map((branch) =>
      branch.kind === "dir" ? (
        <div key={`d:${String(branch.depth)}:${branch.label}`}>
          <p
            style={{
              top: `${String(branch.depth * 24)}px`,
              zIndex: 30 - branch.depth,
              paddingLeft: inset(branch.depth),
            }}
            className="sticky flex h-6 items-center bg-surface pr-4 font-mono text-2xs text-fg-subtle"
          >
            <span className="truncate">{branch.label}</span>
          </p>
          <ChangeTree nodes={branch.children} at={at} onPick={onPick} />
        </div>
      ) : (
        <button
          key={branch.file.path}
          type="button"
          aria-current={branch.file.path === at ? "true" : undefined}
          onClick={() => {
            onPick(branch.file.path)
          }}
          style={{ paddingLeft: inset(branch.depth) }}
          className={`relative flex min-h-11 w-full items-center gap-2 border-b border-border pr-4 text-left transition-colors ${
            branch.file.path === at ? "bg-accent/10" : "hover:bg-hover-row"
          }`}
        >
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-pill ${CHANGE_MARK[branch.file.change]}`}
          />
          <span className="min-w-0 truncate font-mono text-sm text-fg">{branch.label}</span>
          <Tally file={branch.file} />
        </button>
      ),
    )}
  </>
)

export default ChangeTree
