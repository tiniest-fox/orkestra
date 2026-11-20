// The output contract is written down twice by necessity: once as a Schema the
// engine decodes with, once as prose the agent reads. These tests keep them
// honest — add a variant and they fail until the template documents it.
//
// Two sets, two templates, because the roles differ: a step may not return a
// proposal and the composer may not return an artifact.

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { Schema, SchemaAST } from "effect"
import { describe, expect, it } from "vitest"
import { Ambiguity } from "./ambiguity.js"
import { AgentComposerOutput, ComposerOutput, MeantAsComposerOutput } from "./composer-output.js"
import { AgentStepOutput, MeantAsStepOutput, StepOutput, StepOutputFor } from "./step-output.js"

const templates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "prompts",
  "templates",
)
const read = (name: string) => readFileSync(join(templates, name), "utf8")

/** Every template, so a shape stated in a file nobody listed here is still checked. */
const everyTemplate = (): readonly string[] =>
  readdirSync(templates, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".md"))

/**
 * The text inside each `"children": [ … ]` in a template, by bracket matching —
 * the examples run over several lines, so a line-wise read would see half of one.
 */
const childArrays = (text: string): readonly string[] => {
  const out: string[] = []
  for (const m of text.matchAll(/"children":\s*\[/g)) {
    const from = m.index + m[0].length
    let depth = 1
    let i = from
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "[") depth++
      else if (text[i] === "]") depth--
    }
    out.push(text.slice(from, i - 1))
  }
  return out
}

/**
 * The objects directly inside one of those arrays — the pieces themselves, not the
 * steps nested in them, which is the distinction the check is about.
 */
const pieces = (childArray: string): readonly string[] => {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < childArray.length; i++) {
    const c = childArray[i]
    if (c === "{" || c === "[") {
      if (depth++ === 0 && c === "{") start = i
    } else if ((c === "}" || c === "]") && --depth === 0 && c === "}") {
      out.push(childArray.slice(start, i + 1))
    }
  }
  return out
}

/**
 * Tags come off the Schema's own AST rather than a list here — a hand-maintained
 * list would need the same update it is meant to force. `type` is the agent-facing
 * discriminator; `_tag` stays internal to the engine.
 */
const tagsOf = (ast: unknown): readonly string[] => [
  ...new Set([...String(ast).matchAll(/type: "(\w+)"/g)].map((m) => m[1] ?? "")),
]

/**
 * The AGENT unions, not the log's. A contract describes what an agent may write,
 * and `message` is the runtime's — offering it would give a first spawn a way to
 * answer instead of working.
 */
const CASES = [
  { role: "step", tags: tagsOf(AgentStepOutput.ast), file: "system/step.md" },
  { role: "composer", tags: tagsOf(AgentComposerOutput.ast), file: "system/composer.md" },
] as const

/**
 * Decoded against the shape a step of this agent owes. Every artifact here carries a
 * rung, because a live turn owes one — the block that tests *that* builds its own.
 */
const decode = (out: unknown, required: readonly string[] = []) =>
  Schema.decodeUnknownEither(StepOutputFor(required, []))(
    typeof out === "object" && out !== null && "type" in out && out.type === "artifact"
      ? { ambiguity: "none", ...out }
      : out,
  )

/** A `stuck` account, which owes four named fields and no sections at all. */
const account = { type: "stuck", tried: "twice", happened: "it hung", diagnosis: "the lock" }

/** The message elicit re-prompts with, which is the part that has to be usable. */
const whyNot = (result: ReturnType<typeof decode>): string =>
  result._tag === "Left" ? result.left.message : ""

describe("StepOutputFor — a permission request", () => {
  it("owes a command and a reason, and no sections or rung", () => {
    const out = { type: "permission", command: "make deploy", reason: "it ships" }
    expect(decode(out, ["Summary"])._tag).toBe("Right")
  })

  it("refuses a blank command, since a yes would allow nothing", () => {
    const result = decode({ type: "permission", command: "  ", reason: "it ships" })
    expect(whyNot(result)).toContain("name the exact command")
  })
})

