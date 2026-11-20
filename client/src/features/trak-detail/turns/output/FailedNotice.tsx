/**
 * A turn that gave up.
 *
 * **A notice rather than a card**, because there is no document. `failed` carries an error
 * string and nothing else, and a bordered surface with a header would be promising a body
 * that does not exist.
 *
 * **A check that came back non-zero is not drawn here** but on the card's Gate face —
 * `GateFace` — because the check and the work it judges are one object, and a plate above the
 * card could only ever be about the newest attempt.
 *
 * **The string is bytes a spawned process wrote, so it may carry terminal escapes** —
 * `failed.error` reliably does, being the CLI's own coloured stderr from a turn that gave
 * up on a non-zero exit. `AnsiText` is what draws it, and is a no-op on plain text.
 */

import type { ReactNode } from "react"
import { CircleSlash } from "lucide-react"
import type { StepOutputDto } from "../../../../api/types"
import AnsiText from "../../../../components/AnsiText"

type Failed = Extract<StepOutputDto, { type: "failed" }>

/**
 * The plate every terminal failure takes, and the reason `Thinking` must not: `tone-bad`
 * on an ordinary row means a call came back non-zero, so error ink is spent on the thing
 * that ended rather than on the retry that recovered. `TrakFailure` is the third one.
 */
export const Shell = ({
  icon,
  head,
  children,
}: {
  readonly icon: ReactNode
  readonly head: string
  readonly children: ReactNode
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-1.5 rounded-surface border border-tone-bad/40 bg-tone-bad-bg px-3 py-2.5">
    <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-tone-bad">
      {icon}
      {head}
    </span>
    {children}
  </div>
)

export const FailedNotice = ({ failed }: { readonly failed: Failed }): ReactNode => (
  <Shell icon={<CircleSlash size={11} />} head="the turn gave up">
    {/* The reason inline rather than in a box: it is a sentence most of the time, and the
        one shape it takes that is not — a CLI's coloured stderr — needs the escapes gone,
        not a plate. The paragraph keeps its own ink and measure either way. */}
    <p className="whitespace-pre-wrap text-base leading-5 text-fg-muted">
      <AnsiText text={failed.error} />
    </p>
  </Shell>
)
