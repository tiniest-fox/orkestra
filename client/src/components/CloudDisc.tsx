/**
 * The mark for *this ran in a sandbox* where there is no room for the id: a 16px disc with
 * a ring and a subtle cloud, the run mode's disc's twin (`ModeBadge`).
 *
 * **One mark on two screens.** The traks list puts it on a sandboxed trak's square, at the
 * top-right corner opposite the mode's, and a phone's step head under the rail draws it as
 * `PlacePill`'s compact face. Not inked by status: the pill shows none.
 *
 * `label` names it where it stands alone; inside a press that names itself it is
 * decoration, and `undefined` hides it.
 */

import type { ReactNode } from "react"
import { Cloud } from "lucide-react"

const CloudDisc = ({ label }: { readonly label: string | undefined }): ReactNode => (
  <span
    role={label === undefined ? undefined : "img"}
    aria-label={label}
    aria-hidden={label === undefined}
    className="flex size-4 shrink-0 items-center justify-center rounded-pill bg-surface ring-1 ring-border"
  >
    <Cloud size={10} aria-hidden className="text-fg-subtle" />
  </span>
)

export default CloudDisc
