/**
 * The desk's press: hover and focus open the card for as long as they last, and a press
 * pins it. Through `user-event` rather than `fireEvent`, because the fault this guards is
 * the order a real click raises its events in — enter, focus, then the click — and a
 * test that fires the click alone never sees the card hover already opened.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { makeHook } from "../../../../fixtures"
import HookMark from "./HookMark"

afterEach(cleanup)

const hooks = [makeHook(), makeHook({ event: "postToolUse", status: "blocked" })]

const card = (): HTMLElement | null => screen.queryByRole("dialog", { name: "2 hooks, blocked" })

const setup = () => {
  const user = userEvent.setup()
  render(
    <div>
      <HookMark hooks={hooks} />
      <button type="button">elsewhere</button>
    </div>,
  )
  return { user, mark: screen.getByRole("button", { name: "2 hooks, blocked" }) }
}

describe("HookMark on a desk", () => {
  it("opens on hover and shuts when the pointer leaves", async () => {
    const { user, mark } = setup()
    await user.hover(mark)
    expect(card()).not.toBeNull()
    await user.unhover(mark)
    expect(card()).toBeNull()
  })

  it("stays open after a click, which hovers and focuses on its way", async () => {
    const { user, mark } = setup()
    await user.click(mark)
    expect(card()).not.toBeNull()
  })

  it("shuts on a second click", async () => {
    const { user, mark } = setup()
    await user.click(mark)
    await user.click(mark)
    expect(card()).toBeNull()
  })

  it("stays pinned when the pointer leaves", async () => {
    const { user, mark } = setup()
    await user.click(mark)
    await user.unhover(mark)
    expect(card()).not.toBeNull()
  })

  it("stays open on Enter, which focus already opened", async () => {
    const { user, mark } = setup()
    await user.tab()
    expect(mark).toBe(document.activeElement)
    expect(card()).not.toBeNull()
    await user.keyboard("{Enter}")
    expect(card()).not.toBeNull()
  })

  it("pins on a tablet tap, and shuts on a second", async () => {
    const { user, mark } = setup()
    const tap = { keys: "[TouchA]", target: mark }
    await user.pointer(tap)
    expect(card()).not.toBeNull()
    await user.pointer(tap)
    expect(card()).toBeNull()
  })

  it("shuts a pinned card on Escape", async () => {
    const { user, mark } = setup()
    await user.click(mark)
    await user.keyboard("{Escape}")
    expect(card()).toBeNull()
  })

  it("shuts a pinned card on a press outside", async () => {
    const { user, mark } = setup()
    await user.click(mark)
    await user.click(screen.getByRole("button", { name: "elsewhere" }))
    expect(card()).toBeNull()
  })
})
