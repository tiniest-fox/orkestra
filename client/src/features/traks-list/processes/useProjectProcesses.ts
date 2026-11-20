/**
 * The project checkout's hosted processes and their presses — the git bar's processes cell.
 *
 * **The project is the trak-less key**, as it is on the engine: the same list hook and the
 * same press hook the side panel uses, at `undefined`. A person is the only one who acts
 * here — no turn runs on the project checkout, and a turn's token is refused on its routes
 * — and the presses spend nothing and take no custody, so no drive refuses them.
 *
 * Behind a host with a page domain each `page: true` process has a hostname of its own,
 * as a trak's does, and `origins` names it; with none it is `undefined`.
 */

import { pageOrigins } from "../../../api/pageDomain"
import type { HostedProcessDto } from "../../../api/types"
import type { PageOrigins } from "../../../format/hosted"
import type { ProcessPresses } from "../../../hooks/useProcessPress"
import { useProcessPress } from "../../../hooks/useProcessPress"
import { useProcesses } from "../../../hooks/useProcesses"

export interface ProjectProcesses {
  /** `undefined` until the first answer, and while none has ever come. */
  readonly processes: readonly HostedProcessDto[] | undefined
  readonly presses: ProcessPresses
  readonly origins: PageOrigins | undefined
}

export const useProjectProcesses = (): ProjectProcesses => ({
  processes: useProcesses(undefined).data,
  presses: useProcessPress(undefined),
  origins: pageOrigins(undefined),
})
