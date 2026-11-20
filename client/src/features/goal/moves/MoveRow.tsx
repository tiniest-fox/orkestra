/**
 * One of the composer's moves in the thread: the transcript's own call row — the caret,
 * the MCP mark, the tool's name and what it acted on — and, opened, its view in the frame
 * an MCP tool's view takes in a transcript, a card in the column of the agent's words.
 *
 * The newest move starts open and each earlier one folded, as a turn's views do; the
 * press is the row.
 */

import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import ToolCall from "../../../components/ToolCall"
import Line from "../../trak-detail/turns/activity/Line"
import McpMark from "../../trak-detail/turns/activity/McpMark"

const MoveRow = ({
  name,
  about,
  startOpen,
  children,
}: {
  /** `server/tool`, as the call row names an MCP call. */
  readonly name: string
  /** What the move acted on — a trak's title, a count. */
  readonly about: string
  readonly startOpen: boolean
  /** The view. */
  readonly children: ReactNode
}): ReactNode => {
  const [open, setOpen] = useState(startOpen)
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
        className="w-full rounded-control hover:bg-hover-row max-sm:min-h-11"
      >
        <Line
          lead={<ChevronRight size={12} className={`text-fg-subtle ${open ? "rotate-90" : ""}`} />}
        >
          <span className="flex min-w-0 items-baseline gap-1.5">
            <McpMark />
            <span className="min-w-0 flex-1">
              {/* `kind` only picks which end the detail truncates from; the detail here
                  is a title, read from its start. */}
              <ToolCall name={name} detail={about} kind="Bash" />
            </span>
          </span>
        </Line>
      </button>
      {open && (
        <section
          aria-label={`View ${name}`}
          className="mt-1 min-w-0 overflow-hidden rounded-surface bg-surface ring-1 ring-border"
        >
          {children}
        </section>
      )}
    </li>
  )
}

export default MoveRow
