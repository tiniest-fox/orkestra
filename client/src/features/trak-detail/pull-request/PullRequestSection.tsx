/**
 * One row of the card's table: the label in a fixed left column, the section's own state
 * beside it, and its rows below.
 *
 * **Each section owns its own state and nothing adds the three up.** There is no headline above
 * them and no verdict beside them, and the shape of this component is what keeps it true: there
 * is nowhere here for an aggregate to go. The one slot that takes anything else is `aside`, and
 * it is a mark rather than a verdict — the people who reviewed, never a fourth opinion about
 * them.
 *
 * **`press` makes the verdict the disclosure**, which is how a section is one line: the
 * chevron sits on the words the section already says about itself, so nothing under it
 * has to say them again. The two sections with rows to fold take it; Merging is one line
 * with nothing beneath it and does not.
 *
 * The rule over the top is what separates it from the head above and the section before it.
 * Every section carries one, including the first: the card's head is a different kind of
 * thing from a row of its table, and the rule is what says so.
 *
 * **`withheld` is the one place a card that nobody has confirmed differs from one that is
 * right**, and it is built out of the tone vocabulary rather than out of a filter over the
 * card: the verdict keeps every word and is drawn `neutral`, which is what `tone.ts` already
 * means by *nothing is owed*. One place applies it, so a section cannot be toned two ways.
 */

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { toneInk } from "../../../format/tone"
import type { Verdict } from "./pullRequest"

const PullRequestSection = ({
  heading,
  verdict,
  withheld = false,
  press,
  aside,
  children,
}: {
  readonly heading: string
  /** What this section says about itself, in its own words. Never about another section. */
  readonly verdict: Verdict
  /** Whether this verdict is one nobody has confirmed this session — see the header. */
  readonly withheld?: boolean
  /** Present where the verdict opens and shuts what is under it. */
  readonly press?: { readonly open: boolean; readonly onPress: () => void }
  /** A mark beside the verdict — the reviewers' faces, and nothing that carries a state. */
  readonly aside?: ReactNode
  readonly children?: ReactNode
}): ReactNode => {
  const words = (
    <span className={`min-w-0 text-sm font-medium ${toneInk[withheld ? "neutral" : verdict.tone]}`}>
      {verdict.text}
    </span>
  )
  return (
    <section className="flex min-w-0 gap-3 border-t border-border px-4 py-3.5">
      <h4 className="w-20 shrink-0 pt-0.5 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
        {heading}
      </h4>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {press === undefined ? (
            words
          ) : (
            <button
              type="button"
              aria-expanded={press.open}
              onClick={press.onPress}
              className="flex min-w-0 items-center gap-2 rounded-control text-left max-sm:min-h-11"
            >
              {words}
              <ChevronRight
                size={12}
                aria-hidden
                className={`shrink-0 text-fg-subtle ${press.open ? "rotate-90" : ""}`}
              />
            </button>
          )}
          <span className="flex-1" />
          {aside}
        </div>
        {children}
      </div>
    </section>
  )
}

export default PullRequestSection
