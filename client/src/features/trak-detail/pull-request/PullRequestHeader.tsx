/**
 * The card's head: what this pull request is, and one way out to it.
 *
 * **The title is a heading and not the hyperlink.** Eighty characters of underline is what
 * made this read as a link standing where a headline should be, and the thing a person
 * actually wants to press is small and specific — so the way out is one glyph beside the
 * title carrying its own accessible name. Same number of presses, far less noise.
 *
 * **The state is an icon on a tone plate**, because it is the one fact that changes what
 * every other word on this pane means, and an icon carries it without spending a line.
 * `headingTone` says which; the plate is the most saturated object on the pane, so it must
 * not assert the wrong one.
 *
 * **Colour is what arrives on confirmation.** A card built from a remembered answer or from
 * the traks list's coarse one keeps every word and loses its tone — the plate goes
 * `neutral`, which is the design system saying *nothing is claimed here* rather than a
 * filter laid over the card. It is drawn from `Heading`, the five fields both answers
 * carry, so there is one header rather than two that could disagree about a draft.
 */

import type { MouseEvent, ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import { toneClass, toneInk } from "../../../format/tone"
import { headingIcon, headingTone, type Heading } from "./pullRequest"

const PullRequestHeader = ({
  pull,
  confirmed,
  onOpen,
}: {
  readonly pull: Heading
  /** Whether a fresh answer has arrived this session. `false` withholds the plate's tone. */
  readonly confirmed: boolean
  /**
   * Inside Orkestra.app, opens the side panel at the Pull request tab instead of leaving for
   * the browser. `undefined` everywhere else, and wherever the card is not the panel's pull
   * request.
   */
  readonly onOpen: (() => void) | undefined
}): ReactNode => {
  const Icon = headingIcon(pull)
  const tone = confirmed ? headingTone(pull) : "neutral"
  const label = `Open pull request #${String(pull.number)} ${onOpen === undefined ? "on GitHub" : "in the side panel"}`
  // The address stays on the link either way, so it can still be copied or opened with a
  // modifier; a plain press is what goes to the panel.
  const open =
    onOpen === undefined
      ? undefined
      : (event: MouseEvent) => {
          event.preventDefault()
          onOpen()
        }
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 pb-3.5 pt-4">
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-surface ${toneClass[tone]}`}
      >
        <Icon size={15} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-2xs text-fg-subtle">
          <span className="font-medium uppercase tracking-wide">
            {pull.isDraft && pull.state === "open" ? "Draft pull request" : "Pull request"}
          </span>
          <span className="font-mono">#{String(pull.number)}</span>
          {pull.state !== "open" && (
            <span className={`font-medium ${toneInk[tone]}`}>{pull.state}</span>
          )}
        </span>
        <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-lg font-medium text-fg">
          <span className="min-w-0">{pull.title}</span>
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            onClick={open}
            aria-label={label}
            className="inline-flex shrink-0 translate-y-px items-center rounded-control text-fg-subtle hover:text-fg"
          >
            <ExternalLink size={11} aria-hidden />
          </a>
        </h3>
      </div>
    </div>
  )
}

export default PullRequestHeader
