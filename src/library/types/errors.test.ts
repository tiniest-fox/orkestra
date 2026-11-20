import { Cause } from "effect"
import { describe, expect, it } from "vitest"
import { LoadFailed } from "./errors.js"

describe("LoadFailed", () => {
  it("carries `path: reason` as its Error message", () => {
    expect(
      new LoadFailed({ path: "agents/build.md", reason: "unknown key `mdel:`." }).message,
    ).toBe("agents/build.md: unknown key `mdel:`.")
  })

  // The reason the getter exists: `pnpm serve` prints a boot failure by rendering the
  // Cause, not by reading the fields, and the default message says nothing at all.
  it("renders through Cause.pretty rather than as 'An error has occurred'", () => {
    const rendered = Cause.pretty(
      Cause.fail(new LoadFailed({ path: "agents/", reason: "no agents." })),
      { renderErrorCause: true },
    )
    expect(rendered.split("\n")[0]).toBe("LoadFailed: agents/: no agents.")
  })
})
