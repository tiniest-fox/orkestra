// What the CLI writes out for the thing a person is being asked about.

import { describe, expect, it } from "vitest"
import type { StepOutputDto } from "@orkestra/shared/dto/log"
import { show } from "./render.js"

/** The mark that says approving this envelope buys a planning turn. */
const MARK = "(redraws the plan)"

const unplanned = [
  { text: "the footer wants designing", source: "stated", kind: "unplanned_work" },
] as const

describe("show — the requirements a step recorded", () => {
  it("marks unplanned work on an artifact, which is the envelope that routes", () => {
    const out: StepOutputDto = {
      type: "artifact",
      sections: { Summary: "done" },
      requirements: [
        ...unplanned,
        { text: "the admin view is out of scope", source: "assumed", kind: "out_of_scope" },
      ],
    }
    const text = show(out)
    expect(text).toContain(`- ${MARK}  the footer wants designing`)
    // The other four kinds settle something and wake nobody, so they are drawn plain.
    expect(text).toContain("- the admin view is out of scope  (assumed)")
  })

  it("draws no mark on a stuck account, whose requirements route nowhere", () => {
    // The same entry, on the one envelope the engine never asks what it raised: a
    // `stuck` account's requirements land on the intent and the trak stops in front
    // of a person. Reading `kind` alone printed the promise here and it was false.
    const out: StepOutputDto = {
      type: "stuck",
      tried: "two approaches",
      happened: "neither compiled",
      diagnosis: "the types are wrong",
      requirements: [...unplanned],
    }
    const text = show(out)
    expect(text).toContain("- the footer wants designing")
    expect(text).not.toContain(MARK)
  })

  it("says nothing at all when a step recorded nothing", () => {
    expect(show({ type: "artifact", sections: { Summary: "done" } })).not.toContain(
      "Requirements recorded",
    )
  })
})
