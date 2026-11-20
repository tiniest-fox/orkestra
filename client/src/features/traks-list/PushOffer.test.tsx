/**
 * The two facts the ask-once band exists to get right: it is not drawn where the
 * browser cannot push, and *Not now* settles it for good rather than for this render.
 *
 * happy-dom has no `Notification`, no `PushManager` and no `navigator.serviceWorker`, so
 * the bare environment IS the cannot-push case — every other page test renders the list
 * with this band never drawn, which is its own regression guard. The capable case stubs
 * the three presence checks; the subscribe flow itself is browser API end to end and is
 * verified on desktop Chrome, not here.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import PushOffer from "./PushOffer"

afterEach(cleanup)

const OFFER = "Get a notification when a trak needs you or finishes."

const pushCapable = (): void => {
  Object.defineProperty(window, "Notification", {
    value: { permission: "default", requestPermission: () => Promise.resolve("denied") },
    configurable: true,
  })
  Object.defineProperty(window, "PushManager", { value: {}, configurable: true })
  Object.defineProperty(window.navigator, "serviceWorker", { value: {}, configurable: true })
}

describe("PushOffer", () => {
  it("is not drawn where the browser cannot push", () => {
    render(<PushOffer />)
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it("offers once, and Not now settles it across renders", () => {
    pushCapable()
    render(<PushOffer />)
    expect(screen.getByText(OFFER)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Not now" }))
    expect(screen.queryByText(OFFER)).toBeNull()

    // A fresh mount is a fresh visit as far as React state goes; what keeps the band
    // shut is the remembered dismissal, which is the thing being asserted.
    cleanup()
    render(<PushOffer />)
    expect(screen.queryByText(OFFER)).toBeNull()
  })
})
