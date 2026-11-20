/**
 * The press that lands in the panel, under the event order WebKit gives it.
 *
 * **A button is not mouse-focusable in Safari on macOS**, so a mousedown on one clears
 * focus instead of moving it: the button `Confirmation` focused on mount fires a bubbling
 * `focusout` with `relatedTarget: null` while it is still attached and still enabled, and
 * only then do `mouseup` and `click` arrive. Chromium focuses the button on mousedown, so
 * pressing an already-focused one fires no `focusout` at all, and the browser tier never
 * sees this order. happy-dom moves no focus on a pointer event either, which is why the
 * `focusout` is dispatched by hand here, at the moment WebKit raises it.
 */

import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import Confirmation from "./Confirmation"
import MenuItem from "./MenuItem"
import OverflowMenu from "./OverflowMenu"

afterEach(cleanup)

/** `TrakControls`' shape: an item that swaps itself for a confirmation in the panel. */
const Ending = ({ onConfirm }: { readonly onConfirm: () => void }) => {
  const [asking, setAsking] = useState(false)
  return (
    <OverflowMenu
      label="More options"
      onDismiss={() => {
        setAsking(false)
      }}
    >
      {asking ? (
        <Confirmation
          heading="Archive this trak?"
          press="Archive"
          onCancel={() => {
            setAsking(false)
          }}
          onConfirm={onConfirm}
        >
          The checkout goes.
        </Confirmation>
      ) : (
        <MenuItem
          onClick={() => {
            setAsking(true)
          }}
        >
          Archive this trak
        </MenuItem>
      )}
    </OverflowMenu>
  )
}

describe("OverflowMenu", () => {
  it("lands a press on the focused confirmation when WebKit clears focus on mousedown", async () => {
    const confirmed = vi.fn<() => void>()
    render(<Ending onConfirm={confirmed} />)

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    const confirm = screen.getByRole("button", { name: "Archive" })
    expect(confirm).toHaveFocus()

    // WebKit's mousedown on a button: focus is cleared, not moved.
    fireEvent.mouseDown(confirm)
    fireEvent.focusOut(confirm, { relatedTarget: null })
    // The mouse button comes up a task later, after every microtask has run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // A node the dismissal detached receives these and reaches no React handler.
    fireEvent.mouseUp(confirm)
    fireEvent.click(confirm)

    expect(confirmed).toHaveBeenCalledTimes(1)
  })

  it("still shuts on a click onto background once a press inside has been released", async () => {
    render(<Ending onConfirm={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive this trak" }))
    const confirm = screen.getByRole("button", { name: "Archive" })
    // A press that went nowhere: down and up inside, with no blur between.
    fireEvent.mouseDown(confirm)
    fireEvent.mouseUp(confirm)
    // Then the background: focus cleared, with the button still attached and enabled.
    fireEvent.focusOut(confirm, { relatedTarget: null })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByRole("menu")).toBeNull()
  })
})
