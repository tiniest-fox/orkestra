import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseAgent, readLayer, resolveAgent } from "./agent-file.js"

/** The agent, or the failure's reason — so no assertion is conditional. */
const parse = (text: string, name = "build"): unknown =>
  Either.match(parseAgent(`agents/${name}.md`, name, text), {
    onLeft: (e) => e.reason,
    onRight: (a) => a,
  })

const FULL = `---
description: Implements a specified change and reports what it did
model: sonnet
permission: write
output:
  What Changed: the change as a reader of the diff would need it explained
  Migration Notes:
    required: false
    when: a migration file was added
    description: anything a deployer has to do by hand
checks:
  - verify
---

Do the thing described and nothing adjacent to it.
`

describe("a complete agent file", () => {
  it("derives every field, and the name from the filename", () => {
    expect(parse(FULL)).toMatchObject({
      name: "build",
      description: "Implements a specified change and reports what it did",
      model: "sonnet",
      permission: "write",
      checks: ["verify"],
      brief: "Do the thing described and nothing adjacent to it.",
    })
  })

  it("reads a string section as a required one, and the long form as written", () => {
    expect(parse(FULL)).toMatchObject({
      sections: [
        {
          title: "What Changed",
          description: "the change as a reader of the diff would need it explained",
          when: undefined,
        },
        {
          title: "Migration Notes",
          description: "anything a deployer has to do by hand",
          when: "a migration file was added",
        },
      ],
    })
  })

  it("refuses an optional section that names no condition", () => {
    const reason = parse(FULL.replace("    when: a migration file was added\n", ""))
    expect(reason).toContain("Migration Notes")
    expect(reason).toContain("`when:`")
  })

  it("refuses a `when:` that is only whitespace, as if it were absent", () => {
    const reason = parse(FULL.replace("when: a migration file was added", 'when: "   "'))
    expect(reason).toContain("Migration Notes")
    expect(reason).toContain("`when:`")
  })

  it("reads a section's `figure:`, and none where it names none", () => {
    const withFigure = FULL.replace(
      "    when: a migration file was added\n",
      "    when: a migration file was added\n    figure: files\n",
    )
    expect(parse(withFigure)).toMatchObject({
      sections: [{ figure: undefined }, { title: "Migration Notes", figure: "files" }],
    })
  })

  it("refuses a `figure:` that is not a figure, naming the file and the section", () => {
    const text = FULL.replace(
      "    when: a migration file was added\n",
      "    when: a migration file was added\n    figure: chart\n",
    )
    const failed = Either.match(parseAgent("agents/build.md", "build", text), {
      onLeft: (e) => `${e.path}: ${e.reason}`,
      onRight: () => "loaded",
    })
    expect(failed).toContain("agents/build.md: ")
    expect(failed).toContain("Migration Notes")
    expect(failed).toContain("`figure: chart`")
  })

  it("refuses a condition on a section that is always owed", () => {
    const reason = parse(FULL.replace("    required: false\n", ""))
    expect(reason).toContain("Migration Notes")
    expect(reason).toContain("required")
  })
})

describe("`effort:` — how hard this role's model thinks", () => {
  it("is absent when the file does not say, which is the model's own default", () => {
    expect(parse(FULL)).toMatchObject({ effort: undefined })
  })

  it("is carried as written — the assembler checks it against the model's CLI", () => {
    expect(parse(FULL.replace("model: sonnet", "model: sonnet\neffort: high"))).toMatchObject({
      effort: "high",
    })
  })
})

describe("`start:` — whether this role can be the first thing that happens", () => {
  it("is false when the file does not say, which is the direction that fails safe", () => {
    expect(parse(FULL)).toMatchObject({ start: false })
  })

  it("is true when the file says so", () => {
    expect(
      parse(FULL.replace("permission: write", "permission: write\nstart: true")),
    ).toMatchObject({ start: true })
  })

  it("takes an explicit false, which is how `resolve` and `unblock` say it out loud", () => {
    expect(
      parse(FULL.replace("permission: write", "permission: write\nstart: false")),
    ).toMatchObject({ start: false })
  })

  it("rejects a value that is not a boolean", () => {
    expect(
      parse(FULL.replace("permission: write", "permission: write\nstart: sometimes")),
    ).toContain("start")
  })
})

describe("`place:` — where a trak this role starts keeps its checkout", () => {
  it("is the sandbox when the file does not say", () => {
    expect(parse(FULL)).toMatchObject({ place: "sandbox" })
  })

  it("is the host when the file asks for it", () => {
    expect(
      parse(FULL.replace("permission: write", "permission: write\nplace: host")),
    ).toMatchObject({ place: "host" })
  })

  it("rejects a place that is neither", () => {
    expect(parse(FULL.replace("permission: write", "permission: write\nplace: laptop"))).toContain(
      "place",
    )
  })
})

describe("sections keep the order they were written in", () => {
  it("is document order, because `output:` is a mapping", () => {
    const out = parse(`---
description: d
model: sonnet
permission: read-only
output:
  Zebra: last
  Alpha: first
---

brief
`)
    expect(out).toMatchObject({ sections: [{ title: "Zebra" }, { title: "Alpha" }] })
  })
})

