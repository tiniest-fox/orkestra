import { describe, expect, it } from "vitest"
import { MAX_ATTACHMENTS } from "../api/attachments"
import { admit, take } from "./attachments"

const MB = 1024 * 1024

describe("admit", () => {
  it("takes the four image types, PDFs and text, each up to its own limit", () => {
    expect(admit({ name: "a.png", type: "image/png", size: 5 * MB })).toEqual({
      _tag: "Admitted",
      kind: "image",
      type: "image/png",
    })
    expect(admit({ name: "s.pdf", type: "application/pdf", size: 20 * MB })._tag).toBe("Admitted")
    expect(admit({ name: "n.txt", type: "text/plain", size: MB })._tag).toBe("Admitted")
  })

  it("reads a text file the browser gave no type by its name, and uploads it as text/plain", () => {
    expect(admit({ name: "verify.log", type: "", size: 10 })).toEqual({
      _tag: "Admitted",
      kind: "text",
      type: "text/plain",
    })
  })

  it("uploads text the engine's type list does not name as text/plain, told by its name", () => {
    for (const [name, type] of [
      ["ci.yaml", "application/x-yaml"],
      ["run.sh", "application/x-sh"],
      ["route.ts", "video/mp2t"],
    ] as const)
      expect(admit({ name, type, size: 10 })).toEqual({
        _tag: "Admitted",
        kind: "text",
        type: "text/plain",
      })
  })

  it("names the file and the limit when one is too large", () => {
    expect(admit({ name: "frame.png", type: "image/png", size: 7.8 * MB })).toEqual({
      _tag: "Refused",
      refusal: { name: "frame.png", line: "is 7.8 MB. Images can be up to 5 MB." },
    })
    expect(admit({ name: "spec.pdf", type: "application/pdf", size: 21 * MB })).toMatchObject({
      refusal: { line: "is 21 MB. PDFs can be up to 20 MB." },
    })
  })

  it("refuses an SVG and any other binary, naming what it takes instead", () => {
    expect(admit({ name: "logo.svg", type: "image/svg+xml", size: 10 })).toEqual({
      _tag: "Refused",
      refusal: {
        name: "logo.svg",
        line: "is an SVG. Attach PNG, JPEG, GIF or WebP images, PDFs or text files.",
      },
    })
    const zip = admit({ name: "app.zip", type: "application/zip", size: 10 })
    expect(zip._tag === "Refused" && zip.refusal.line).toBe(
      "is not a file the agent can read. Attach PNG, JPEG, GIF or WebP images, PDFs or text files.",
    )
  })
})

const png = (n: number) => ({ name: `${String(n)}.png`, type: "image/png", size: 10 })

describe("take", () => {
  it("counts the files past the tenth rather than naming them", () => {
    const offered = Array.from({ length: 4 }, (_, i) => png(i))
    const { admitted, refusal } = take(offered, MAX_ATTACHMENTS - 1)
    expect(admitted.map((a) => a.index)).toEqual([0])
    expect(refusal).toEqual({
      name: "3 files",
      line: "were not added. A message holds at most 10 files.",
    })
  })

  it("does not count a refused file against the ten", () => {
    const { admitted, refusal } = take(
      [{ name: "logo.svg", type: "image/svg+xml", size: 1 }, png(1)],
      MAX_ATTACHMENTS - 1,
    )
    expect(admitted.map((a) => a.index)).toEqual([1])
    expect(refusal?.name).toBe("logo.svg")
  })
})
