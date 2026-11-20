/**
 * A process's two views as a tab bar — Page and Log — with the page's address, Reload and
 * Open in a browser at its right while the page is up and showing. Drawn only for a process
 * that serves a page, on the desk.
 */

import type { ReactNode } from "react"
import { Globe, RotateCw, ScrollText } from "lucide-react"
import Button from "../../../components/Button"
import Tab from "../../../components/Tab"
import TabBar from "../../../components/TabBar"
import ForgeLink from "../pull-request/reviews/ForgeLink"

export type ProcessView = "page" | "log"

/** The address as a person reads it: no scheme, no trailing slash. */
const shortUrl = (url: string): string => url.replace(/^http:\/\//, "").replace(/\/$/, "")

const ProcessViews = ({
  shown,
  onView,
  url,
  onReload,
}: {
  readonly shown: ProcessView
  readonly onView: (view: ProcessView) => void
  /** The page's address while it is up and showing, else `undefined`. */
  readonly url: string | undefined
  readonly onReload: () => void
}): ReactNode => (
  <TabBar label="Process views">
    <Tab label="Page" icon={Globe} current={shown === "page"} onClick={() => onView("page")} />
    <Tab label="Log" icon={ScrollText} current={shown === "log"} onClick={() => onView("log")} />
    <div className="flex min-w-0 flex-1 items-center justify-end gap-1 px-2">
      {url !== undefined && (
        <>
          <span className="min-w-0 truncate font-mono text-2xs text-fg-subtle">
            {shortUrl(url)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCw}
            aria-label="Reload the page"
            onClick={onReload}
          />
          <span className="flex text-fg-muted">
            <ForgeLink url={url} label="Open in a browser" />
          </span>
        </>
      )}
    </div>
  </TabBar>
)

export default ProcessViews
