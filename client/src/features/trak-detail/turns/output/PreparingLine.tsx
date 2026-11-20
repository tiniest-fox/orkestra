/**
 * What the engine is preparing while a position runs: the files a turn reads being copied,
 * its sandbox started again, or the setup script still running after the turn started ahead
 * of it — with the line under it, where a sandbox's is the runner file's own description.
 *
 * **On the live row only, and gone once the preparation ends**, for `Reattaching`'s reason:
 * it says what the engine is doing now, so the transcript keeps no copy of it. At
 * `Preparing` the engine's block says this instead, and takes the pane.
 */

import type { ReactNode } from "react"
import { CircleDashed } from "lucide-react"
import type { PreparingPhaseDto } from "../../../../api/types"
import { phaseWords } from "../../../../format/preparing"

const PreparingLine = ({
  preparing,
}: {
  readonly preparing: PreparingPhaseDto | undefined
}): ReactNode => {
  if (preparing === undefined) return undefined
  const { label, line } = phaseWords(preparing)
  return (
    <p role="status" className="flex min-w-0 items-start gap-1.5 text-sm text-fg-muted">
      <CircleDashed size={13} aria-hidden className="mt-1 shrink-0 text-tone-working" />
      <span className="min-w-0 break-words">
        <span className="text-fg">{label}</span> — {line}
      </span>
    </p>
  )
}

export default PreparingLine
