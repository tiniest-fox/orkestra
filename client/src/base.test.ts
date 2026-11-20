import { describe, expect, it } from "vitest"
import { basePath, storageKey } from "./base"

describe("basePath", () => {
  it("is the root with no prefix", () => {
    expect(basePath("http://localhost:3000/")).toBe("/")
  })

  it("is the prefix under one", () => {
    expect(basePath("https://host.example/p/x/")).toBe("/p/x/")
  })
})

describe("storageKey", () => {
  it("is the key this browser already holds with no prefix", () => {
    expect(storageKey("orkestra_push_dismissed", "http://localhost:3000/")).toBe(
      "orkestra_push_dismissed",
    )
  })

  it("is distinct for each prefix", () => {
    const x = storageKey("orkestra_push_dismissed", "https://host.example/p/x/")
    const y = storageKey("orkestra_push_dismissed", "https://host.example/p/y/")
    expect(x).toBe("/p/x/orkestra_push_dismissed")
    expect(y).toBe("/p/y/orkestra_push_dismissed")
  })
})
