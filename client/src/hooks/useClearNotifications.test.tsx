/**
 * What `useClearNotifications` closes: the notifications under the tag it is given, on
 * mount and again when the tag moves, and nothing at all where the browser has no
 * worker. happy-dom has no `navigator.serviceWorker`, so the registration is a stand-in that
 * records the tag each `getNotifications` was asked with.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { useClearNotifications } from "./useClearNotifications"

const closed: string[] = []

const worker = (getNotifications: unknown): void => {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ getNotifications }) },
  })
}

const shown = ({ tag }: { readonly tag: string }): Promise<{ close: () => void }[]> =>
  Promise.resolve([{ close: () => closed.push(tag) }])

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, "serviceWorker")
  closed.length = 0
})

describe("closing a page's notifications as it opens", () => {
  it("closes the tag's notifications on mount and again when the tag changes", async () => {
    worker(shown)
    const { rerender } = renderHook(({ tag }) => useClearNotifications(tag), {
      initialProps: { tag: "trak:one" },
    })
    await waitFor(() => expect(closed).toEqual(["trak:one"]))
    rerender({ tag: "trak:two" })
    await waitFor(() => expect(closed).toEqual(["trak:one", "trak:two"]))
  })

  it("does nothing where the registration cannot list notifications", async () => {
    worker(undefined)
    renderHook(() => useClearNotifications("goal:one"))
    await Promise.resolve()
    expect(closed).toEqual([])
  })

  it("does nothing where the browser has no service worker", () => {
    expect(() => renderHook(() => useClearNotifications("goal:one"))).not.toThrow()
  })
})
