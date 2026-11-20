/**
 * The one fact this component exists to get right that no rendered check would catch:
 * the ghosts are drawing, not content, so a reader who is not looking at them hears one
 * sentence and no phantom entries.
 *
 * The words themselves belong to the call site, and `TrakDetailPage.test.tsx` asserts
 * the section that has one.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import EmptySection from "./EmptySection"

afterEach(cleanup)

describe("EmptySection", () => {
  it("reads as one sentence, however many ghosts it draws", () => {
    const { container } = render(<EmptySection count={4}>Nothing decided yet.</EmptySection>)

    expect(screen.getByText("Nothing decided yet.")).toBeDefined()
    // Everything drawn rather than said is hidden — the four ghosts and the mark beside
    // the sentence, which is the first entry's mark with no entry behind it.
    expect(container.textContent).toBe("Nothing decided yet.")
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(2)
  })
})
