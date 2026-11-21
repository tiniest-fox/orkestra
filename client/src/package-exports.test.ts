// @vitest-environment node
// What another package may import from this one, one module through each of its `exports`,
// so a rename or a dropped entry fails here rather than in the package that imports it.

import { describe, expect, it } from "vitest"
import { FLOOR } from "@orkestra/client/e2e/phone"
import playwright from "@orkestra/client/playwright.config"
import { basePath } from "@orkestra/client/src/base"
import { TrakBand } from "@orkestra/client/src/slots.tsx"
import styles from "@orkestra/client/src/styles.css?raw"
import vite from "@orkestra/client/vite.config"

describe("@orkestra/client", () => {
  it("exports a .ts module under src/ by its path, without the extension", () => {
    expect(basePath("http://host/a/")).toBe("/a/")
  })

  it("exports a .tsx module under src/ by its path, with the extension", () => {
    expect(TrakBand).toBeTypeOf("function")
  })

  it("exports the stylesheet", () => {
    expect(styles).toContain("@import")
  })

  it("exports the build, browser-test and phone-measure modules", () => {
    expect([typeof vite, typeof playwright, FLOOR]).toEqual(["function", "object", 44])
  })

  it("exports the test setup, which runs for its effect and names nothing", async () => {
    expect(Object.keys(await import("@orkestra/client/test-setup"))).toEqual([])
  })
})
