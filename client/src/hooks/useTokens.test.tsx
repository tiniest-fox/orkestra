/**
 * The three answers `useTokens` gives, and that only one of them carries colour.
 *
 * The happy path runs the real highlighter: the JavaScript engine needs no wasm, so what
 * this asserts is that a grammar chunk resolves and a theme colours it, not that a stub
 * was called. The chunk that never arrives is the one thing stubbed, because nothing else
 * can make a dynamic import fail on demand.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { useTokens } from "./useTokens"

// A chunk the network dropped. The factory rejects, which is what a failed `import()` is.
vi.mock("@shikijs/langs/yaml", () => Promise.reject(new Error("chunk never arrived")))

// The theme is picked by asking `matchMedia`, stubbed here so it can move. Light to begin with —
// the scheme a headless browser reports too — and flipped by `flip`, which tells every
// listener the way a real `MediaQueryList` does.
let darkNow = false
const listeners = new Set<() => void>()
const flip = (dark: boolean): void => {
  darkNow = dark
  for (const listener of listeners) listener()
}

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return darkNow
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
})
afterAll(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  darkNow = false
})

describe("useTokens", () => {
  it("colours a string whose grammar arrives, one entry per line", async () => {
    const { result } = renderHook(() => useTokens("typescript", ["const a = 1\nlet b = a"]))

    await waitFor(() => {
      expect(result.current).toBeDefined()
    })
    const lines = result.current?.[0] ?? []
    expect(lines).toHaveLength(2)
    expect(lines[0]?.map((t) => t.text).join("")).toBe("const a = 1")
    // At least one run carries a colour, or the theme did nothing.
    expect(lines[0]?.some((t) => t.color !== "")).toBe(true)
  })

  it("answers one entry per string, in the order they were given", async () => {
    const { result } = renderHook(() => useTokens("json", ['{"a": 1}', "[1, 2]"]))

    await waitFor(() => {
      expect(result.current).toHaveLength(2)
    })
    expect(result.current?.[1]?.[0]?.map((t) => t.text).join("")).toBe("[1, 2]")
  })

  it("paints again in the other theme when the OS scheme flips", async () => {
    const { result } = renderHook(() => useTokens("typescript", ["const a = 1"]))
    await waitFor(() => {
      expect(result.current).toBeDefined()
    })
    const light = result.current?.[0]?.[0]?.map((t) => t.color)

    act(() => {
      flip(true)
    })
    // Uncoloured for the moment the other theme loads, then coloured differently.
    await waitFor(() => {
      const dark = result.current?.[0]?.[0]?.map((t) => t.color)
      expect(dark).toBeDefined()
      expect(dark).not.toEqual(light)
    })
    // Same text, other colours: the flip repainted rather than retokenised something else.
    expect(result.current?.[0]?.[0]?.map((t) => t.text).join("")).toBe("const a = 1")
  })

  it("stays undefined for no language, so the caller draws the text as written", async () => {
    const { result } = renderHook(() => useTokens(undefined, ["Makefile: all"]))

    await new Promise((r) => setTimeout(r, 50))
    expect(result.current).toBeUndefined()
  })

  it("stays undefined when the grammar chunk never arrives, rather than throwing", async () => {
    const { result } = renderHook(() => useTokens("yaml", ["a: 1"]))

    // Long enough for the highlighter itself to have loaded; the chunk is what fails.
    await new Promise((r) => setTimeout(r, 300))
    expect(result.current).toBeUndefined()
  })
})
