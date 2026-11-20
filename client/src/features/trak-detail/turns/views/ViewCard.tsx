/**
 * An MCP tool's view, as `McpCard` in the column of the agent's words: the header naming
 * the server and the tool, and under it the view.
 *
 * The header is a press. A turn's newest view is open and each earlier one is its
 * header alone, so a turn that drew several does not stack them all at full height —
 * `useViews` decides which, and holds what a person opened or folded.
 *
 * **Everything about the trak arrives through `TrakViews`**, set by the page: which
 * views are open, what the engine kept for each, and the press. Nothing between the page
 * and this card knows which trak is on screen. A card drawn with no provider above it —
 * a surface that shows a transcript and hosts no views — is its header and nothing else.
 */

import type { ReactNode } from "react"
import { createContext, useContext } from "react"
import type { Viewed } from "../../../../format/transcriptRows"
import McpCard from "./McpCard"
import type { TrakViewsValue } from "./useViews"
import ViewFrame from "./ViewFrame"

const Views = createContext<TrakViewsValue | undefined>(undefined)

/** The provider, so a page can say which trak's views the transcript below it draws. */
export const TrakViews = ({
  views,
  children,
}: {
  readonly views: TrakViewsValue
  readonly children: ReactNode
}): ReactNode => <Views value={views}>{children}</Views>

const QUIET = "px-3 py-1.5 font-mono text-xs text-fg-subtle"

const ViewCard = ({ viewed }: { readonly viewed: Viewed }): ReactNode => {
  const views = useContext(Views)
  const { call, server, tool } = viewed.view
  const open = views?.isOpen(call) ?? false
  const view = open ? views?.view(call) : undefined
  return (
    <li className="min-w-0">
      <McpCard
        server={server}
        tool={tool}
        detail={undefined}
        trailing={undefined}
        open={open}
        onToggle={
          views === undefined
            ? undefined
            : () => {
                views.toggle(call)
              }
        }
      >
        {!open || views === undefined ? undefined : view === undefined ? (
          <p className={QUIET}>
            {views.unread(call) ? "This view could not be read." : "Loading the view"}
          </p>
        ) : (
          <ViewFrame
            view={view}
            press={(name, args) => views.press(call, name, args)}
            running={views.running}
            phone={views.phone}
          />
        )}
      </McpCard>
    </li>
  )
}

export default ViewCard
