/**
 * The way out to the forge, which is the only thing on this pane that leaves the app.
 *
 * **A link out is the whole of what this surface offers over there.** Nothing here
 * approves, merges, re-runs a check, resolves a thread or replies — every press on the
 * pull-request half re-enters the trak instead, so the transcript of a run and of a review
 * conversation are both a click away rather than drawn.
 *
 * **Two shapes, and the wordless one is the default on a card.** A row inside a select card
 * already says what it is about, so a second reading of it in link text is noise the card
 * cannot afford — the glyph alone carries `label` as its accessible name and takes a hit
 * area of its own. Words are for the places a link stands on its own line.
 *
 * `target="_blank"` with `rel="noreferrer"`: the tab holding the trak is the one a reader
 * came back to, and the referrer is this machine's own address.
 */

import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"

const ForgeLink = ({
  url,
  label,
  children,
}: {
  readonly url: string
  /** What the link is called for anyone who cannot see it. Required where there are no
   *  words, because the glyph names nothing on its own. */
  readonly label?: string
  readonly children?: ReactNode
}): ReactNode => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    aria-label={label}
    className={`-m-1 inline-flex shrink-0 items-center gap-1 rounded-control p-1 hover:text-fg ${
      children === undefined ? "hover:bg-hover-bare" : "underline"
    }`}
  >
    {children}
    <ExternalLink size={children === undefined ? 12 : 9} aria-hidden />
  </a>
)

export default ForgeLink
