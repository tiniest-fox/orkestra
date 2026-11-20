import { describe, expect, it } from "vitest"
import { splitModel } from "./qualified-model.js"

describe("splitModel", () => {
  it("reads a bare name as a model with no provider named", () => {
    expect(splitModel("opus")).toEqual({ provider: undefined, model: "opus" })
  })

  it("reads the qualifier off a qualified name", () => {
    expect(splitModel("codex/gpt-5.6-sol")).toEqual({ provider: "codex", model: "gpt-5.6-sol" })
  })

  it("splits at the first slash only — what follows is the provider's own", () => {
    expect(splitModel("codex/org/model")).toEqual({ provider: "codex", model: "org/model" })
  })
})
