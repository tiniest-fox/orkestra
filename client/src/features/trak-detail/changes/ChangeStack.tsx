/**
 * The diff at a phone's width: one uninterrupted stack, and the index somewhere you go.
 *
 * **Nothing is pinned above the code.** The slice picker rides in the scroller — the
 * `lead` slot — so the cards get every pixel once a reader is moving; the desktop's
 * pinned sidecar is `ChangeList`, and which of the two draws is `ChangesView`'s.
 *
 * **The index is behind a floating pill over the code** — the file under the top of the
 * scroller and its ordinal, `src/app/push.ts · 1 of 26`. It covers a line of code at
 * every scroll position; that is the option's cost and it is admitted. The scroller
 * reserves 64px plus the home indicator's inset at its end so the last card does not
 * sit under it — the inset only where nothing is drawn below the surface: under the
 * ownership band, the band pays it, and the reservation and the pill drop it.
 *
 * **Each file is the same bordered card the desk draws, on 8px of canvas** — without
 * that inset the borders butt together and twenty-six cards read as one continuous
 * stack. Code never wraps: the horizontal scroller and the sticky gutter are the card's
 * own, unchanged, with the gutter carrying the new line number alone.
 */

import type { ReactNode, UIEvent } from "react"
import { useState } from "react"
import { List } from "lucide-react"
import type { FileChangeDto } from "../../../api/types"
import { omittedFootnote, total } from "./changes"
import ChangeFile from "./ChangeFile"
import GeneratedFile from "./GeneratedFile"
import ChangeSheet from "./ChangeSheet"
import { fileTree } from "../../../format/fileTree"
import { useChangeReading } from "./useChangeReading"

/**
 * The scroller's reservation at its end, and where the pill floats: the pill's 64px and 12px,
 * plus `safe-b` on both, because the pill rides `safe-b` higher on an installed phone and the
 * two must move together. Under the ownership band (`bandBelow`), which pays the inset, both
 * drop it.
 */
const ROOM = {
  band: {
    reserve: "pb-16",
    pill: "pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3",
  },
  own: {
    reserve: "pb-[calc(--spacing(16)+var(--spacing-safe-b))]",
    pill: "pointer-events-none absolute inset-x-0 bottom-[calc(--spacing(3)+var(--spacing-safe-b))] flex justify-center px-3",
  },
}

const ChangeStack = ({
  trak,
  slice,
  files,
  omitted,
  landing,
  onLanded,
  lead,
  bandBelow,
}: {
  readonly trak: string
  /** The slice showing, which a collapsed file's card reads its patch from. */
  readonly slice: string
  readonly files: readonly FileChangeDto[]
  readonly omitted: number | undefined
  /** A file to open the list at — a change map's Open in Changes. */
  readonly landing: string | undefined
  readonly onLanded: () => void
  /** What scrolls away above the cards — the slice picker, handed in because the picker
   *  is `ChangesView`'s at both widths and only this layout puts it in the scroller. */
  readonly lead: ReactNode
  readonly bandBelow: boolean
}): ReactNode => {
  const { at, box, hold, measure, go, folded, fold } = useChangeReading(files, landing, onLanded)
  const [index, setIndex] = useState(false)
  const note = omittedFootnote(omitted)

  // The pill's file: the one being read where it is still in the slice, and the first
  // where a poll has replaced the list under a stale measurement.
  const shown = files.find((file) => file.path === at) ?? files[0]

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={box}
        onScroll={(event: UIEvent<HTMLDivElement>) => {
          measure(event.currentTarget)
        }}
        className="flex h-full flex-col overflow-y-auto overscroll-contain"
      >
        {lead}

        <div className={`flex flex-col gap-2 p-2 ${ROOM[bandBelow ? "band" : "own"].reserve}`}>
          {files.map((file) =>
            file.omitted === "generated" ? (
              <GeneratedFile
                key={file.path}
                trak={trak}
                slice={slice}
                file={file}
                gutter="new"
                folded={folded(file.path)}
                onFold={fold}
                hold={hold}
              />
            ) : (
              <ChangeFile
                key={file.path}
                file={file}
                gutter="new"
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

      {/* Inverse rather than a surface: the drawn pill is dark ink floating on the code,
          which is what keeps it a control over the page instead of a scrap of the page —
          `bg-fg text-canvas` flips with the scheme, so it stays the opposite of the ground. */}
      {shown !== undefined && (
        <div className={ROOM[bandBelow ? "band" : "own"].pill}>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setIndex(true)
            }}
            className="pointer-events-auto flex min-h-11 max-w-full items-center gap-2 rounded-pill bg-fg px-4 text-canvas shadow-menu"
          >
            <List size={13} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate font-mono text-sm">{shown.path}</span>
            <span className="shrink-0 font-mono text-2xs text-canvas/70">
              · {String(files.indexOf(shown) + 1)} of {String(files.length)}
            </span>
          </button>
        </div>
      )}

      {index && (
        <ChangeSheet
          nodes={fileTree(files)}
          at={shown?.path}
          total={total(files)}
          omitted={omitted}
          onPick={(path) => {
            go(path)
            setIndex(false)
          }}
          onClose={() => {
            setIndex(false)
          }}
        />
      )}
    </div>
  )
}

export default ChangeStack
