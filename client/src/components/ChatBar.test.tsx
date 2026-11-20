/**
 * The chat bar's attach controls: a file the box refuses never starts an upload and the
 * box says which limit it broke, and the send stays shut until every upload has answered.
 * The upload itself is stubbed at the seam — what it sends is the transport's to test.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import ChatBar from "./ChatBar"
import { useAttachments } from "../hooks/useAttachments"
import { uploadAttachment } from "../api/attachments"
import type * as Attachments from "../api/attachments"
import type { AttachmentUploadedDto } from "../api/types"

// Only the upload is stubbed: the limits the box checks are the engine's real ones.
vi.mock("../api/attachments", async (real) => ({
  ...(await real<typeof Attachments>()),
  uploadAttachment: vi.fn<typeof uploadAttachment>(),
}))

const upload = vi.mocked(uploadAttachment)

afterEach(() => {
  cleanup()
  upload.mockReset()
})

const Bar = ({ onSend }: { readonly onSend: (ids: readonly string[]) => void }): ReactNode => {
  const attach = useAttachments("here")
  const [text, setText] = useState("look")
  return (
    <ChatBar
      id="t"
      label="Say"
      value={text}
      onChange={setText}
      onSend={() => onSend(attach.ids)}
      placeholder="Say something…"
      sendLabel="Send"
      attach={attach}
    />
  )
}

const MB = 1024 * 1024

const file = (name: string, type: string, size: number): File => {
  const f = new File(["x"], name, { type })
  Object.defineProperty(f, "size", { value: size })
  return f
}

const pick = (files: readonly File[]): void => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error("no picker")
  fireEvent.change(input, { target: { files } })
}

const drop = (files: readonly File[]): void => {
  const box = screen.getByRole("textbox", { name: "Say" }).closest("div.flex-col")
  if (box === null) throw new Error("no box")
  fireEvent.drop(box, { dataTransfer: { files, types: ["Files"] } })
}

describe("ChatBar's attach controls", () => {
  it("refuses an oversized image before uploading it, naming the limit", () => {
    render(<Bar onSend={vi.fn<(ids: readonly string[]) => void>()} />)

    pick([file("frame.png", "image/png", 7.8 * MB)])

    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "frame.png is 7.8 MB. Images can be up to 5 MB.",
    )
  })

  it("refuses an SVG dropped on the box", () => {
    render(<Bar onSend={vi.fn<(ids: readonly string[]) => void>()} />)

    drop([file("logo.svg", "image/svg+xml", 100)])

    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("logo.svg is an SVG.")
  })

  it("uploads ten and refuses the eleventh", () => {
    upload.mockReturnValue(new Promise<AttachmentUploadedDto>(() => undefined))
    render(<Bar onSend={vi.fn<(ids: readonly string[]) => void>()} />)

    pick(Array.from({ length: 11 }, (_, i) => file(`${String(i)}.txt`, "text/plain", 10)))

    expect(upload).toHaveBeenCalledTimes(10)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "1 file was not added. A message holds at most 10 files.",
    )
  })

  it("keeps the send shut while a file uploads, then sends its id", async () => {
    const answer = Promise.withResolvers<AttachmentUploadedDto>()
    upload.mockReturnValue(answer.promise)
    const sent = vi.fn<(ids: readonly string[]) => void>()
    render(<Bar onSend={sent} />)

    pick([file("notes.txt", "text/plain", 10)])

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
    expect(screen.getByRole("progressbar", { name: "Uploading notes.txt" })).toBeInTheDocument()

    await act(async () => {
      answer.resolve({ id: "up-1", name: "notes.txt", type: "text/plain", size: 10 })
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(sent).toHaveBeenCalledWith(["up-1"])
  })

  it("removes a tile with its ×", () => {
    upload.mockReturnValue(new Promise<AttachmentUploadedDto>(() => undefined))
    render(<Bar onSend={vi.fn<(ids: readonly string[]) => void>()} />)

    pick([file("notes.txt", "text/plain", 10)])
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }))

    expect(screen.queryByRole("list", { name: "Attached files" })).toBeNull()
  })
})
