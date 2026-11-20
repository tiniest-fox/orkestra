/** A person's message, sent or still waiting, draws as markdown with its line breaks kept. */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MarkdownImages } from "../../../../components/Markdown"
import Said from "./Said"

afterEach(cleanup)

const TEXT = "first line\nsecond line\n\n- **one**"

describe("Said", () => {
  for (const waiting of [false, true])
    it(`draws markdown and keeps a single line break ${waiting ? "while waiting" : "once sent"}`, () => {
      const { container } = render(<Said text={TEXT} waiting={waiting} />)

      const paragraph = container.querySelector("p")
      expect(paragraph?.innerHTML).toBe("first line<br>\nsecond line")
      expect(screen.getByRole("listitem")).toHaveTextContent("one")
      expect(screen.getByText("one").tagName).toBe("STRONG")
    })
})

describe("Said's files", () => {
  const shot = {
    name: "shot.png",
    type: "image/png",
    size: 2048,
    path: ".orkestra/.attachments/shot.png",
  }
  const log = {
    name: "run.log",
    type: "text/plain",
    size: 10,
    path: ".orkestra/.attachments/run.log",
  }

  it("draws an image as a thumbnail out of the trak's checkout, and any other file as a line", () => {
    render(
      <MarkdownImages resolve={(path) => `/img?path=${path}`}>
        <Said text="look" attachments={[shot, log]} />
      </MarkdownImages>,
    )

    const thumbs = screen.getByRole("list", { name: "Sent images" })
    expect(thumbs.querySelector("img")?.getAttribute("src")).toBe(`/img?path=${shot.path}`)
    expect(screen.getByRole("list", { name: "Sent files" })).toHaveTextContent("run.log")
  })

  it("draws every file as a line where no checkout is named, as on a goal", () => {
    render(<Said text="look" attachments={[shot, log]} />)

    expect(screen.queryByRole("list", { name: "Sent images" })).toBeNull()
    expect(screen.getByRole("list", { name: "Sent files" })).toHaveTextContent("shot.png")
  })
})
