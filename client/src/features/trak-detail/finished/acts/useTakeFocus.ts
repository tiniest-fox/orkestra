/**
 * Put focus into a control by its id — without scrolling at desk, with the browser's own
 * scroll on a phone.
 *
 * **For a press that opens a box to type in.** Focus is what a keyboard user expects
 * after it. **No scroll at desk**: the box opens inside the band pinned at the pane's edge,
 * so it is already on screen, and scrolling a sticky node into view drags the content under
 * it to wherever the band sits in the flow.
 *
 * **On a phone that premise fails**: the focus raises the keyboard, which shrinks only the
 * visual viewport, and the band stays pinned to the layout viewport's foot behind it.
 * `preventScroll` is what stops the browser revealing the focused field above the keyboard,
 * so a phone focus goes without it. Not an explicit `scrollIntoView`: it runs in this
 * effect, before the keyboard is up, so it would measure a viewport about to change.
 *
 * **A hook, because it reaches another component's node** — `Field` owns the textarea
 * and this finds it by the id the box gave it. A layout effect, so the frame that paints
 * the box already has it rather than one frame without it. It runs
 * when `when` turns true or the id changes; a caller that opens the box without a press
 * — a tick on the card — passes `false`, so a tick never raises a phone keyboard.
 */

import { useLayoutEffect } from "react"

export const useTakeFocus = (id: string, when: boolean, phone: boolean): void => {
  useLayoutEffect(() => {
    if (!when) return
    const node = document.getElementById(id)
    if (node === null) return
    node.focus({ preventScroll: !phone })
  }, [id, when, phone])
}
