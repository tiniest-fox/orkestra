/**
 * Tier 2 (`testing-tiers`): the control alone, with the two hooks faked at their
 * interfaces — no network, because the component never fetches.
 *
 * The facts worth asserting here: the press is named for the *bound* app, the menu
 * offers only the others, a pick reaches `choose` with the row's own id, the two kinds
 * differ in their pick half's name and nothing else, and the states with nothing to
 * offer draw nothing rather than a dead control.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import OpenerControl from "./OpenerControl"
import { makeOpener } from "../fixtures"
import type { OpenerChoosing } from "../hooks/useChooseOpener"
import type { CheckoutOpening } from "../hooks/useOpenProjectCheckout"

const idle = { isPending: false, disabled: false, said: undefined }
const choosing = (over: Partial<OpenerChoosing> = {}): OpenerChoosing => ({
  choose: () => {},
  ...idle,
  ...over,
})
const opening = (over: Partial<CheckoutOpening> = {}): CheckoutOpening => ({
  open: () => {},
  ...idle,
  ...over,
})

const GHOSTTY = makeOpener({ icon: "data:image/png;base64,AA==" })
const APPLE = makeOpener({ id: "com.apple.Terminal", name: "Terminal" })
const ZED = makeOpener({ id: "dev.zed.Zed", name: "Zed" })
const XCODE = makeOpener({ id: "com.apple.dt.Xcode", name: "Xcode" })

afterEach(cleanup)

describe("OpenerControl", () => {
  it("names the press for the bound app, and pressing it opens", () => {
    const open = vi.fn<() => void>()
    render(
      <OpenerControl
        kind="terminal"
        apps={[GHOSTTY, APPLE]}
        chosen={GHOSTTY.id}
        choosing={choosing()}
        opening={opening({ open })}
        at="this trak's checkout"
      />,
    )

    const press = screen.getByRole("button", { name: "Open Ghostty at this trak's checkout" })
    // The hover name, which is the only place the name is written out at rest.
    expect(press).toHaveAttribute("title", "Ghostty")
    fireEvent.click(press)
    expect(open).toHaveBeenCalledOnce()
  })

  it("ends the press's name with where it opens", () => {
    render(
      <OpenerControl
        kind="terminal"
        apps={[GHOSTTY]}
        chosen={GHOSTTY.id}
        choosing={choosing()}
        opening={opening()}
        at="the project checkout"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Open Ghostty at the project checkout" }),
    ).toBeEnabled()
  })

  it("lists the other apps only, and a pick sends that row's id and shuts", () => {
    const choose = vi.fn<(id: string) => void>()
    render(
      <OpenerControl
        kind="terminal"
        apps={[GHOSTTY, APPLE]}
        chosen={GHOSTTY.id}
        choosing={choosing({ choose })}
        opening={opening()}
        at="this trak's checkout"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a terminal" }))
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Terminal"])

    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal" }))
    expect(choose).toHaveBeenCalledWith("com.apple.Terminal")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("draws no chevron with one app installed — nothing to switch to", () => {
    render(
      <OpenerControl
        kind="terminal"
        apps={[GHOSTTY]}
        chosen={GHOSTTY.id}
        choosing={choosing()}
        opening={opening()}
        at="this trak's checkout"
      />,
    )

    expect(screen.queryByRole("button", { name: "Choose a terminal" })).toBeNull()
  })

  it("puts the spinner in the mark's place while opening, and the press cannot be pressed again", () => {
    const { container } = render(
      <OpenerControl
        kind="terminal"
        apps={[GHOSTTY, APPLE]}
        chosen={GHOSTTY.id}
        choosing={choosing()}
        opening={opening({ isPending: true })}
        at="this trak's checkout"
      />,
    )

    const press = screen.getByRole("button", { name: "Open Ghostty at this trak's checkout" })
    expect(press).toBeDisabled()
    // Replaced, not joined: the icon is gone and one glyph is spinning in its place.
    expect(container.querySelector("img")).toBeNull()
    expect(press.querySelectorAll("svg.animate-spin")).toHaveLength(1)
    // The pick half is untouched by the press being in flight.
    expect(screen.getByRole("button", { name: "Choose a terminal" })).toBeEnabled()
  })
})

describe("OpenerControl as an editor, and with nothing to draw", () => {
  it("names the editor's pick half for an editor, and its press the same way", () => {
    render(
      <OpenerControl
        kind="editor"
        apps={[ZED, XCODE]}
        chosen={ZED.id}
        choosing={choosing()}
        opening={opening()}
        at="this trak's checkout"
      />,
    )

    expect(screen.getByRole("button", { name: "Open Zed at this trak's checkout" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Choose an editor" }))
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Xcode"])
  })

  it("falls back to the plain glyph where the engine read no icon", () => {
    const { container } = render(
      <OpenerControl
        kind="editor"
        apps={[ZED]}
        chosen={ZED.id}
        choosing={choosing()}
        opening={opening()}
        at="this trak's checkout"
      />,
    )

    // The icon is decorative (`alt=""`), so the element is the only thing to ask about.
    expect(container.querySelector("img")).toBeNull()
  })

  it("renders the refusal sentence, and the open press's wins", () => {
    render(
      <OpenerControl
        kind="editor"
        apps={[ZED]}
        chosen={ZED.id}
        choosing={choosing({ said: "Could not set the editor." })}
        opening={opening({ said: "Could not open an editor here." })}
        at="this trak's checkout"
      />,
    )

    expect(screen.getByRole("alert").textContent).toBe("Could not open an editor here.")
  })

  it("draws nothing when the chosen id names nothing — the scan found no app of the kind", () => {
    const { container } = render(
      <OpenerControl
        kind="editor"
        apps={[]}
        chosen={undefined}
        choosing={choosing()}
        opening={opening()}
        at="this trak's checkout"
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
