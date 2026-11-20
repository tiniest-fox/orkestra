/**
 * What a diagram that fails to parse leaves behind outside the block that asked for it.
 *
 * The real `mermaid` runs here, unstubbed: the scratch element it appends to
 * `document.body` is mermaid's own behaviour, so a stub would assert only what the stub
 * was told to do. `render` is spied rather than replaced, so the test can wait for the
 * call to settle instead of guessing at a delay.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { useMermaid } from "./useMermaid"

// The theme is picked by asking `matchMedia`; this pins it to light.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }))
})
afterAll(() => {
  vi.unstubAllGlobals()
})
afterEach(cleanup)

describe("useMermaid", () => {
  it("leaves nothing in the document body when the source does not parse", async () => {
    const { default: mermaid } = await import("mermaid")
    const renders = vi.spyOn(mermaid, "render")

    const { result } = renderHook(() => useMermaid("flowchart TD\n  A -->"))

    await waitFor(() => {
      expect(renders).toHaveBeenCalledOnce()
    })
    await Promise.allSettled(renders.mock.results.map((r): unknown => r.value))

    expect(result.current).toBeUndefined()
    // Mermaid draws its "Syntax error in text" bomb into a `<div id="dmermaid-N">` on the
    // body and throws without removing it. Outside the app root, nothing unmounts it, so
    // every bad diagram stacks one more full-width icon under the window's content.
    expect(document.body.querySelector("svg .error-icon")).toBeNull()
    expect(document.body.querySelector('[id^="dmermaid-"]')).toBeNull()
  })
})
