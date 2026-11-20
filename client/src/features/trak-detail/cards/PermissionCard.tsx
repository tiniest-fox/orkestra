/**
 * A step asking to run one command the CLI refused with nobody asked.
 *
 * **The command is drawn whole and as written**, wrapped, in the frame a shell fence draws in,
 * because it is exactly what a yes allows: the engine quotes it back to the step byte for
 * byte. The reason is the step's own prose, under it.
 *
 * **Read, then decide**: the header only names the card, and Allow and Refuse are a footer
 * row under the command and the reason, so the eye passes the whole command on the way to
 * them. That gives up the pinned press `CardShell`'s sticky header offers — on a phone, a
 * multi-line command puts Allow below the screen — and that cost is taken knowingly.
 * Nothing is filed, so like `StuckCard` there is no Approve; the presses are built by the
 * page and handed in as `actions`.
 *
 * Answered, the card is read later in the transcript: the header goes neutral, the reason
 * is dropped, and the footer is one line saying which way it went.
 */

import type { ReactNode } from "react"
import { Check, KeyRound, X } from "lucide-react"
import type { StepOutputDto } from "../../../api/types"
import CodeBlock from "../../../components/CodeBlock"
import Figure from "../../../components/Figure"
import Markdown from "../../../components/Markdown"
import CardShell from "./CardShell"

type Permission = Extract<StepOutputDto, { type: "permission" }>

const Verdict = ({ granted }: { readonly granted: boolean }): ReactNode =>
  granted ? (
    <span className="flex items-center gap-1.5 text-sm text-tone-good">
      <Check size={13} className="shrink-0" /> Allowed — the step was told it can run this
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-sm text-fg-muted">
      <X size={13} className="shrink-0" /> Refused — the step was told not to run this
    </span>
  )

const PermissionCard = ({
  permission,
  actions,
  permitted,
}: {
  readonly permission: Permission
  /** Allow and Refuse, at the gate this parks. Built by the page. */
  readonly actions: ReactNode
  /** What a person answered, once somebody has: `true` allowed, `false` refused. */
  readonly permitted: boolean | undefined
}): ReactNode => (
  <CardShell
    icon={KeyRound}
    tone={permitted === undefined ? "waiting" : "neutral"}
    head={permitted === undefined ? "Asks to run a command" : "Asked to run a command"}
  >
    <Figure label="command">
      {/* Wrapped rather than scrolled: a person allowing it reads every character, and a
          tail hidden past the frame's edge is part of what they would be allowing. Each
          source line is its own block with a 4ch hanging indent, so a wrapped tail never
          reads as the next line of a heredoc. It breaks at spaces and after a hyphen, which
          can split a flag such as `--delete-branch` across two lines, and splits any other
          token only where it is longer than the line. */}
      <div className="[&>pre]:whitespace-pre-wrap [&>pre]:[overflow-wrap:anywhere] [&>pre>span]:block [&>pre>span]:pl-[4ch] [&>pre>span]:-indent-[4ch]">
        <CodeBlock lang="shell" source={permission.command} />
      </div>
    </Figure>
    {permitted === undefined ? (
      <div className="min-w-0 text-fg-muted">
        <Markdown>{permission.reason}</Markdown>
      </div>
    ) : undefined}
    {permitted === undefined && actions === undefined ? undefined : (
      // Full-bleed out of the body's padding, so the hairline reads as the card's foot
      // rather than a rule inside the reason.
      <div className="-mx-3 -mb-3 flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-border px-3 py-2">
        {permitted === undefined ? (
          actions
        ) : (
          <span className="mr-auto">
            <Verdict granted={permitted} />
          </span>
        )}
      </div>
    )}
  </CardShell>
)

export default PermissionCard
