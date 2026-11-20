/**
 * One person, as a disc: their initials over a wash of a hue derived from their handle.
 *
 * **The colour is inline and cannot be a token, which is the exception rather than a
 * relaxation.** A token names a fixed decision and there is no fixed set of people — the
 * hue comes out of `avatarHue`, so `styles.css` has nothing to name. What the expression
 * does honour is the two rules that matter: it is mixed against `--color-surface` and
 * `--color-fg`, so it follows the scheme instead of assuming a light one, and the wash is
 * weak enough that a disc never competes with a tone plate. *Who did this* is its own
 * family and must not borrow from *how it is going* — `styles.css` carries that rule as
 * `source-human`/`source-machine`.
 *
 * **Never `aria-hidden`.** The handle is the label, because on a comment row the disc and
 * the name say the same thing and on the stack beside the Review verdict the disc is the
 * only thing that says it at all.
 */

import type { ReactNode } from "react"
import { avatarHue, initials } from "./people"

/** The three the pane uses: a comment, the stack, and the head of a reviewer's block. */
const BOX: Record<"sm" | "md" | "lg", string> = {
  sm: "size-4 text-2xs",
  md: "size-5 text-2xs",
  lg: "size-7 text-xs",
}

const Avatar = ({
  who,
  size = "md",
}: {
  readonly who: string
  readonly size?: "sm" | "md" | "lg"
}): ReactNode => {
  const hue = String(avatarHue(who))
  return (
    <span
      role="img"
      aria-label={who}
      title={who}
      className={`inline-flex shrink-0 items-center justify-center rounded-pill font-medium ${BOX[size]}`}
      style={{
        background: `color-mix(in oklab, hsl(${hue} 65% 50%) 15%, var(--color-surface))`,
        color: `color-mix(in oklab, hsl(${hue} 65% 45%) 60%, var(--color-fg))`,
      }}
    >
      {initials(who)}
    </span>
  )
}

export default Avatar
