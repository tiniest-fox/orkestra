/**
 * The hook's memory and its waiting state. The canvas read itself is not here: happy-dom
 * paints no canvas, so `readIconForm` answers `undefined` in it and a fake reader stands in.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { readIconForm, useIconForm } from "./useIconForm"
import type { IconForm } from "./tile"

afterEach(cleanup)

const reader = (answer: IconForm | undefined) =>
  vi.fn<(src: string) => Promise<IconForm | undefined>>(() => Promise.resolve(answer))

describe("useIconForm", () => {
  it("is undefined while the read is in flight, then the form", async () => {
    const read = reader("glyph")
    const { result } = renderHook(() => useIconForm("data:image/svg+xml,a", read))
    expect(result.current).toBeUndefined()
    await waitFor(() => {
      expect(result.current).toBe("glyph")
    })
  })

  it("reads an icon once and starts a later mount with the answer", async () => {
    const read = reader("tile")
    const first = renderHook(() => useIconForm("data:image/png,b", read))
    await waitFor(() => {
      expect(first.result.current).toBe("tile")
    })
    const second = renderHook(() => useIconForm("data:image/png,b", read))
    expect(second.result.current).toBe("tile")
    expect(read).toHaveBeenCalledOnce()
  })

  it("stays undefined when the read fails, and asks again on the next mount", async () => {
    const read = reader(undefined)
    const first = renderHook(() => useIconForm("data:image/png,c", read))
    await waitFor(() => {
      expect(read).toHaveBeenCalledOnce()
    })
    expect(first.result.current).toBeUndefined()
    renderHook(() => useIconForm("data:image/png,c", read))
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
    })
  })

  it("reads nothing for a project with no icon", () => {
    const read = reader("tile")
    const { result } = renderHook(() => useIconForm(undefined, read))
    expect(result.current).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it("answers undefined where the canvas is refused, as under happy-dom", async () => {
    await expect(readIconForm("data:image/png,d")).resolves.toBeUndefined()
  })
})
