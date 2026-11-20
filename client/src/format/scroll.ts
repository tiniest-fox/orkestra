/**
 * Whether a reader is at the bottom of what they are reading.
 *
 * **The only question that decides whether an append should move the page under them**,
 * and it is asked by two boxes now — the drawer's pane, which holds a growing transcript,
 * and the console on a card's Gate face, which holds a check printing for five minutes. A
 * second copy would be two ideas of what *at the end* means, differing by whichever
 * number somebody typed second.
 *
 * Its own file rather than an export off `DrawerPane`, because a component importing a
 * helper out of another component is a dependency cycle the moment that component is
 * drawn inside the first — which is exactly the shape here: the pane draws the card, and
 * the card's console asks the pane's question.
 */

/** What counts as *at the bottom*, in pixels. A line is 20, so this is under one. */
const SLACK = 16

/**
 * Slack rather than equality: a scroll container lands on fractional pixels at most zoom
 * levels and after most font loads, so `scrollTop + clientHeight === scrollHeight` is
 * false for a box that is visibly at its end, which would strand a reader who never
 * scrolled anywhere.
 */
export const atBottom = (box: {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}): boolean => box.scrollHeight - box.scrollTop - box.clientHeight <= SLACK
