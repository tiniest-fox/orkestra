import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseCheck } from "./check-file.js"

const file = (frontmatter: string, body = "pnpm check\n"): string =>
  `#!/bin/bash\n# ---\n${frontmatter
    .split("\n")
    .map((l) => `# ${l}`)
    .join("\n")}\n# ---\n\n${body}`

/** The parsed check, or the failure's reason — so no assertion is conditional. */
const parse = (text: string, name = "no-secrets"): unknown =>
  Either.match(parseCheck(`checks/${name}.sh`, name, `/repo/.orkestra/checks/${name}.sh`, text), {
    onLeft: (e) => e.reason,
    onRight: (c) => c,
  })

const ok = (frontmatter: string, body?: string): unknown => parse(file(frontmatter, body))

describe("a well-formed check file", () => {
  it("derives the name from the filename and keeps the path it was found at", () => {
    expect(ok("description: Verify no secrets reached the tree.")).toMatchObject({
      name: "no-secrets",
      description: "Verify no secrets reached the tree.",
      path: "/repo/.orkestra/checks/no-secrets.sh",
    })
  })

  it("defaults the timeout, so most checks need only a description", () => {
    expect(ok("description: d")).toMatchObject({ timeoutSeconds: 60 })
  })

  it("reads the on-disk snake_case name, exposes the domain one", () => {
    expect(ok("description: d\ntimeout_seconds: 300")).toMatchObject({ timeoutSeconds: 300 })
  })

  it("folds a multi-line description to one line — the index is line-per-check", () => {
    expect(ok("description: >\n  first line\n  second line")).toMatchObject({
      description: "first line second line",
    })
  })

  it("tolerates a file with no shebang", () => {
    expect(parse("# ---\n# description: d\n# ---\n\npnpm check\n")).toMatchObject({
      description: "d",
    })
  })

  it("treats a bare `#` in the block as the blank line it looks like", () => {
    expect(
      parse("# ---\n# description: d\n#\n# timeout_seconds: 5\n# ---\n\nexit 0\n"),
    ).toMatchObject({ timeoutSeconds: 5 })
  })

  it("leaves a `# ---` inside the script alone", () => {
    expect(ok("description: d", "# ---\n# not frontmatter\n# ---\nexit 0\n")).toMatchObject({
      description: "d",
    })
  })
})

describe("what it refuses", () => {
  it("a script with no frontmatter — the description is what the composer selects on", () => {
    expect(parse("#!/bin/bash\npnpm check\n")).toContain("expected comment frontmatter")
  })

  it("a missing description, naming the field", () => {
    expect(ok("timeout_seconds: 30")).toContain("description")
  })

  it("a timeout that is not a positive number", () => {
    expect(ok("description: d\ntimeout_seconds: 0")).toContain("timeout_seconds")
  })

  it("an empty script — it would pass every time", () => {
    expect(ok("description: d", "   \n\n")).toContain("verifies nothing")
  })

  it("`expect_failure:` — inversion belongs in the script's own exit logic", () => {
    expect(ok("description: d\nexpect_failure: true")).toContain("exit 0 = pass")
  })

  it("`model:` and `disallowed_tools:`, which belong to an agent", () => {
    expect(ok("description: d\nmodel: opus")).toContain("not a turn")
    expect(ok("description: d\ndisallowed_tools: [Edit]")).toContain("what an AGENT may do")
  })

  it("any other unknown field, listing what is allowed", () => {
    const reason = ok("description: d\nretries: 3")
    expect(reason).toContain("unknown field `retries:`")
    expect(reason).toContain("timeout_seconds")
  })

  it("a filename the composer could not write back verbatim", () => {
    expect(parse(file("description: d"), "No Secrets")).toContain("lowercase-kebab")
  })

  it("invalid YAML, without throwing", () => {
    expect(ok('description: "unterminated')).toContain("invalid YAML")
  })
})

/**
 * The interval is parsed on any script and means something on a condition alone —
 * the refusals for a script on the wrong list live in `assemble.ts`, where the lists
 * are known. What this parser holds it to is the floor.
 */
describe("`asked_every_seconds:` — how often a condition is asked", () => {
  it("is absent on an ordinary check", () => {
    expect(ok("description: d")).toMatchObject({ askedEverySeconds: undefined })
  })

  it("reads the on-disk name and exposes the domain one", () => {
    expect(ok("description: d\nasked_every_seconds: 300")).toMatchObject({
      askedEverySeconds: 300,
    })
  })

  it("refuses an interval under a minute, naming the floor", () => {
    expect(ok("description: d\nasked_every_seconds: 30")).toContain("at least 60")
  })
})

