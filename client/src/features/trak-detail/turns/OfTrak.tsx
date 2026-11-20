/**
 * Which trak the transcript below belongs to, said once by the page: where an image an
 * agent wrote is fetched from, what its views are, and the check run the daemon holds for
 * it — which a check the agent ran draws its console from.
 *
 * And which step's diff a change map in a document describes, where there is one.
 *
 * All four are the same statement — nothing between the page and a message bubble or a
 * view's card knows which trak it is drawing, and at a spawn's piece that is the piece
 * rather than the page's own. One provider for them, so a page that says one cannot
 * forget the others.
 */

import type { ReactNode } from "react"
import { MarkdownChanges, type StepDiff } from "../../../components/ChangeMap"
import { MarkdownImages, type ResolveImage } from "../../../components/Markdown"
import type { TrakDetailDto } from "../../../api/types"
import { TrakCheck } from "./views/CheckCallCard"
import type { TrakViewsValue } from "./views/useViews"
import { TrakViews } from "./views/ViewCard"

const OfTrak = ({
  images,
  views,
  trak,
  diff,
  children,
}: {
  readonly images: ResolveImage
  readonly views: TrakViewsValue
  /** The trak whose position this is: its one live check run and its checkout. */
  readonly trak: TrakDetailDto
  /** `undefined` draws every change map standalone. */
  readonly diff: StepDiff | undefined
  readonly children: ReactNode
}): ReactNode => (
  <MarkdownImages resolve={images}>
    <TrakViews views={views}>
      <TrakCheck value={{ live: trak.check, root: trak.worktree?.path, phone: views.phone }}>
        <MarkdownChanges diff={diff}>{children}</MarkdownChanges>
      </TrakCheck>
    </TrakViews>
  </MarkdownImages>
)

export default OfTrak
