/** What a person said to the goal's composer draws as markdown with its line breaks kept. */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import ThreadLine from "./ThreadLine"

afterEach(cleanup)

describe("ThreadLine", () => {
  it("draws a person's message as markdown, keeping a single line break", () => {
    const { container } = render(
      <ul>
        <ThreadLine
          words={{ _tag: "Said", text: "split it\ninto two\n\n`one` more", attachments: [] }}
        />
      </ul>,
    )

    const paragraphs = container.querySelectorAll("p")
    expect(paragraphs[0]?.innerHTML).toBe("split it<br>\ninto two")
    expect(screen.getByText("one").tagName).toBe("CODE")
  })
})