describe("StepOutputFor — a declared shape is enforced, not hoped for", () => {
  const plan = ["Summary", "Verification"]

  it("accepts sections that cover every required title", () => {
    const out = { type: "artifact", sections: { Summary: "s", Verification: "v" } }
    expect(decode(out, plan)._tag).toBe("Right")
  })

  it("names the missing section, which is what elicit re-prompts with", () => {
    // The exact failure this whole mechanism exists for: a plan arrived without
    // Verification and nothing noticed until a human read it and found it short.
    const result = decode({ type: "artifact", sections: { Summary: "s" } }, plan)
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("missing or empty section(s): Verification")
  })

  it("treats a present-but-blank section as missing", () => {
    const out = { type: "artifact", sections: { Summary: "s", Verification: "   \n" } }
    expect(decode(out, plan)._tag).toBe("Left")
  })

  it("ignores extra sections — a shape is a floor, not a cage", () => {
    const out = { type: "artifact", sections: { Summary: "s", Verification: "v", Notes: "n" } }
    expect(decode(out, plan)._tag).toBe("Right")
  })

  it("refuses prose — there is no `content`, because every agent declares sections", () => {
    expect(decode({ type: "artifact", content: "a wall of text" }, plan)._tag).toBe("Left")
  })

  it("refuses an empty document", () => {
    // Only reachable for an agent whose every section is optional, and it matters
    // because an empty artifact gives the person at the gate nothing to read.
    expect(decode({ type: "artifact", sections: {} })._tag).toBe("Left")
    expect(decode({ type: "artifact", sections: { Notes: "  \n " } })._tag).toBe("Left")
  })
})

describe("StepOutputFor — only an artifact owes sections", () => {
  const plan = ["Verdict", "Findings"]

  it("holds an artifact to the step's declared shape", () => {
    expect(
      decode({ type: "artifact", sections: { Verdict: "no", Findings: "f" } }, plan)._tag,
    ).toBe("Right")
    const missing = decode({ type: "artifact", sections: { Verdict: "no" } }, plan)
    expect(missing._tag).toBe("Left")
    expect(whyNot(missing)).toContain("missing or empty section(s): Findings")
  })

  it("does not hold a `stuck` account to the artifact shape it could not produce", () => {
    // The whole point of the split: an agent that could not do the work owes an
    // account of why, and nothing else.
    expect(decode(account, plan)._tag).toBe("Right")
    expect(decode(account, ["Verdict"])._tag).toBe("Right")
  })

  it("refuses an account that leaves one of its four fields out", () => {
    // The tempting move for a failing agent is to claim less than it knows. Each
    // field is required, so a one-line "it did not work" is re-prompted.
    expect(decode({ type: "stuck", tried: "twice", happened: "it hung" }, plan)._tag).toBe("Left")
  })

  it("refuses an account dressed up as the work, because it has no sections at all", () => {
    // A failing agent reaching for the productive-looking shape has to fill the
    // titles it declared, and a document of "what I tried" cannot.
    const dressed = decode(
      { type: "artifact", sections: { "What I tried": "twice", "What happened": "it hung" } },
      plan,
    )
    expect(dressed._tag).toBe("Left")
    expect(whyNot(dressed)).toContain("missing or empty section(s): Verdict, Findings")
  })

  it("leaves every other output shape alone", () => {
    expect(decode({ type: "artifact", sections: { Summary: "x" } })._tag).toBe("Right")
  })
})

/** What a step two positions in, born of a spawn, can open. */
const visible = ["from-parent/0-discovery", "1-investigate"]

/** Decoded as a turn that can see `keys`, with the rung a live artifact owes. */
const seeing = (out: unknown, keys: readonly string[] = visible) =>
  Schema.decodeUnknownEither(StepOutputFor(["Summary"], keys))(
    typeof out === "object" && out !== null && "type" in out && out.type === "artifact"
      ? { ambiguity: "none", ...out }
      : out,
  )

