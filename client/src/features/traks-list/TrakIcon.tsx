/**
 * The glyphs the list draws, as lucide's own components.
 *
 * **They were nineteen hand-traced 24×24 stroke paths**, under a header arguing lucide was
 * not a dependency here. It is (`client/package.json`), and the whole barrel is in this
 * bundle regardless — `format/glyph` resolves an agent's icon by a name that arrives at
 * runtime and cannot be tree-shaken against — so the size argument the tracing rested on
 * was already gone. The deferral named the eighteenth state wanting a glyph as the
 * moment to convert, and the pull-request rungs are seven of them at once.
 *
 * **The conversion redrew seven of them**, because lucide has revised them since they were
 * traced: `activity`, `circleDashed`, `eye`, `flag`, `gitBranch`, `messages` and
 * `sparkles` are each the library's current drawing rather than the one that was here.
 * That is the point of taking them from the package — the alternative is a private copy
 * that drifts from the icon every other surface draws. **A glyph that has to differ from
 * lucide's wants a reason written down here, not a path pasted back in.**
 *
 * `size` is a prop rather than a class because it is SVG geometry: a stroke scaled by CSS
 * is not the same drawing.
 *
 * **Nothing here moves.** The two states that say something is happening take the segment
 * travelling the plate's edge instead — `Plate`, through `TrakMark`.
 */

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Archive,
  ChevronRight,
  ChevronsUpDown,
  CircleDashed,
  CircleQuestionMark,
  CircleX,
  ClipboardCheck,
  Eye,
  Flag,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  KeyRound,
  LoaderCircle,
  MessagesSquare,
  OctagonAlert,
  Rocket,
  RotateCcwClock,
  Send,
  Shield,
  ShieldAlert,
  ShieldX,
  Sparkles,
  Square,
  Triangle,
  TriangleAlert,
  Unlink,
  Unplug,
} from "lucide-react"
import type { IconName } from "./stateIcon"

/**
 * `Record<IconName, LucideIcon>`, so a name added to the union is a compile error here
 * rather than a row that draws nothing. The keys are the names `stateIcon` and `pullRung`
 * decide in; the values are what lucide calls them, which is not always the same word.
 */
const GLYPHS: Record<IconName, LucideIcon> = {
  activity: Activity,
  archive: Archive,
  chevronRight: ChevronRight,
  chevronsUpDown: ChevronsUpDown,
  circleDashed: CircleDashed,
  circleX: CircleX,
  clipboardCheck: ClipboardCheck,
  eye: Eye,
  flag: Flag,
  gitBranch: GitBranch,
  gitCommit: GitCommitHorizontal,
  gitMerge: GitMerge,
  gitPullRequestClosed: GitPullRequestClosed,
  gitPullRequestDraft: GitPullRequestDraft,
  // A clock with an arrow running back around it, which is what *behind the base* asks
  // you to do. `History` is lucide's own alias for it; the canonical name is here so a
  // dropped alias is a compile error rather than a missing glyph.
  history: RotateCcwClock,
  key: KeyRound,
  messages: MessagesSquare,
  octagonAlert: OctagonAlert,
  question: CircleQuestionMark,
  rocket: Rocket,
  send: Send,
  shield: Shield,
  shieldAlert: ShieldAlert,
  shieldX: ShieldX,
  sparkles: Sparkles,
  spinner: LoaderCircle,
  square: Square,
  triangle: Triangle,
  triangleAlert: TriangleAlert,
  unlink: Unlink,
  unplug: Unplug,
}

/**
 * `aria-hidden` on every one of them, and that is the rule rather than an oversight:
 * nothing here is the only thing saying what it says. The state has a phrase beside
 * it, the activity glyph sits in front of the line it labels — a glyph that named
 * itself would read every row twice.
 */
const TrakIcon = ({
  name,
  size,
}: {
  readonly name: IconName
  readonly size: number
}): ReactNode => {
  const Glyph = GLYPHS[name]
  return <Glyph size={size} aria-hidden className="shrink-0" />
}

export default TrakIcon
