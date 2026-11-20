/**
 * One process's header: its plate, its name, the line under the name, and its presses.
 *
 * **The plate is the status** — its tone and its glyph, with no badge beside the name —
 * and the line under the name says the state in words. A starting process keeps the
 * not-started glyph inside a plate whose edge is running, the same device a working trak's
 * plate uses.
 *
 * Start, Restart and Stop are labelled quiet buttons, and so is the full-view press —
 * Expand, and Collapse once expanded — because in full view it is the only way back to the
 * trak. It and the close press are the desk's and come
 * in only where the caller hands them over.
 */

import type { ReactNode } from "react"
import { Maximize2, Minimize2, Play, RotateCw, Square, X } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import Button from "../../../components/Button"
import PlacePill from "../../../components/PlacePill"
import Plate from "../../../components/Plate"
import { useSecond } from "../../../hooks/useSecond"
import { hostedLine, hostedLive, hostedTone } from "../../../format/hosted"
import ProcessGlyph from "../../../components/ProcessGlyph"
import type { ProcessPresses } from "../../../hooks/useProcessPress"

const ProcessHeader = ({
  process,
  presses,
  startable,
  full,
  onFull,
  onClose,
}: {
  readonly process: HostedProcessDto
  readonly presses: ProcessPresses
  /** Whether the trak has a checkout to run it in. Start is greyed where it has not. */
  readonly startable: boolean
  readonly full: boolean
  /** The desk's full-view toggle; `undefined` on a phone. */
  readonly onFull: (() => void) | undefined
  /** The desk's way to shut the panel; `undefined` on a phone, where Back does it. */
  readonly onClose: (() => void) | undefined
}): ReactNode => {
  const { name, state } = process
  const tag = state._tag
  const live = hostedLive(tag)
  const coming = tag === "Preparing" || tag === "Starting"
  // The line counts up while the process is starting or up, and holds still otherwise.
  const now = useSecond(live) * 1000
  const starting = presses.starting?.name === name ? presses.starting.verb : undefined
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-surface px-3 py-2.5">
      <Plate tone={hostedTone(tag)} running={coming}>
        <ProcessGlyph tag={coming ? "NotStarted" : tag} size={13} wash />
      </Plate>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Right after the name rather than at the row's end, where the presses are, so the
            place reads as part of the name. Drawn from the moment the spawn returned a place, so
            nothing through `Readying` and `Copying`. */}
        <span className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-base font-medium text-fg">{name}</h2>
          <PlacePill place={process.place} />
        </span>
        <span
          className={`truncate text-sm ${tag === "Running" && process.page ? "font-mono text-fg" : "text-fg-muted"}`}
        >
          {hostedLine(process, now)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {live ? (
          <>
            {tag === "Running" && (
              <Button
                variant="quiet"
                size="sm"
                icon={RotateCw}
                busy={starting === "restart"}
                onClick={() => presses.press(name, "restart")}
              >
                Restart
              </Button>
            )}
            <Button
              variant="quiet"
              size="sm"
              icon={Square}
              busy={presses.stopping === name}
              onClick={() => presses.press(name, "stop")}
            >
              Stop
            </Button>
          </>
        ) : (
          <Button
            variant="quiet"
            size="sm"
            icon={Play}
            busy={starting === "start"}
            disabled={!startable || presses.starting !== undefined}
            onClick={() => presses.press(name, "start")}
          >
            {tag === "NotStarted" ? "Start" : "Start again"}
          </Button>
        )}
        {onFull !== undefined && (
          <Button variant="quiet" size="sm" icon={full ? Minimize2 : Maximize2} onClick={onFull}>
            {full ? "Collapse" : "Expand"}
          </Button>
        )}
        {onClose !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label="Close the side panel"
            onClick={onClose}
          />
        )}
      </div>
    </header>
  )
}

export default ProcessHeader
