import type { ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import Button from "../../components/Button"

/**
 * The band under the bar that says the engine serves a newer client than this page —
 * one sentence, Reload and Later. In the page's flow rather than over it, so it covers
 * no control: an open trak's drawer lies over it, and it is seen again on the list. The
 * presses sit beside the sentence at the left, where a desk drawer never reaches.
 */
const NewBuildView = ({
  onReload,
  onLater,
}: {
  readonly onReload: () => void
  readonly onLater: () => void
}): ReactNode => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-gutter py-2">
    <RefreshCw size={12} aria-hidden className="shrink-0 text-fg-muted" />
    <span className="text-sm text-fg-muted">A new version of Orkestra is ready.</span>
    <span className="flex items-center gap-2">
      <Button variant="quiet" size="sm" onClick={onReload}>
        Reload
      </Button>
      <Button variant="ghost" size="sm" onClick={onLater}>
        Later
      </Button>
    </span>
  </div>
)

export default NewBuildView
