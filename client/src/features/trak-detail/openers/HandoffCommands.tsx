/**
 * How a person picks a sandboxed trak's session up themselves: a quiet press beside the
 * openers whose panel holds the commands, each selectable whole, with the sentence that
 * says where to run it. Every string is the engine's — `HandoffDto` — so nothing here
 * knows which CLI a session runs on or how a host names a project.
 *
 * **Under a host the panel leads with the line to run on the host's machine**, because no
 * terminal the engine opens is the viewer's and the page draws no terminal press there.
 * Under `pnpm serve` the terminal press opens the shell, and the panel holds only what to
 * type in it. Desktop only, as the openers are: the page withholds it below the breakpoint.
 */

import type { ReactNode } from "react"
import { SquareTerminal } from "lucide-react"
import type { HandoffDto } from "../../../api/types"
import OverflowMenu from "../../../components/OverflowMenu"
import { CODE } from "../../../components/PseudoCode"

const Command = ({ said, line }: { readonly said: string; readonly line: string }): ReactNode => (
  <span className="flex flex-col gap-1 px-2 py-1.5">
    <span className="text-sm text-fg-muted">{said}</span>
    <code className={`${CODE} select-all whitespace-nowrap rounded-control bg-surface-2 text-fg`}>
      {line}
    </code>
  </span>
)

const HandoffCommands = ({ handoff }: { readonly handoff: HandoffDto }): ReactNode => {
  const { host, resume } = handoff
  if (host === undefined && resume === undefined) return undefined
  return (
    <OverflowMenu
      label="Resume this session yourself"
      icon={SquareTerminal}
      face={<span>Resume</span>}
    >
      {host !== undefined && (
        <Command said="On the host's machine, open a shell in the trak's sandbox:" line={host} />
      )}
      {resume !== undefined && (
        <Command
          said={
            host === undefined
              ? "In the sandbox shell the terminal button opens, resume the latest session:"
              : "Then resume the latest session there:"
          }
          line={resume}
        />
      )}
    </OverflowMenu>
  )
}

export default HandoffCommands
