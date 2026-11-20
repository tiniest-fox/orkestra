/**
 * Whether a field inside the node `root` is put on has focus on a phone — the moment the
 * keyboard is up, and the one moment the trak screen's pinned chrome hides.
 *
 * **Explicit rather than left to the browser's own pan.** The keyboard shrinks the visual
 * viewport to about 376px of a 667px screen, and the chrome above the pane is about 249px of
 * it: kept, it leaves the field under the header or nothing of the pane at all, and where the
 * browser pans to reveal the field depends on where the field sits. The person settled that
 * the whole chrome goes while any field has the keyboard and comes back when it lets go.
 *
 * **A field raises a keyboard; a checkbox does not.** A tick on the finished card takes
 * focus too, and hiding the chrome for it would move the card out from under the thumb.
 *
 * **The element is held, not a flag**, and asked whether it is still in the document at
 * render: a box that unmounts with its field focused — a send that shuts it — raises no
 * `focusout` in every browser, and a flag would keep the chrome hidden over nothing.
 *
 * **A press holds the chrome where it is until it lands.** Pressing a button below a focused
 * field moves focus to the button at press-down; bringing the chrome back then would insert
 * its 249px above the pane before the release, and the release would land on whatever moved
 * under the thumb — no `click`, a jump, and a second press. So focus leaving a field while
 * a press is down is settled only once that press has raised its `click`, been cancelled,
 * or has come up and raised nothing within `SETTLE_MS`. A phone's tap moves focus on the
 * compatibility `mousedown` that follows `pointerup`, which is why the press lasts until
 * the `click` rather than until `pointerup`.
 *
 * **`root` is a callback ref, not a `RefObject`**: the page draws the node only once the
 * trak has loaded, after this hook's first effect has run, and a ref object changing its
 * `current` re-runs nothing.
 */

import { useEffect, useState } from "react"

/** Whether a field has the keyboard, and the ref that says where to listen. */
export interface Typing {
  readonly typing: boolean
  readonly root: (node: HTMLElement | null) => void
}

/** Input types that take a press or a pick rather than typing. */
const PRESSED = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
])

const raisesKeyboard = (node: EventTarget | null): node is HTMLElement => {
  if (node instanceof HTMLTextAreaElement) return true
  if (node instanceof HTMLInputElement) return !PRESSED.has(node.type)
  return node instanceof HTMLElement && node.isContentEditable
}

/** How long after a press comes up it may still raise the `click` that ends it. */
const SETTLE_MS = 500

export const useTyping = (phone: boolean): Typing => {
  const [node, root] = useState<HTMLElement | null>(null)
  const [field, setField] = useState<HTMLElement | undefined>(undefined)
  useEffect(() => {
    if (!phone || node === null) return undefined
    let pressing = false
    let fallback: ReturnType<typeof setTimeout> | undefined
    const settle = (): void => {
      pressing = false
      clearTimeout(fallback)
      const active = document.activeElement
      setField(raisesKeyboard(active) && node.contains(active) ? active : undefined)
    }
    const entered = (event: FocusEvent): void => {
      if (raisesKeyboard(event.target)) setField(event.target)
      else if (!pressing) setField(undefined)
    }
    // Focus moving to another field inside raises `focusin` straight after, which takes it.
    const left = (): void => {
      if (!pressing) setField(undefined)
    }
    const down = (): void => {
      pressing = true
      clearTimeout(fallback)
    }
    const up = (): void => {
      if (!pressing) return
      clearTimeout(fallback)
      fallback = setTimeout(settle, SETTLE_MS)
    }
    // After the `click` has run its handlers, so the chrome moves only once the press landed.
    const clicked = (): void => {
      if (!pressing) return
      clearTimeout(fallback)
      fallback = setTimeout(settle, 0)
    }
    node.addEventListener("focusin", entered)
    node.addEventListener("focusout", left)
    node.addEventListener("pointerdown", down, true)
    document.addEventListener("pointerup", up, true)
    document.addEventListener("pointercancel", settle, true)
    document.addEventListener("click", clicked, true)
    return () => {
      node.removeEventListener("focusin", entered)
      node.removeEventListener("focusout", left)
      node.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", settle, true)
      document.removeEventListener("click", clicked, true)
      clearTimeout(fallback)
      setField(undefined)
    }
  }, [node, phone])
  return { typing: phone && field !== undefined && field.isConnected, root }
}
