import { describe, expect, it } from "vitest"
import { sizeOf } from "./size"

describe("sizeOf", () => {
  it("reads bytes, kilobytes and megabytes", () => {
    expect(sizeOf(512)).toBe("512 bytes")
    expect(sizeOf(1536)).toBe("1.5 KB")
    expect(sizeOf(200 * 1024)).toBe("200 KB")
    expect(sizeOf(1024 * 1024 + 1)).toBe("1.0 MB")
  })
})
