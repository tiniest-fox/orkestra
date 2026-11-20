import { describe, expect, it } from "vitest"
import { iconMime, rankIcons } from "./icon.js"

describe("a project's picture", () => {
  it("is the candidate highest in the tree", () => {
    expect(
      rankIcons(["packages/web/public/favicon.svg", "client/public/icon-512.png", "README.md"]),
    ).toEqual(["client/public/icon-512.png", "packages/web/public/favicon.svg"])
  })

  it("prefers a favicon to a logo, and a vector to a bitmap, at one depth", () => {
    expect(rankIcons(["logo.svg", "favicon.png", "favicon.ico", "favicon.svg"])).toEqual([
      "favicon.svg",
      "favicon.png",
      "favicon.ico",
      "logo.svg",
    ])
  })

  it("takes a sized or suffixed name, and not a word that only starts the same", () => {
    expect(rankIcons(["icon-192.png", "apple-touch-icon.png", "iconography.png"])).toEqual([
      "icon-192.png",
      "apple-touch-icon.png",
    ])
  })

  it("finds nothing in a checkout with no picture", () => {
    expect(rankIcons(["src/main.ts", "favicon.txt", "icons/arrow.svg"])).toEqual([])
  })

  it("names the media type by the file's kind", () => {
    expect(iconMime("a/Favicon.SVG")).toBe("image/svg+xml")
    expect(iconMime("a/icon.ico")).toBe("image/x-icon")
    expect(iconMime("a/icon.gif")).toBeUndefined()
  })
})
