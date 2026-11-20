/**
 * Why a running turn has gone quiet: the engine cannot reach its sandbox and is trying
 * again, in the runner's own words, and since when.
 *
 * **On the running turn only, and gone once the sandbox answers** — it says what the
 * engine is doing now, so the transcript keeps no copy of it. Below the live end, where
 * the next line the turn writes will appear.
 */

import type { ReactNode } from "react"
import { Unplug } from "lucide-react"
import type { ReattachingDto } from "../../../../api/types"
import { clockOf } from "../../../../format/hostWhen"

const HEADS: Readonly<Record<ReattachingDto["kind"], string>> = {
  unreachable: "The sandbox provider cannot be reached; reattaching",
  lost: "The sandbox cannot be reached; reattaching",
}

const Reattaching = ({
  reattaching,
}: {
  readonly reattaching: ReattachingDto | undefined
}): ReactNode =>
  reattaching === undefined ? undefined : (
    <p role="status" className="flex min-w-0 items-start gap-1.5 text-sm text-fg-muted">
      <Unplug size={13} aria-hidden className="mt-1 shrink-0 text-tone-waiting" />
      <span className="min-w-0 break-words">
        <span className="text-fg">{HEADS[reattaching.kind]}</span> since{" "}
        {clockOf(reattaching.since)} — {reattaching.said}
      </span>
    </p>
  )

export default Reattaching