/** The shape every envelope wrote before `supersedes` was a field: the kind, and one document. */
const legacy = (document: string) => ({
  type: "artifact",
  sections: { Summary: "s" },
  requirements: [{ text: "x", source: "assumed", kind: "supersedes", document }],
})

/** A supersedes against `name`, as an agent writes one. */
const claim = (name: string) => ({
  text: "the parser lives under src/parse",
  source: "assumed",
  kind: "constraint",
  supersedes: [name],
})

describe("StepOutputFor — a supersedes names what the step was shown", () => {
  it("takes one naming a document filed before this step, one inherited, or a requirement's id", () => {
    const own = {
      type: "artifact",
      sections: { Summary: "s" },
      requirements: [claim("1-investigate")],
    }
    expect(seeing(own)._tag).toBe("Right")
    const inherited = {
      type: "artifact",
      sections: { Summary: "s" },
      requirements: [claim("from-parent/0-discovery")],
    }
    expect(seeing(inherited)._tag).toBe("Right")
    const entry = {
      type: "artifact",
      sections: { Summary: "s" },
      requirements: [claim("1-investigate.2")],
    }
    expect(seeing(entry, [...visible, "1-investigate.2"])._tag).toBe("Right")
  })

  it("re-prompts one naming what is not there, listing what is", () => {
    // The failure the field exists to close: the note lands on no file, the fold
    // takes nothing out, and the agent believes it replaced something. A wrong name
    // here reaches nobody, unlike a correction's, which reaches a composer that can
    // see it is wrong.
    const result = seeing({
      type: "artifact",
      sections: { Summary: "s" },
      requirements: [claim("1-investigat")],
    })
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("1-investigat")
    expect(whyNot(result)).toContain("from-parent/0-discovery, 1-investigate")
  })

  it("says so when nothing has been filed yet, rather than listing nothing", () => {
    const result = seeing(
      { type: "artifact", sections: { Summary: "s" }, requirements: [claim("1-investigate")] },
      [],
    )
    expect(whyNot(result)).toContain("nothing to supersede")
  })

  it("holds a stuck account to the same list, since it carries requirements too", () => {
    const result = seeing({ ...account, requirements: [claim("2-build")] })
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("2-build")
    expect(seeing({ ...account, requirements: [claim("1-investigate")] })._tag).toBe("Right")
  })

  it("holds an entry filed under the legacy `decisions` name to the same list", () => {
    // Replay records from `requirementsIn`, which reads either name — so a guard
    // that read `requirements` alone let the alias land with an unreachable key.
    const aliased = (name: string, type: "artifact" | "stuck") =>
      seeing(
        type === "artifact"
          ? { type, sections: { Summary: "s" }, decisions: [claim(name)] }
          : { ...account, decisions: [claim(name)] },
      )
    expect(whyNot(aliased("no-such-doc", "artifact"))).toContain("no-such-doc")
    expect(whyNot(aliased("no-such-doc", "stuck"))).toContain("no-such-doc")
    expect(aliased("1-investigate", "artifact")._tag).toBe("Right")
    expect(aliased("1-investigate", "stuck")._tag).toBe("Right")
  })

  it("holds the legacy kind with its one document to the same list", () => {
    expect(seeing(legacy("1-investigate"))._tag).toBe("Right")
    expect(whyNot(seeing(legacy("no-such-doc")))).toContain("no-such-doc")
  })

  it("refuses the legacy kind naming nothing, which would annotate nothing", () => {
    const result = seeing({
      type: "artifact",
      sections: { Summary: "s" },
      requirements: [{ text: "x", source: "assumed", kind: "supersedes" }],
    })
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("names nothing")
  })

  it("leaves an entry that supersedes nothing alone", () => {
    const out = {
      type: "artifact",
      sections: { Summary: "s" },
      requirements: [{ text: "per key", source: "stated", kind: "constraint" }],
    }
    expect(seeing(out, [])._tag).toBe("Right")
  })
})

