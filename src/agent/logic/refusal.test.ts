// The property that matters is the fraction of the string that is guidance, not
// that it is shorter — a re-ask is read by the agent, and the type expansion is
// the part it cannot act on.

import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { refusalReason } from "./refusal.js"

const Shape = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("a"),
    sections: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal("b"), tried: Schema.String }),
).pipe(
  Schema.filter((out) =>
    out.type === "a" && Object.keys(out.sections).length === 0
      ? "no sections: say what you found."
      : undefined,
  ),
)

const refuse = (input: unknown): string => {
  const decoded = Schema.decodeUnknownEither(Shape)(input)
  if (decoded._tag === "Right") throw new Error("expected a refusal")
  return refusalReason(decoded.left)
}

describe("refusalReason", () => {
  it("a refinement's own line is the whole reason", () => {
    expect(refuse({ type: "a", sections: {} })).toBe("no sections: say what you found.")
  })

  it("a missing key names its path and nothing of the other members", () => {
    const reason = refuse({ type: "a" })
    expect(reason).toBe("sections: is missing")
    expect(reason).not.toContain("tried")
  })

  it("a wrong value names the leaf under its full path", () => {
    expect(refuse({ type: "a", sections: { Summary: 3 } })).toBe(
      "sections.Summary: Expected string, actual 3",
    )
  })

  it("is guidance rather than the type expansion", () => {
    const decoded = Schema.decodeUnknownEither(Shape)({ type: "a" })
    if (decoded._tag === "Right") throw new Error("expected a refusal")
    expect(decoded.left.message.length).toBeGreaterThan(refusalReason(decoded.left).length * 5)
  })
})
