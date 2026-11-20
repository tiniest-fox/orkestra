/**
 * The goal file the composer drafted, as approving it makes it the goal's: its title and line, its
 * settings and goal branch, and the finished state. The body of the file gate's card, which draws the
 * settings and holds what the person sets on them.
 */

import type { ReactNode } from "react"
import type { GoalDraftDto } from "../../api/types"
import Markdown from "../../components/Markdown"

const DraftFile = ({
  draft,
  settings,
  branch,
}: {
  readonly draft: GoalDraftDto
  readonly settings: ReactNode
  /** The goal branch, which the card draws and holds as it does the settings. */
  readonly branch: ReactNode
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-3">
    <span className="flex flex-col gap-0.5">
      <span className="text-base font-medium text-fg">{draft.title}</span>
      <span className="text-sm text-fg-muted">{draft.line}</span>
    </span>
    {settings}
    {branch}
    <div className="min-w-0 text-base text-fg">
      <Markdown>{draft.finished}</Markdown>
    </div>
  </div>
)

export default DraftFile
