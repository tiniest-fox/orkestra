/**
 * What the palette found, in its three sections: traks, then files by path, then lines
 * in files grouped under each file. No keyboard movement and no selection mark — a row
 * opens by click or tap, as the person chose.
 *
 * **A trak is the traks list's own `TrakRow`**, and a put-away one is `ArchivedTrakRow`,
 * built from the same parts — the person asked that the palette import the list's rows
 * rather than draw its own. Each is a link, so a press on one navigates and `onTrak`
 * shuts the palette behind it.
 *
 * **A line opens its file in the Files panel at that line**, highlighted; a path opens
 * the file at its top.
 */

import type { ReactNode } from "react"
import { File, Search, SquareKanban } from "lucide-react"
import type { AgentDto } from "../../api/types"
import ArchivedTrakRow from "../traks-list/ArchivedTrakRow"
import TrakRow from "../traks-list/TrakRow"
import FilePath from "./FilePath"
import Marked from "./Marked"
import type { FileLines, Found } from "./matches"
import PaletteSection from "./PaletteSection"

const rowFrame = (tap: boolean): string =>
  `flex w-full min-w-0 items-center gap-2.5 px-3 text-left hover:bg-hover-row ${tap ? "min-h-11 py-1.5" : "py-1.5"}`

/** `n`, and a plus where the engine's cap cut the answer short. */
const counted = (n: number, cut: boolean): string => `${String(n)}${cut ? "+" : ""}`

const LineGroup = ({
  group,
  query,
  tap,
  onLine,
}: {
  readonly group: FileLines
  readonly query: string
  readonly tap: boolean
  readonly onLine: (path: string, line: number) => void
}): ReactNode => (
  <li className="flex flex-col">
    <span className="flex min-w-0 items-center gap-2.5 px-3 pt-1.5 pb-0.5">
      <FilePath path={group.path} query="" />
    </span>
    <ul className="flex flex-col">
      {group.lines.map((line) => (
        <li key={line.line}>
          <button
            type="button"
            aria-label={`${group.path}, line ${String(line.line)}`}
            onClick={() => {
              onLine(group.path, line.line)
            }}
            className={`${rowFrame(tap)} pl-14`}
          >
            <span className="flex min-w-0 flex-1 items-baseline gap-2 rounded-control bg-canvas px-2 py-0.5">
              <span className="w-8 shrink-0 text-right font-mono text-2xs text-fg-subtle tabular-nums">
                {line.line}
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-fg-muted">
                <Marked text={line.text.trim()} query={query} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  </li>
)

const PaletteResults = ({
  found,
  query,
  agents,
  phone,
  onTrak,
  onFile,
  onLine,
}: {
  readonly found: Found
  readonly query: string
  readonly agents: readonly AgentDto[]
  readonly phone: boolean
  readonly onTrak: () => void
  readonly onFile: (path: string) => void
  readonly onLine: (path: string, line: number) => void
}): ReactNode => {
  const traks = found.live.length + found.archived.length
  return (
    <div className="flex flex-col gap-2 py-1">
      {traks > 0 && (
        <PaletteSection icon={SquareKanban} label="Traks" count={String(traks)}>
          {/* The press bubbles from the row's link, so it shuts the palette once the
              router has the destination. */}
          <ul onClick={onTrak} className="flex flex-col">
            {found.live.map((trak) => (
              <TrakRow
                key={trak.id}
                trak={trak}
                band={[]}
                // No forge answers are asked for here, so a finished row wears its own flag.
                rungs={undefined}
                agents={agents}
                phone={phone}
                stacked={false}
              />
            ))}
            {found.archived.map((trak) => (
              <ArchivedTrakRow key={trak.id} trak={trak} />
            ))}
          </ul>
        </PaletteSection>
      )}
      {found.paths.length > 0 && (
        <PaletteSection
          icon={File}
          label="Files"
          count={counted(found.paths.length, found.pathsCut)}
        >
          <ul className="flex flex-col">
            {found.paths.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  aria-label={path}
                  onClick={() => {
                    onFile(path)
                  }}
                  className={rowFrame(phone)}
                >
                  <FilePath path={path} query={query} />
                </button>
              </li>
            ))}
          </ul>
        </PaletteSection>
      )}
      {found.lines.length > 0 && (
        <PaletteSection
          icon={Search}
          label="In files"
          count={counted(
            found.lines.reduce((n, group) => n + group.lines.length, 0),
            found.linesCut,
          )}
        >
          <ul className="flex flex-col">
            {found.lines.map((group) => (
              <LineGroup key={group.path} group={group} query={query} tap={phone} onLine={onLine} />
            ))}
          </ul>
        </PaletteSection>
      )}
    </div>
  )
}

export default PaletteResults
