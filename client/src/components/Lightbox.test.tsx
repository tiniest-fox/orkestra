/**
 * The two things this component exists to get right and no eye would catch: that it holds
 * focus as it opens — without which Escape goes to the page behind the wash — and that the
 * wash shuts it while the thing standing on the wash does not.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import Lightbox from "./Lightbox"

afterEach(cleanup)

describe("Lightbox", () => {
  it("takes focus onto the way out as it opens", () => {
    render(
      <Lightbox label="a shot" onClose={vi.fn<() => void>()}>
        <img src="/shot.png" alt="a shot" />
      </Lightbox>,
    )

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus()
  })

  it("shuts on Escape", () => {
    const shut = vi.fn<() => void>()
    render(
      <Lightbox label="a shot" onClose={shut}>
        <img src="/shot.png" alt="a shot" />
      </Lightbox>,
    )

    fireEvent.keyDown(screen.getByRole("dialog", { name: "a shot" }), { key: "Escape" })

    expect(shut).toHaveBeenCalledTimes(1)
  })

  it("shuts on a press on the wash, and not on a press on what it is showing", () => {
    const shut = vi.fn<() => void>()
    render(
      <Lightbox label="a shot" onClose={shut}>
        <img src="/shot.png" alt="a shot" />
      </Lightbox>,
    )

    // The picture: pressing it must not shut the view that was opened to see it.
    fireEvent.click(screen.getByRole("img", { name: "a shot" }))
    expect(shut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("dialog", { name: "a shot" }))
    expect(shut).toHaveBeenCalledTimes(1)
  })

  it("shuts on the close control", () => {
    const shut = vi.fn<() => void>()
    render(
      <Lightbox label="a shot" onClose={shut}>
        <img src="/shot.png" alt="a shot" />
      </Lightbox>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    expect(shut).toHaveBeenCalledTimes(1)
  })
})
