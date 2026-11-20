/**
 * Tier 2: which clicks on a card are a press on it.
 *
 * The card is mostly prose, so the whole of it toggles the pick — and four clicks must
 * not: the label's own, which the input has already counted; a link's, which is leaving;
 * one inside a dialog the card holds open; and the one that ends a drag over a reviewer's
 * words, which is told apart from a press by the selection it leaves. happy-dom has no layout
 * and so no real drag, so the selection a drag would leave is made by hand.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Picked } from "./reentryBody"
import SelectCard from "./SelectCard"

afterEach(() => {
  cleanup()
  document.getSelection()?.removeAllRanges()
})

const PICK: Picked = {
  key: "comment:1",
  label: "alice on the pull request",
  said: "alice commented on pull request #41.",
  where: [],
  quote: "This reads oddly.",
}

const draw = (onToggle: ((picked: Picked) => void) | undefined): void => {
  render(
    <SelectCard
      picked={PICK}
      on={false}
      onToggle={onToggle}
      head={<span>on the pull request itself</span>}
      out={<a href="https://github.com/o/r/pull/41#discussion_r1">open on GitHub</a>}
    >
      <p>This reads oddly.</p>
    </SelectCard>,
  )
}

describe("what is a press on the card", () => {
  it("ticks on a click on the body", () => {
    const toggle = vi.fn<(picked: Picked) => void>()
    draw(toggle)
    fireEvent.click(screen.getByText("This reads oddly."))
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledWith(PICK)
  })

  it("ticks once, not twice, on a click on the checkbox itself", () => {
    const toggle = vi.fn<(picked: Picked) => void>()
    draw(toggle)
    fireEvent.click(screen.getByRole("checkbox", { name: "alice on the pull request" }))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it("does not tick on a click on the way out", () => {
    const toggle = vi.fn<(picked: Picked) => void>()
    draw(toggle)
    fireEvent.click(screen.getByRole("link", { name: "open on GitHub" }))
    expect(toggle).not.toHaveBeenCalled()
  })

  /** The picture or diagram a comment opens is a dialog in the card's own tree, and the
   *  press that shuts it bubbles up to the card. */
  it("does not tick on a press inside a dialog the card holds", () => {
    const toggle = vi.fn<(picked: Picked) => void>()
    render(
      <SelectCard picked={PICK} on={false} onToggle={toggle} head={<span>head</span>}>
        <div role="dialog" aria-label="A picture">
          <span>the wash</span>
        </div>
      </SelectCard>,
    )
    fireEvent.click(screen.getByText("the wash"))
    expect(toggle).not.toHaveBeenCalled()
  })

  it("does not tick on the click that ends a drag over the words", () => {
    const toggle = vi.fn<(picked: Picked) => void>()
    draw(toggle)
    const words = screen.getByText("This reads oddly.")
    const range = document.createRange()
    range.selectNodeContents(words)
    document.getSelection()?.addRange(range)
    fireEvent.click(words)
    expect(toggle).not.toHaveBeenCalled()
  })

  it("is not a press at all where there is nothing to send a pick to", () => {
    draw(undefined)
    expect(screen.queryByRole("checkbox")).toBeNull()
    // Nothing to assert a call against: what this holds is that the click is inert rather
    // than an error on a card drawn to be read.
    fireEvent.click(screen.getByText("This reads oddly."))
  })
})
