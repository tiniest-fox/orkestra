/**
 * Tier 2: the sentence at the head of a continued position, in its three states.
 * Whether a row *has* the fact, and which state it is in, is `rows.ts`'s and is tested
 * there; where the notice sits in the pane is `StepPane`'s.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import ContinuesNotice from "./ContinuesNotice"

afterEach(cleanup)

describe("ContinuesNotice", () => {
  it("is one press, whole, that goes to the position holding the conversation", () => {
    const onGo = vi.fn<(key: string) => void>()
    render(
      <ContinuesNotice
        continues={{ key: "2-experiment", to: "step:2", fresh: false }}
        carried={undefined}
        onGo={onGo}
      />,
    )

    // The button is the notice, not the key inside it — the key is inline 2xs text in a
    // wrapping sentence, which can never clear the touch floor on its own.
    const press = screen.getByRole("button", { name: /continues the conversation/ })
    fireEvent.click(press)
    expect(onGo).toHaveBeenCalledWith("step:2")
    // Never a claim that turns are drawn there: a joined conversation can sit under a
    // position that has filed nothing yet.
    expect(press.textContent).not.toContain("turns")
  })

  it("says what a joined conversation had already spent, and nothing where it was not measured", () => {
    const { rerender } = render(
      <ContinuesNotice
        continues={{ key: "2-experiment", to: "step:2", fresh: false }}
        carried={1_240_000}
        onGo={() => {}}
      />,
    )
    const press = screen.getByRole("button", { name: /continues the conversation/ })
    expect(press.textContent).toContain("carrying in 1.2m tokens")
    rerender(
      <ContinuesNotice
        continues={{ key: "2-experiment", to: "step:2", fresh: false }}
        carried={undefined}
        onGo={() => {}}
      />,
    )
    expect(press.textContent).not.toContain("carrying in")
  })

  it("says a fresh start plainly, with no press — there is nowhere to go", () => {
    render(
      <ContinuesNotice
        continues={{ key: "4-verify", to: undefined, fresh: true }}
        carried={undefined}
        onGo={() => {}}
      />,
    )

    expect(screen.getByText(/It started fresh/)).toBeDefined()
    // A fresh start inherited nothing, so there is no figure to carry in.
    expect(screen.queryByText(/carrying in/)).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("draws nothing while the turn has no session to compare", () => {
    const { container } = render(
      <ContinuesNotice
        continues={{ key: "2-experiment", to: undefined, fresh: false }}
        carried={undefined}
        onGo={() => {}}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