describe("what the loader rejects", () => {
  const missing = (key: string): string =>
    FULL.split("\n")
      .filter((line) => !line.startsWith(`${key}:`))
      .join("\n")

  it("a missing description", () => {
    expect(parse(missing("description"))).toContain("description")
  })

  it("a missing model", () => {
    expect(parse(missing("model"))).toContain("model")
  })

  it("a missing permission", () => {
    expect(parse(missing("permission"))).toContain("permission")
  })

  it("a permission that is neither of the two values", () => {
    expect(parse(FULL.replace("permission: write", "permission: edit"))).toContain("permission")
  })

  it("an output with no sections", () => {
    const out = parse(`---
description: d
model: sonnet
permission: write
output: {}
---

brief
`)
    expect(out).toContain("no sections")
  })

  it("a frontmatter key that is not one of the six", () => {
    expect(parse(FULL.replace("model: sonnet", "model: sonnet\ntemperature: 0.7"))).toContain(
      "unknown field `temperature:`",
    )
  })

  it("no body — an agent with no brief tells the model nothing", () => {
    expect(
      parse(`---
description: d
model: sonnet
permission: write
output:
  Summary: what happened
---
`),
    ).toContain("no body after the frontmatter")
  })

  it("a name that a proposal could not write back verbatim", () => {
    expect(parse(FULL, "Build Agent")).toContain("lowercase-kebab")
  })
})

/**
 * The same list-of-names shape `checks:` has, and the same registry behind it. What
 * separates the two is when they run and what a non-zero exit means, and neither is
 * anything this parser can see.
 */
describe("`effects:` — the scripts that act once the work is on the branch", () => {
  it("is empty when the file does not say, which is nearly every agent", () => {
    expect(parse(FULL)).toMatchObject({ effects: [] })
  })

  it("takes a list of names, beside `checks:` rather than instead of it", () => {
    expect(
      parse(FULL.replace("checks:\n  - verify", "checks:\n  - verify\neffects:\n  - open-pr")),
    ).toMatchObject({ checks: ["verify"], effects: ["open-pr"] })
  })
})

describe("retired keys name where the thing went", () => {
  const withKey = (line: string) => parse(FULL.replace("model: sonnet", `model: sonnet\n${line}`))

  it("`disallowed_tools` points at permission", () => {
    expect(withKey("disallowed_tools: [Edit]")).toContain("permission: read-only | write")
  })

  it("`sections` points at the output mapping", () => {
    expect(withKey("sections: []")).toContain("keys of `output:`")
  })

  it("`check` names its plural", () => {
    expect(withKey("check: verify")).toContain("`checks:`")
  })

  it("`title` points at description", () => {
    expect(withKey("title: Builder")).toContain("`description:`")
  })
})

/**
 * The third list out of the same registry: asked before a step starts rather than run
 * after it, and the one list whose script may say *never* — none of which this parser
 * can see either.
 */
describe("`conditions:` — the scripts asked before a step starts", () => {
  it("is empty when the file does not say, which is nearly every agent", () => {
    expect(parse(FULL)).toMatchObject({ conditions: [] })
  })

  it("takes a list of names, beside the other two", () => {
    expect(
      parse(FULL.replace("checks:\n  - verify", "checks:\n  - verify\nconditions:\n  - pr-merged")),
    ).toMatchObject({ checks: ["verify"], conditions: ["pr-merged"] })
  })
})

/**
 * A body is a template that may test the flags the engine fills and nothing else, because
 * Mustache renders any other name as nothing — a misspelt flag would drop its guidance
 * on every turn.
 */
describe("the tags a body may use", () => {
  const body = (brief: string): string => FULL.replace(/\n\n[^\n]*\n$/, `\n\n${brief}\n`)

  it("takes a section and an inverted section on `opening`", () => {
    const brief = "Always.\n{{#opening}}\nA chat.\n{{/opening}}\n{{^opening}}\nNot.\n{{/opening}}"
    expect(parse(body(brief))).toMatchObject({ brief })
  })

  it.each([
    ["a misspelt flag", "{{#openng}}x{{/openng}}", "`{{#openng}}`"],
    ["the flag as a variable", "{{opening}}", "`{{opening}}`"],
    ["a partial", "{{> footer}}", "`{{>footer}}`"],
    ["a variable inside a flag", "{{#opening}}{{name}}{{/opening}}", "`{{name}}`"],
  ])("refuses %s, naming the file and the tag", (_, brief, tag) => {
    const out = parse(body(brief))
    expect(out).toContain(tag)
    expect(out).toContain("{{#opening}}")
  })

  it("refuses a body that does not parse", () => {
    expect(parse(body("{{#opening}} never closed"))).toContain("not a template that parses")
  })

  it("names the file whose body runs, when an override supplies it", () => {
    const shipped = Either.getOrThrow(readLayer("shipped/agents/build.md", FULL))
    const project = Either.getOrThrow(
      readLayer("agents/build.md", "---\npermission: read-only\n---\n\n{{openng}}\n"),
    )
    const out = Either.match(resolveAgent("build", [shipped, project]), {
      onLeft: (e) => [e.path, e.reason],
      onRight: () => [],
    })
    expect(out[0]).toBe("agents/build.md")
    expect(out[1]).toContain("`{{openng}}`")
  })
})
