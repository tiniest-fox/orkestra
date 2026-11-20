/**
 * A person, as two letters and a hue — which is the whole of what this app knows about who
 * somebody is.
 *
 * **Derived, because the wire carries nothing else.** `PullRequestCommentDto` and
 * `ReviewDto` carry `who` and no avatar, and the engine's whole forge read is one `gh`
 * call — so a photograph would be a wire field plus an outbound image request per person,
 * which is a decision about the forge read rather than one a surface can make. What this
 * can do instead is be stable: one handle is the same two letters and the same hue on
 * every row, every poll and every trak.
 */

/**
 * Two letters at most: `jenny-w` → JW, `octocat` → OC.
 *
 * **Never one.** A single letter in a disc reads as a bullet rather than as a person, so a
 * one-character handle is doubled rather than left half empty.
 */
export const initials = (who: string): string => {
  const parts = who.split(/[-_. ]/).filter((part) => part !== "")
  const [first, second] = parts
  if (first === undefined) return "??"
  if (second !== undefined) return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase()
  const two = first.slice(0, 2).toUpperCase()
  return two.length === 2 ? two : two.repeat(2)
}

/**
 * The disc's hue in degrees, derived from the handle rather than mapped — so it needs no
 * table and cannot run out.
 *
 * **The mixing step after the loop is the whole of what makes it usable, and the rolling
 * sum alone is not.** In `n * 31 + code` the last character contributes its code straight
 * to the total, so `marco1` and `marco2` come out one degree apart — two people drawn the
 * same colour, and a reviewer list is exactly where near-identical handles collect. The
 * shift-multiply-shift is what spreads the low bits back over the range before the modulo
 * takes them.
 */
export const avatarHue = (who: string): number => {
  let n = 0
  for (const ch of who) n = Math.imul(n, 31) + ch.charCodeAt(0)
  n = Math.imul(n ^ (n >>> 15), 0x2c1b_3c6d)
  n ^= n >>> 12
  return ((n % 360) + 360) % 360
}
