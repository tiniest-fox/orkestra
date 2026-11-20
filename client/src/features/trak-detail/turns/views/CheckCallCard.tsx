/**
 * A check the agent ran through the engine's check tool, as an MCP tool's card in the
 * column of its words: `McpCard`'s header naming the call and the check, the verdict at
 * its right end, and the console under it.
 *
 * **Open while it waits or runs, and on a failure or a stop; folded after a pass.** A
 * press belongs to the phase it was made in, as a document's check strip's does, so the
 * card follows its own rule again the moment the run moves on. A reused pass ran nothing
 * and has nothing to open.
 *
 * **Never a document's verdict.** The run judged no filing — the agent asked for it mid-
 * turn — so `TurnsView` keeps it off every card, and it is drawn here, where it was asked
 * for. The daemon's run reaches this through `TrakCheck`, set by the page.
 */

import type { ReactNode } from "react"
import { createContext, useContext, useState } from "react"
import type { CheckRunDto } from "../../../../api/types"
import type { Checked } from "../../../../format/transcriptRows"
import CallVerdict from "./CallVerdict"
import CheckCallConsole from "./CheckCallConsole"
import { type CallPhase, checkCallOf, hasConsole, opensOn } from "./checkCall"
import McpCard from "./McpCard"

/** What the page says about the trak on screen: its one live run, its checkout, its width. */
export interface TrakCheckValue {
  readonly live: CheckRunDto | undefined
  readonly root: string | undefined
  readonly phone: boolean
}

const Live = createContext<TrakCheckValue | undefined>(undefined)

export const TrakCheck = ({
  value,
  children,
}: {
  readonly value: TrakCheckValue
  readonly children: ReactNode
}): ReactNode => <Live value={value}>{children}</Live>

const CheckCallCard = ({
  checked,
  driving,
}: {
  readonly checked: Checked
  /** Whether something is driving the turn this call was made in. */
  readonly driving: boolean
}): ReactNode => {
  const trak = useContext(Live)
  const [chosen, setChosen] = useState<{ readonly phase: CallPhase; readonly open: boolean }>()
  const call = checkCallOf(checked.checked, trak?.live, driving, trak?.root)
  const openable = hasConsole(call)
  const open = openable && (chosen?.phase === call.phase ? chosen.open : opensOn(call.phase))
  return (
    <li className="min-w-0">
      <McpCard
        server={checked.checked.server}
        tool={checked.checked.tool}
        detail={call.name}
        trailing={<CallVerdict call={call} phone={trak?.phone ?? false} />}
        open={open}
        onToggle={
          openable
            ? () => {
                setChosen({ phase: call.phase, open: !open })
              }
            : undefined
        }
      >
        {open ? <CheckCallConsole call={call} /> : undefined}
      </McpCard>
    </li>
  )
}

export default CheckCallCard