describe("`exclusive:` — a check that runs alone", () => {
  it("is off unless the file says so", () => {
    expect(ok("description: d")).toMatchObject({ exclusive: false })
  })

  it("reads `true`", () => {
    expect(ok("description: d\nexclusive: true")).toMatchObject({ exclusive: true })
  })

  it("refuses anything but a boolean", () => {
    expect(ok("description: d\nexclusive: sometimes")).toContain(
      "`exclusive:`, `cache:` and `ignores_linguist_generated:` true or false",
    )
  })
})

describe("`cache:` — whether a pass may be reused", () => {
  it("is on unless the file says otherwise", () => {
    expect(ok("description: d")).toMatchObject({ cache: true })
  })

  it("reads `false`", () => {
    expect(ok("description: d\ncache: false")).toMatchObject({ cache: false })
  })

  it("refuses anything but a boolean", () => {
    expect(ok("description: d\ncache: maybe")).toContain(
      "`cache:` and `ignores_linguist_generated:` true or false",
    )
  })
})

describe("`ignores_linguist_generated:` — whether generated files reach the pass's tree", () => {
  it("is off unless the file says otherwise", () => {
    expect(ok("description: d")).toMatchObject({ ignoresLinguistGenerated: false })
  })

  it("reads `true`", () => {
    expect(ok("description: d\nignores_linguist_generated: true")).toMatchObject({
      ignoresLinguistGenerated: true,
    })
  })

  it("refuses anything but a boolean", () => {
    expect(ok("description: d\nignores_linguist_generated: yes please")).toContain(
      "`ignores_linguist_generated:` true or false",
    )
  })
})

describe("`units:` and `cache_across:` — what a check proves and how far a proof travels", () => {
  it("reports no units, and ties a proof to the OS and architecture, unless told otherwise", () => {
    expect(ok("description: d")).toMatchObject({ units: undefined, cacheAcross: "platform" })
  })

  it("reads a label and `os`", () => {
    expect(ok("description: d\nunits: vitest\ncache_across: os")).toMatchObject({
      units: "vitest",
      cacheAcross: "os",
    })
  })

  it("refuses an empty label and any other breadth", () => {
    expect(ok("description: d\nunits: ''")).toContain("`units:` a label")
    expect(ok("description: d\ncache_across: arch")).toContain("`platform` or `os`")
  })
})

describe("`fingerprint:` — skipping a unit whose recorded inputs are unchanged", () => {
  it("is absent unless declared, and reads the sealed tools, none included", () => {
    expect(ok("description: d\nunits: vitest")).not.toHaveProperty("fingerprint")
    expect(ok("description: d\nunits: vitest\nfingerprint: [git, sh]")).toMatchObject({
      fingerprint: ["git", "sh"],
    })
    expect(ok("description: d\nunits: vitest\nfingerprint: []")).toMatchObject({ fingerprint: [] })
  })

  it("refuses one with no `units:`, and one that is not a list of names", () => {
    expect(ok("description: d\nfingerprint: [git]")).toContain("`fingerprint:` without `units:`")
    expect(ok("description: d\nunits: vitest\nfingerprint: git")).toContain("a list of tool names")
  })
})

describe("`reaches:` — how far a worktree script's work goes", () => {
  it("is absent unless declared, and reads either word", () => {
    expect(ok("description: d")).not.toHaveProperty("reaches")
    expect(ok("description: d\nreaches: local")).toMatchObject({ reaches: "local" })
    expect(ok("description: d\nreaches: external")).toMatchObject({ reaches: "external" })
  })

  it("refuses any other value, naming the file and both words", () => {
    const refused = Either.match(
      parseCheck(
        "worktrees/setup.sh",
        "setup",
        "/r/setup.sh",
        file("description: d\nreaches: cloud"),
      ),
      { onLeft: (e) => e.message, onRight: () => "loaded" },
    )
    expect(refused).toContain("worktrees/setup.sh:")
    expect(refused).toContain("`reaches:` `local` or `external`")
  })
})

describe("`assumes:` — trust is the machine's, not a check's", () => {
  it("refuses the field, naming the file and the field", () => {
    const text = file("description: d\nunits: vitest\nfingerprint: [git]\nassumes: [tmpdir]")
    const refused = Either.match(parseCheck("checks/verify.sh", "verify", "/r/verify.sh", text), {
      onLeft: (e) => e.message,
      onRight: () => "loaded",
    })
    expect(refused).toMatch(/^checks\/verify\.sh: `assumes:` — which assumptions a print/)
  })
})
