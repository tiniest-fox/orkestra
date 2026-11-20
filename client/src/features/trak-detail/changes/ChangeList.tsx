/**
 * The index and the diff, side by side — the layout the desk gets. The phone's is
 * `ChangeStack`, and the reading state both draw is `useChangeReading`'s.
 *
 * **One ground, no rule between the columns.** The sections are cards on the same canvas
 * the index sits on, so the gap between them *is* the boundary — a divider there would draw
 * a second one through the middle of the first.
 *
 * **Two scrollers, not one.** The index is pinned and scrolls on its own, which is the
 * whole of what a sidecar buys over a stack; the price is 160px off a code column that
 * fits about 76 monospace characters at the drawer's width.
 */

import type { ReactNode, UIEvent } from "react"
import type { FileChangeDto } from "../../../api/types"
import { omittedFootnote } from "./changes"
import ChangeFile from "./ChangeFile"
import GeneratedFile from "./GeneratedFile"
import ChangeIndex from "./ChangeIndex"
import { indexRows } from "../../../format/fileTree"
import { useChangeReading } from "./useChangeReading"

const ChangeList = ({
  trak,
  slice,
  files,
  omitted,
  landing,
  onLanded,
}: {
  readonly trak: string
  /** The slice showing, which a collapsed file's card reads its patch from. */
  readonly slice: string
  readonly files: readonly FileChangeDto[]
  readonly omitted: number | undefined
  /** A file to open the list at — a change map's Open in Changes. */
  readonly landing: string | undefined
  readonly onLanded: () => void
}): ReactNode => {
  const { at, box, hold, measure, go, folded, fold } = useChangeReading(files, landing, onLanded)
  const note = omittedFootnote(omitted)

  return (
    <div className="flex min-h-0 flex-1">
      <ChangeIndex rows={indexRows(files)} at={at} omitted={omitted} onPick={go} />

      <div
        ref={box}
        onScroll={(event: UIEvent<HTMLDivElement>) => {
          measure(event.currentTarget)
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pb-3 pr-2"
      >
        {files.map((file) =>
          file.omitted === "generated" ? (
            <GeneratedFile
              key={file.path}
              trak={trak}
              slice={slice}
              file={file}
              gutter="pair"
              folded={folded(file.path)}
              onFold={fold}
              hold={hold}
            />
          ) : (
            <ChangeFile
              key={file.path}
              file={file}
              gutter="pair"
              folded={folded(file.path)}
              onFold={fold}
              hold={hold}
            />
          ),
        )}

        {note !== undefined && (
          <p className="rounded-surface bg-surface-2 px-3 py-2 text-sm text-fg-muted">{note}</p>
        )}
      </div>
    </div>
  )
}

export default ChangeList
