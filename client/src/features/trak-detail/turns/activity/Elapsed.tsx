/**
 * How long the thing on this row has been going, in the trailing slot — and it is only
 * ever there while it is still going.
 *
 * **The slot always means elapsed, and liveness rides with it rather than instead of
 * it.** A column that held a duration on one row and a running mark on the next would
 * mean two things one row apart. So the dot and the number are one component and neither is drawn
 * without the other.
 *
 * **`tone-working` because that is what the tone means** — something is in flight right
 * now — and there is no second ink here: a finished row draws nothing at all, so the
 * `fg-subtle` half of a two-state treatment has nothing to be in.
 *
 * The motion is `animate-thinking`, the system's one token for *this is still going*.
 * Reusing it on a single dot is deliberately not a second speed, which is the thing its
 * comment in `styles.css` asks a caller not to introduce.
 */

import type { ReactNode } from "react"

const Elapsed = ({ text }: { readonly text: string }): ReactNode => (
  <span className="flex items-center gap-1 font-mono text-2xs text-tone-working">
    {/* Aria-hidden and unlabelled: the duration beside it is the readable half, and a
        screen reader given *running* here would hear it on every row that has one. */}
    <span
      aria-hidden
      className="size-0.5 animate-thinking rounded-pill bg-tone-working motion-reduce:animate-none"
    />
    {text}
  </span>
)

export default Elapsed