describe("StepOutputFor — a chat amending a document that stands", () => {
  const plan = ["Summary", "Verification"]
  // What the document has plus what the agent declares: `Follow-ups` is optional and
  // was left out of the first filing.
  const allowed = [...plan, "Follow-ups"]
  const amend = (out: unknown) =>
    Schema.decodeUnknownEither(StepOutputFor(plan, [], allowed))(
      typeof out === "object" && out !== null ? { ambiguity: "none", ...out } : out,
    )

  it("takes a subset of the sections, because the rest stand as filed", () => {
    // The failure this exists for: "do it" at a gate buying the whole document
    // again, two thirds of it verbatim.
    expect(amend({ type: "artifact", sections: { Verification: "re-ran" } })._tag).toBe("Right")
  })

  it("refuses an envelope that edits nothing — that reply should have been prose", () => {
    const result = amend({ type: "artifact", sections: {} })
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("no sections")
  })

  it("refuses a blank section rather than laying a blank over the one filed", () => {
    const result = amend({ type: "artifact", sections: { Summary: "s", Verification: " " } })
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("empty section(s): Verification")
  })

  it("refuses a title the document does not have, rather than appending it", () => {
    // `findings` beside `Findings`: the stale section is the one that reads as
    // current, and nothing else would fail.
    const result = amend({ type: "artifact", sections: { verification: "re-ran" } })
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("unknown section(s): verification")
    expect(whyNot(result)).toContain("Summary, Verification, Follow-ups")
  })

  it("takes an envelope with no sections when it settles a requirement", () => {
    // The only shape a decision reached in conversation can ride: `Questions`
    // carries none and prose lands nowhere.
    const settled = amend({
      type: "artifact",
      sections: {},
      requirements: [{ text: "per key, not per IP", kind: "constraint", source: "stated" }],
    })
    expect(settled._tag).toBe("Right")
  })

  it("takes an optional section the agent declares and the first filing left out", () => {
    expect(amend({ type: "artifact", sections: { "Follow-ups": "one" } })._tag).toBe("Right")
  })

  it("still owes the rung, which is about the turn and not the document", () => {
    const result = Schema.decodeUnknownEither(StepOutputFor(plan, [], allowed))({
      type: "artifact",
      sections: { Summary: "s" },
    })
    expect(whyNot(result)).toContain(`no "ambiguity"`)
  })

  it("is not what a first turn is decoded against", () => {
    // The relaxation is the chat's alone: a first spawn sending one of two required
    // sections is the failure `StepOutputFor` exists for.
    expect(whyNot(decode({ type: "artifact", sections: { Summary: "s" } }, plan))).toContain(
      "missing or empty section(s): Verification",
    )
  })
})

/** Without `decode`'s default, so one block below can hand in an envelope that omits it. */
const raw = (out: unknown) => Schema.decodeUnknownEither(StepOutputFor(["Summary"], []))(out)

describe("StepOutputFor — the rung a live turn owes", () => {
  it("re-prompts an artifact that left it out, naming every rung", () => {
    const why = whyNot(raw({ type: "artifact", sections: { Summary: "s" } }))
    expect(why).toContain(`no "ambiguity"`)
    for (const rung of Ambiguity.literals) expect(why).toContain(`"${rung}"`)
  })

  it("takes each rung the schema defines", () => {
    for (const rung of Ambiguity.literals) {
      expect(raw({ type: "artifact", sections: { Summary: "s" }, ambiguity: rung })._tag).toBe(
        "Right",
      )
    }
  })

  it("refuses a word nobody defined rather than dropping it", () => {
    // Dropped, it would reach the gate as absent — which reads as the lowest rung, so a
    // typo would buy exactly the passage the turn was trying to spend.
    const why = whyNot(raw({ type: "artifact", sections: { Summary: "s" }, ambiguity: "lots" }))
    expect(why).toContain("ambiguity")
  })

  it("asks it of neither other envelope, because both stop for a person anyway", () => {
    // A rung on a `stuck` account or a set of questions would be a field with no gate
    // to bear on — and one more thing for a turn that could not do the work to get
    // wrong on its way out.
    expect(raw(account)._tag).toBe("Right")
    expect(
      raw({ type: "questions", questions: [{ question: "which flag?", options: [] }] })._tag,
    ).toBe("Right")
  })

  it("says the sections are missing before it asks about the rung", () => {
    // One reason comes back, so the order decides which. A document short of a section
    // has a more useful thing to be told first.
    expect(whyNot(raw({ type: "artifact", sections: {} }))).toContain("missing or empty")
  })
})

