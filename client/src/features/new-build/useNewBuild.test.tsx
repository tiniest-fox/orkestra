/**
 * The hook's decisions against an injected read: a changed id opens the offer, Later
 * holds that id back and a second rebuild opens it again, and every *could not tell* —
 * no own id, a failed read, no id reported — leaves it shut. The next ask is driven by
 * invalidating the key, which is what the stream's reconnect and the poll both amount to.
 */

import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { queryKeys } from "../../queryCache"
import { useNewBuild } from "./useNewBuild"

afterEach(cleanup)

const mount = (read: () => Promise<string | undefined>, own: string | undefined) => {
  const client = new QueryClient()
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useNewBuild(read, own), { wrapper })
  const askAgain = async (): Promise<void> => {
    await act(() => client.invalidateQueries({ queryKey: queryKeys.build }))
  }
  return { hook, askAgain }
}

/** A read answering each id in turn, then the last one for ever. */
const answering = (...ids: (string | undefined)[]) => {
  let next = 0
  return vi.fn<() => Promise<string | undefined>>(() => {
    const id = ids[Math.min(next, ids.length - 1)]
    next += 1
    return Promise.resolve(id)
  })
}

describe("useNewBuild", () => {
  it("opens once the engine reports a build other than this page's", async () => {
    const { hook, askAgain } = mount(answering("own", "rebuilt"), "own")
    await waitFor(() => {
      expect(hook.result.current.open).toBe(false)
    })
    await askAgain()
    await waitFor(() => {
      expect(hook.result.current.open).toBe(true)
    })
  })

  it("stays shut after Later, and opens again for the next rebuild", async () => {
    const { hook, askAgain } = mount(answering("first", "second"), "own")
    await waitFor(() => {
      expect(hook.result.current.open).toBe(true)
    })
    act(() => {
      hook.result.current.later()
    })
    expect(hook.result.current.open).toBe(false)
    await askAgain()
    await waitFor(() => {
      expect(hook.result.current.open).toBe(true)
    })
  })

  it("never asks on a page with no build id of its own", async () => {
    const read = answering("rebuilt")
    const { hook, askAgain } = mount(read, undefined)
    await askAgain()
    expect(read).not.toHaveBeenCalled()
    expect(hook.result.current.open).toBe(false)
  })

  it("stays shut where the read fails or the engine reports no id", async () => {
    const failing = vi.fn<() => Promise<string | undefined>>(() =>
      Promise.reject(new Error("the engine is down")),
    )
    const failed = mount(failing, "own")
    await waitFor(() => {
      expect(failing).toHaveBeenCalled()
    })
    expect(failed.hook.result.current.open).toBe(false)

    const none = answering(undefined)
    const unbuilt = mount(none, "own")
    await waitFor(() => {
      expect(none).toHaveBeenCalled()
    })
    expect(unbuilt.hook.result.current.open).toBe(false)
  })
})
