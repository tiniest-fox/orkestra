// `artifactText` is the one place an artifact becomes prose, and it exists because
// the trak keeps what the agent returned rather than a flattened copy of it.

import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { amended, Artifact, artifact, artifactText, documentOf } from "./artifact.js"
import { correctionsText } from "./correction.js"
import { requirementsIn } from "./decided.js"
import { Stuck, stuck } from "./stuck.js"

describe("artifactText", () => {
  it("renders declared sections as headed markdown, in declaration order", () => {
    const out = artifactText(artifact({ Summary: "one line", "Implementation map": "| f | c |" }))
    expect(out).toBe("## Summary\n\none line\n\n## Implementation map\n\n| f | c |")
  })

  it("trims each section, so a trailing newline does not widen the gap", () => {
    expect(artifactText(artifact({ Summary: "  padded  \n\n" }))).toBe("## Summary\n\npadded")
  })

  it("is empty rather than undefined when the agent sent no sections at all", () => {
    // Unreachable through StepOutputFor, which refuses an empty document.
    expect(artifactText(artifact({}))).toBe("")
  })

  it("keeps only the document when filing one, so the envelope does not ride along", () => {
    const out = artifact({ Summary: "done" }, undefined, [{ at: "1-build", text: "no §Checks" }])
    expect(documentOf(out)).toEqual({ sections: { Summary: "done" } })
  })
})

describe("amended", () => {
  const standing = documentOf(artifact({ Summary: "v1", Changes: "| a |", Verification: "ran" }))

  it("lays the sections sent over the ones filed and keeps the rest", () => {
    const out = amended(standing, artifact({ Verification: "re-ran" }))
    expect(out.sections).toEqual({ Summary: "v1", Changes: "| a |", Verification: "re-ran" })
  })

  it("keeps the standing order, so an edit does not reorder the document", () => {
    const out = amended(standing, artifact({ Changes: "| b |", Notes: "new" }))
    expect(Object.keys(out.sections)).toEqual(["Summary", "Changes", "Verification", "Notes"])
  })

  it("carries the envelope's own channels unchanged — they describe the reply", () => {
    const edit = artifact({ Summary: "v2" }, undefined, [{ at: "1-plan", text: "no §X" }], "some")
    const out = amended(standing, edit)
    expect(out.corrections).toEqual(edit.corrections)
    expect(out.ambiguity).toBe("some")
    expect(out).not.toHaveProperty("requirements")
  })
})

describe("the requirements an envelope carries", () => {
  const filed = [{ text: "the admin view is out of scope", source: "stated" }] as const

  it("decodes an artifact with no `requirements` key, because most artifacts are that", () => {
    const out = Schema.decodeUnknownSync(Artifact)({ type: "artifact", sections: { S: "x" } })
    expect(out.requirements).toBeUndefined()
  })

  it("leaves the key off rather than filing an empty list, so absence stays absence", () => {
    expect(artifact({ Summary: "done" })).not.toHaveProperty("requirements")
    expect(stuck("one", "two", "three")).not.toHaveProperty("requirements")
  })

  it("carries them on both envelopes, including the `stuck` account nothing files", () => {
    expect(artifact({ Summary: "done" }, filed).requirements).toEqual(filed)
    expect(stuck("one", "two", "three", filed).requirements).toEqual(filed)
  })

  it("drops them when filing the document, which holds sections and nothing else", () => {
    // They describe the conversation rather than the file, so they accumulate on
    // the trak instead — which is what makes them survive a `stuck` account that
    // is never filed at all.
    expect(documentOf(artifact({ Summary: "done" }, filed))).toEqual({
      sections: { Summary: "done" },
    })
  })

  it("keeps them out of the prose, which is the work and not the channel beside it", () => {
    expect(artifactText(artifact({ Summary: "done" }, filed))).toBe("## Summary\n\ndone")
  })

  it("still reads the name the channel had before, on both envelopes", () => {
    // Nothing decodes strictly, so an envelope written under the old name would have
    // the key dropped in silence — and every trak stored so far is one of those.
    const stored = { type: "artifact", sections: { S: "x" }, decisions: [...filed] }
    expect(requirementsIn(Schema.decodeUnknownSync(Artifact)(stored))).toEqual(filed)
    const account = {
      type: "stuck",
      tried: "one",
      happened: "two",
      diagnosis: "three",
      decisions: [...filed],
    }
    expect(requirementsIn(Schema.decodeUnknownSync(Stuck)(account))).toEqual(filed)
  })

  it("reads as nothing when neither name is there, which is most envelopes", () => {
    expect(requirementsIn({})).toEqual([])
  })
})

describe("the documents an artifact says are not good enough to work from", () => {
  const found = [{ at: "1-prototype", text: "the footer is a placeholder" }] as const

  it("decodes an artifact with no `corrections` key, because most artifacts are that", () => {
    const out = Schema.decodeUnknownSync(Artifact)({ type: "artifact", sections: { S: "x" } })
    expect(out.corrections).toBeUndefined()
  })

  it("leaves the key off rather than filing an empty list, so absence stays absence", () => {
    expect(artifact({ Summary: "done" })).not.toHaveProperty("corrections")
  })

  it("refuses an empty list, so there is one way to say nothing and it is silence", () => {
    expect(() =>
      Schema.decodeUnknownSync(Artifact)({
        type: "artifact",
        sections: { S: "x" },
        corrections: [],
      }),
    ).toThrow(/corrections/)
  })

  it("is not on a stuck account, so a step that filed nothing cannot fault someone else's", () => {
    // Excess properties are dropped rather than refused, so what this pins is that
    // the field is absent from the shape. The two envelopes share `requirements` and
    // nothing else, which is what makes this unrepresentable rather than forbidden.
    const out = Schema.decodeUnknownSync(Stuck)({
      type: "stuck",
      tried: "one",
      happened: "two",
      diagnosis: "three",
      corrections: [{ at: "1-build", text: "something is wrong with it" }],
    })
    expect(out).not.toHaveProperty("corrections")
  })

  it("drops it when filing the document, exactly as it drops `requirements`", () => {
    expect(documentOf(artifact({ Summary: "done" }, undefined, found))).toEqual({
      sections: { Summary: "done" },
    })
  })

  it("keeps it out of the prose, which is the work and not the claim beside it", () => {
    expect(artifactText(artifact({ Summary: "done" }, undefined, found))).toBe("## Summary\n\ndone")
  })

  it("renders one bullet per entry, the document it is against first", () => {
    expect(
      correctionsText([
        { at: "2-build", text: "§Verification claims a check that never ran" },
        { at: "1-breakdown", text: "  the offline case is missing  " },
      ]),
    ).toBe(
      "- `2-build` — §Verification claims a check that never ran\n- `1-breakdown` — the offline case is missing",
    )
  })
})