describe("a question's recommended option", () => {
  const ask = (options: readonly Record<string, unknown>[]) =>
    raw({ type: "questions", questions: [{ question: "which flag?", options }] })

  it("takes one mark, or none, or an explicit false", () => {
    // `false` is what an agent writing by hand puts for *not this one*; refusing it
    // would spend a paid retry on a slip that meant nothing.
    expect(ask([{ label: "a", recommended: true }, { label: "b" }])._tag).toBe("Right")
    expect(ask([{ label: "a" }, { label: "b" }])._tag).toBe("Right")
    expect(
      ask([
        { label: "a", recommended: false },
        { label: "b", recommended: true },
      ])._tag,
    ).toBe("Right")
  })

  it("refuses two marks on one question, saying what to do instead", () => {
    // Decode time is where `elicit` can still re-prompt; the message is what it sends.
    const result = ask([
      { label: "a", recommended: true },
      { label: "b", recommended: true },
    ])
    expect(result._tag).toBe("Left")
    expect(whyNot(result)).toContain("At most one option per question may be recommended")
  })
})

describe("output contracts match the prompts that describe them", () => {
  it("finds the variants on each schema", () => {
    expect(tagsOf(AgentStepOutput.ast)).toEqual(["artifact", "stuck", "questions", "permission"])
    // `spawn` and `compose` are not members of this union — they are tags on plan
    // entries, nested inside a proposal. They are here because the check below is
    // what makes the composer's template describe every shape it may write, and a
    // shape it is never shown is one it never proposes. `agent` is absent for the
    // reason it is optional: `type?: "agent"` does not render as a tag at all.
    expect(tagsOf(AgentComposerOutput.ast)).toEqual([
      "proposal",
      "spawn",
      "compose",
      "questions",
      "failed",
      "finished",
    ])
  })

  it("keeps `message` out of what an agent may write, and in what the log carries", () => {
    // The split is the guarantee: `elicit` decodes against the agent union, so a
    // first spawn cannot answer its way out of producing an artifact. The wider
    // union exists because the persisted Event has to replay a reply.
    expect(tagsOf(StepOutput.ast)).toContain("message")
    expect(tagsOf(ComposerOutput.ast)).toContain("message")
    expect(decode({ type: "message", text: "because it needs the plan first" })._tag).toBe("Left")
  })

  it("keeps `failed` out of what a STEP may write, and in what the log carries", () => {
    // Nothing an agent judges ends a trak: an agent that cannot proceed returns
    // `stuck`, which stops for a person. `orGiveUp` still writes this one, for an
    // `elicit` that got nothing usable, a different claim by a different party.
    expect(tagsOf(AgentStepOutput.ast)).not.toContain("failed")
    expect(tagsOf(StepOutput.ast)).toContain("failed")
    expect(decode({ type: "failed", error: "I could not do it" })._tag).toBe("Left")
  })

  it("keeps `finished` to the composer, in both unions", () => {
    // The composer is the only thing that may say a trak is over, and `decide` reads
    // this answer as the plan having run out. A step returning it would end a trak on
    // the judgment of the agent doing the work — which is what `stuck` exists to avoid.
    expect(tagsOf(StepOutput.ast)).not.toContain("finished")
    expect(decode({ type: "finished", reason: "there was nothing to do" })._tag).toBe("Left")
  })

  it.each(CASES)("documents every $role variant in $file", ({ tags, file }) => {
    // questions-shape and permission-shape are partials, so read them too
    const text = read(file) + read("system/questions-shape.md") + read("system/permission-shape.md")
    expect(tags.filter((t) => !text.includes(`"${t}"`))).toEqual([])
  })

  it("names every ambiguity rung in the block that asks both roles for one", () => {
    // The rungs are a closed set an agent writes back verbatim, so the two halves
    // fail in opposite directions: a rung the prompt never names is one nothing will
    // ever write, and a word the prompt offers that the schema does not hold is a
    // decode failure and a re-prompt. Off the schema for the reason `tagsOf` is — a
    // list here would need the update it exists to force.
    const text = read("system/ambiguity.md")
    expect(Ambiguity.literals.filter((rung) => !text.includes(`"${rung}"`))).toEqual([])
  })

  it("states a spawn's piece as a list of steps, in every template that states it at all", () => {
    // `Child`'s bare {agent, instruction} arm is decode-only, for logs already on
    // disk — not a shape the composer is offered. Both halves of its prompt reach the
    // model in one turn, so one half still teaching the pair is a pair it may write,
    // and the union would take it silently: every piece one step, forever.
    const stated = everyTemplate().flatMap((f) => childArrays(read(f)).flatMap(pieces))
    expect(stated.length).toBeGreaterThan(0)
    for (const piece of stated) expect(piece).toMatch(/^\{\s*"steps"/)
  })

  it("never offers a role a shape it has no business returning", () => {
    const step = read("system/step.md")
    expect(step).not.toContain('"proposal"')
    expect(step).not.toContain('"finished"')
    const composer = read("system/composer.md")
    expect(composer).not.toContain('"artifact"')
    expect(composer).not.toContain('"stuck"')
  })

  it("uses `type` on the wire, never `_tag`", () => {
    // _tag is Effect's internal discriminator; asking a model for a leading
    // underscore is asking it to be unusual for our convenience.
    for (const file of [
      "system/step.md",
      "system/composer.md",
      "system/contract.md",
      "system/questions-shape.md",
    ]) {
      expect(read(file)).not.toContain("_tag")
    }
  })
})

/** The `type` literal of every member of a union, in the order they are declared. */
const discriminators = (
  members: readonly { readonly ast: SchemaAST.AST }[],
): readonly (string | undefined)[] =>
  members.map((member) => {
    const tag = SchemaAST.getPropertySignatures(member.ast).find((p) => p.name === "type")?.type
    return tag !== undefined && SchemaAST.isLiteral(tag) ? String(tag.literal) : undefined
  })

// Both loose shapes are held to their own union, so a shape added to either cannot
// be left out of the discriminator silently — `converse` would then take that
// shape's refusal as an answer and never re-prompt it. Both roles are here because
// both call `converse`: the step on a chat, the composer at the plan gate. The two
// negatives are a config block a reply happened to end with, and the one shape the
// runtime constructs rather than the agent writing it.
describe("was this JSON written as one of the role's shapes?", () => {
  it("takes the discriminator of every member of the step's union, and nothing else", () => {
    const meant = Schema.is(MeantAsStepOutput)
    for (const type of discriminators(AgentStepOutput.members)) {
      expect(meant({ type })).toBe(true)
    }
    expect(meant({ port: 3000 })).toBe(false)
    expect(meant({ type: "message" })).toBe(false)
  })

  it("takes the discriminator of every member of the composer's union, and nothing else", () => {
    const meant = Schema.is(MeantAsComposerOutput)
    for (const type of discriminators(AgentComposerOutput.members)) {
      expect(meant({ type })).toBe(true)
    }
    expect(meant({ port: 3000 })).toBe(false)
    expect(meant({ type: "message" })).toBe(false)
  })
})
