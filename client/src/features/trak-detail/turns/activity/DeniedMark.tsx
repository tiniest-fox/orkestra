/**
 * The label at the right end of a call line saying the CLI refused the call with nobody
 * asked — under Claude's auto mode, its classifier — and which rule refused it. In the
 * waiting ink a blocked hook takes, and the type the run's `N failed` label is set in:
 * the call did fail, and the label says why.
 */

import type { ReactNode } from "react"
import type { DeniedEntryDto } from "../../../../api/types"
import { deniedRule } from "../../../../format/denied"

const DeniedMark = ({ denied }: { readonly denied: DeniedEntryDto | undefined }): ReactNode => {
  if (denied === undefined) return undefined
  const rule = deniedRule(denied)
  return (
    <span className="shrink-0 font-mono text-2xs text-tone-waiting">
      {rule === undefined ? "denied" : `denied · ${rule}`}
    </span>
  )
}

export default DeniedMark
