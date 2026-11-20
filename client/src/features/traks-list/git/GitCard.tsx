/**
 * The bar's state said in full: the upstream, the counts, the age of the last fetch, and
 * one plate under them — the problem the last press earned, where there is one, and
 * otherwise what the checkout's own state needs saying. The strip opens it upward; the
 * phone's sheet holds it with the presses under it. It holds no press of its own: a
 * problem's way through is in the notice that rose with it.
 */

import type { ReactNode } from "react"
import { GitBranch, TriangleAlert } from "lucide-react"
import { toneFill, toneInk } from "../../../format/tone"
import GitCounts from "./GitCounts"
import GitFetched from "./GitFetched"
import type { GitSaid, GitView } from "./gitView"

const Notice = ({ notice }: { readonly notice: GitSaid }): ReactNode => (
  <div className={`rounded-control px-3 py-2 ${toneFill[notice.tone]}`}>
    <div className={`flex items-start gap-2 ${toneInk[notice.tone]}`}>
      {notice.tone !== "neutral" && (
        <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium">{notice.title}</div>
        <div className="mt-0.5 text-sm break-words text-fg-muted">{notice.body}</div>
      </div>
    </div>
    {notice.files.length > 0 && (
      <ul className="mt-1.5 space-y-0.5 pl-5 font-mono text-2xs text-fg">
        {notice.files.map((file) => (
          <li key={file} className="truncate">
            {file}
          </li>
        ))}
      </ul>
    )}
  </div>
)

const GitCard = ({
  view,
  children,
}: {
  readonly view: GitView
  /** What goes under the notice — the phone's presses. */
  readonly children?: ReactNode
}): ReactNode => {
  const said = view.problem ?? view.standing
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-2xs tracking-wider text-fg-subtle uppercase">
          Project checkout
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-base text-fg">
          <GitBranch size={13} aria-hidden className="shrink-0 text-fg-muted" />
          <span className={`truncate font-mono ${view.detached ? "text-fg-muted italic" : ""}`}>
            {view.head}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-3">
          {view.upstream !== undefined && (
            <span className="truncate font-mono text-2xs text-fg-muted">→ {view.upstream}</span>
          )}
          <GitCounts counts={view.counts} />
        </span>
        <GitFetched view={view} lead="fetched " />
      </div>
      {said !== undefined && <Notice notice={said} />}
      {children}
    </div>
  )
}

export default GitCard
