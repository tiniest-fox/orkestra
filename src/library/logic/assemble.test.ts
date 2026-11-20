import { Either } from "effect"
import { describe, expect, it } from "vitest"
import {
  type AgentFiles,
  assembleLibrary,
  checkoutProcesses,
  type LibrarySource,
  type ScriptSource,
} from "./assemble.js"

const agent = (description: string, over = ""): string =>
  `---
description: ${description}
model: sonnet
permission: write
output:
  Summary: what happened${over}
---

brief for ${description}
`

const script = (name: string): ScriptSource => ({
  shown: `checks/${name}.sh`,
  path: `/tmp/${name}.sh`,
  text: `# ---\n# description: runs ${name}\n# ---\n\nexit 0\n`,
})

/** Agent files as the loader hands them over: keyed by name, each knowing its path. */
const files = (
  entries: readonly (readonly [string, string])[],
  dir = "",
): ReadonlyMap<string, AgentFiles> =>
  new Map(
    entries.map(([name, text]) => [
      name,
      { shipped: undefined, repo: [{ shown: `${dir}agents/${name}.md`, text }] },
    ]),
  )

/** One agent, so the not-empty rule is satisfied by every source that isn't testing it. */
const ONE = files([["build", agent("implements things")]])

/**
 * Stands in for `src/library/shipped/generic.md`, whose own contents are the filesystem
 * tier's business. **It names no `model:`**, which is the whole of what separates a
 * shipped file from a project's and what these tests are about.
 */
const SHIPPED = `---
description: does the one thing it was asked
permission: write
output:
  What happened: the answer, or what changed
---

do what the sentence asks and stop.
`

const source = (over: Partial<LibrarySource> = {}): LibrarySource => ({
  agents: ONE,
  checks: new Map(),
  processes: new Map(),
  tools: new Map(),
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
  root: "/repo",
  generic: SHIPPED,
  skills: new Map(),
  shippedChecks: [],
  fleet: undefined,
  models: undefined,
  mcp: undefined,
  localModels: undefined,
  composition: undefined,
  goals: undefined,
  guidance: undefined,
  ...over,
})

/** The library, or the failure as `path: reason` — so no assertion is conditional. */
const load = (over: Partial<LibrarySource> = {}): unknown =>
  Either.match(assembleLibrary(source(over)), {
    onLeft: (e) => `${e.path}: ${e.reason}`,
    onRight: ({ library }) => library,
  })

describe("a minimal .orkestra directory", () => {
  it("loads with one agent and nothing else — every other registry is optional", () => {
    expect(load()).toMatchObject({
      checks: new Map(),
      setup: undefined,
      teardown: undefined,
      env: undefined,
      composition: "",
      goals: "",
    })
  })

  it("defaults the model registry rather than requiring models.yaml", () => {
    expect(load()).toMatchObject({ models: { composer: "sonnet" } })
  })
})

describe("mcp.yaml", () => {
  it("never fails a load: a file that is not YAML loads, carrying the line that says so", () => {
    expect(load({ mcp: "servers: [unclosed\n" })).toMatchObject({
      mcp: { servers: [], problems: [expect.stringContaining("invalid YAML")] },
    })
  })

  it("is read as the servers it declares", () => {
    expect(load({ mcp: "servers:\n  s:\n    command: srv\n" })).toMatchObject({
      mcp: { servers: [{ _tag: "Stdio", name: "s", command: "srv" }], problems: [] },
    })
  })
})

describe("the agents directory is the one that may not be empty", () => {
  it("refuses a project with no agents — a plan entry names one, so there is nothing to propose", () => {
    const reason = load({ agents: new Map() })
    expect(reason).toContain("agents/:")
    expect(reason).toContain("no agents")
  })

  it("blames the directory, not a file — there is no file to name", () => {
    // Every other load failure carries the path of the definition that broke.
    // This one is about an absence, so the path is the directory itself.
    expect(
      Either.match(assembleLibrary(source({ agents: new Map() })), {
        onLeft: (e) => e.path,
        onRight: () => "unexpectedly loaded",
      }),
    ).toBe("agents/")
  })
})

describe("agents", () => {
  const two = files([
    ["zebra", agent("last alphabetically")],
    ["alpha", agent("first alphabetically")],
  ])

  it("indexes them by name", () => {
    expect(load({ agents: two })).toMatchObject({
      agents: new Map([
        ["alpha", { name: "alpha", description: "first alphabetically" }],
        ["zebra", { name: "zebra", description: "last alphabetically" }],
      ]),
    })
  })

  it("orders them by name, not by however the directory was listed", () => {
    // The map's order is the order the composer reads the index in.
    const lib = assembleLibrary(source({ agents: two }))
    expect(Either.map(lib, (l) => [...l.library.agents.keys()])).toEqual(
      Either.right(["alpha", "zebra"]),
    )
  })

  it("reports which file failed, not just that something did", () => {
    // Opens with `---`, so it is claiming to be ours and its missing `model:` is fatal.
    const broken = "---\ndescription: half a brief\n---\n\nbrief\n"
    expect(load({ agents: files([["broken", broken]]) })).toContain("agents/broken.md:")
  })
})

/**
 * A migrating project has both fleets in one `agents/` directory: this engine's files,
 * and another engine's briefs, which are plain markdown with no header. Reading the
 * second kind is what would stop this one from starting at all.
 */
describe("a file with no `---` header belongs to another engine", () => {
  const OLD = "# Reviewer\n\nRead the diff and say what is wrong with it.\n"

  it("passes it over instead of failing the whole library", () => {
    const both = files([
      ["build", agent("implements things")],
      ["old", OLD],
    ])
    expect(load({ agents: both })).toMatchObject({
      agents: new Map([["build", { name: "build" }]]),
    })
  })

  it("still fails on a file that has a header and a mistake in it", () => {
    const typo = agent("builds").replace("permission: write", "permision: write")
    expect(load({ agents: files([["build", typo]]) })).toContain("unknown field `permision:`")
  })

  it("says the files were passed over rather than that the directory is empty", () => {
    const reason = load({
      agents: files([
        ["old", OLD],
        ["older", OLD],
      ]),
    })
    expect(reason).toContain("agents/:")
    expect(reason).toContain("All 2 file(s)")
    expect(reason).not.toContain("put a `*.md` brief in this directory")
  })
})

describe("the agent the engine ships", () => {
  it("is beside the fleet rather than in it, so nothing that reads the fleet sees it", () => {
    // The composer's index and the set that validates a proposed plan are both built
    // from `agents` — this is what keeps a role-less write agent off every plan.
    expect(load()).toMatchObject({
      agents: new Map([["build", { name: "build" }]]),
      generic: { name: "generic", permission: "write", start: false, checks: [], effects: [] },
    })
  })

  it("runs on whatever this project calls `default:`, because it may not name a model", () => {
    const on = (models: string | undefined): unknown =>
      Either.match(assembleLibrary(source({ models })), {
        onLeft: (e) => e.reason,
        onRight: ({ library }) => library.generic.model,
      })
    // Both registries list `sonnet` too, because the project's own agent names it.
    expect(on("default: haiku\nmodels: {claude: [{name: sonnet}, {name: haiku}]}")).toBe("haiku")
    expect(on("default: opus\nmodels: {claude: [{name: opus}, {name: sonnet}]}")).toBe("opus")
    // And the same answer a project with no `models.yaml` gets for its composer.
    expect(on(undefined)).toBe("sonnet")
  })

  it("refuses a shipped file that names a model, an effort, a check, a condition or an unshipped effect", () => {
    // Each resolves against the project's `.orkestra/`, which the engine cannot know —
    // so this is the boundary rule stated as a load failure rather than trusted.
    const named = (key: string): unknown =>
      load({ generic: SHIPPED.replace("permission: write", `${key}\npermission: write`) })
    // And it blames the file a person can actually open, which is not in the project.
    expect(named("model: opus")).toContain("shipped/generic.md:")
    expect(named("model: opus")).toContain("names no `model:`")
    expect(named("effort: high")).toContain("names no `effort:`")
    expect(named("checks:\n  - verify")).toContain("names no `checks:`")
    expect(named("effects:\n  - open-pr")).toContain("which Orkestra does not ship")
    expect(named("conditions:\n  - pr-merged")).toContain("names no `conditions:`")
    expect(named("processes:\n  - dev")).toContain("names no `processes:`")
  })

  it("refuses a project agent of the same name rather than shadowing one of them", () => {
    const reason = load({ agents: files([["generic", agent("something a project wrote")]]) })
    expect(reason).toContain("agents/generic.md:")
    expect(reason).toContain("is the agent Orkestra itself ships")
  })

  it("refuses it under `.local/` too, and blames that file", () => {
    // The overlay changes who can see a file, not whose name it is.
    const reason = load({ agents: files([["generic", agent("something I wrote")]], ".local/") })
    expect(reason).toContain(".local/agents/generic.md:")
    expect(reason).toContain("is the agent Orkestra itself ships")
  })

  /**
   * **The order of the two rules above, which is the only thing pinning it.** The reserved
   * name is refused *below* the header check, so another engine's headerless `generic.md`
   * is passed over like any other of its briefs and never becomes an agent to clash with.
   * Hoisting the refusal would stop a migrating project from starting at all over a file
   * this engine never reads — and nothing else in this suite tells the two orders apart.
   */
  it("passes over a headerless `generic.md` rather than refusing the reserved name", () => {
    const theirs = files([
      ["build", agent("implements things")],
      ["generic", "# Generic\n\nAnother engine's brief, with no header.\n"],
    ])
    expect(load({ agents: theirs })).toMatchObject({
      agents: new Map([["build", { name: "build" }]]),
      generic: { name: "generic", permission: "write" },
    })
  })
})

describe("models.yaml", () => {
  const models = (text: string) => load({ models: text })

  it("reads `default` and `models` grouped by CLI, keeping a Claude name bare", () => {
    expect(
      models("default: sonnet\nmodels: {claude: [{name: opus}, {name: sonnet}, {name: haiku}]}"),
    ).toMatchObject({
      models: { composer: "sonnet", allowed: ["opus", "sonnet", "haiku"], efforts: new Map() },
    })
  })

  it("qualifies a model under any other CLI with that CLI's name, as a plan entry spells it", () => {
    expect(
      models("default: sonnet\nmodels: {claude: [{name: sonnet}], codex: [{name: gpt-5.6-sol}]}"),
    ).toMatchObject({ models: { allowed: ["sonnet", "codex/gpt-5.6-sol"] } })
  })

  it("carries each entry's effort by the model's name, and none where none was declared", () => {
    expect(
      models(
        "default: sonnet\nmodels: {claude: [{name: opus, effort: high}, {name: sonnet}], codex: [{name: gpt-5.6-sol, effort: persistent}]}",
      ),
    ).toMatchObject({
      models: {
        efforts: new Map([
          ["opus", "high"],
          ["codex/gpt-5.6-sol", "persistent"],
        ]),
      },
    })
  })

  it("refuses an effort the CLI does not take, naming the file and the levels it does", () => {
    // Per CLI and never per model: Codex knows `persistent`, Claude does not, and the
    // levels one Codex model supports are in a catalog the engine cannot read.
    const reason = models("default: opus\nmodels: {claude: [{name: opus, effort: persistent}]}")
    expect(reason).toContain("models.yaml:")
    expect(reason).toContain("`effort: persistent` on `opus` is not a level `claude` accepts")
    expect(reason).toContain("low, medium, high, xhigh, max")
    expect(
      models(
        "default: sonnet\nmodels: {claude: [{name: sonnet}], codex: [{name: gpt, effort: persistent}]}",
      ),
    ).toMatchObject({ models: { efforts: new Map([["codex/gpt", "persistent"]]) } })
  })

  it("refuses `ranked:` outright, and says what to write instead", () => {
    // Read as an alias, every project would load with every effort silently absent.
    const reason = models("default: sonnet\nranked: [opus, sonnet]")
    expect(reason).toContain("models.yaml:")
    expect(reason).toContain("`ranked:` is no longer read")
    expect(reason).toContain("`models:` grouped by CLI")
  })

  it("refuses a group naming a CLI this build does not spawn", () => {
    const reason = models("default: opus\nmodels: {claude: [{name: opus}], opencode: [{name: x}]}")
    expect(reason).toContain("`opencode:`, which is not a CLI this build spawns (claude, codex)")
  })

  it("refuses a name carrying a qualifier of its own — the group already says the CLI", () => {
    expect(models("default: opus\nmodels: {claude: [{name: codex/opus}]}")).toContain(
      "`name: codex/opus` under `claude:`",
    )
  })

  it("refuses a default that is not in the list", () => {
    expect(models("default: gpt-5\nmodels: {claude: [{name: opus}, {name: sonnet}]}")).toContain(
      "`default: gpt-5` is not in `models:`",
    )
  })

  it("refuses an empty group", () => {
    expect(models("default: sonnet\nmodels: {claude: []}")).toContain("models.yaml:")
  })

  it("refuses a missing default", () => {
    expect(models("models: {claude: [{name: opus}]}")).toContain("default")
  })

  it("reads `context_windows` by model, and states none where the file states none", () => {
    const listed = "default: sonnet\nmodels: {claude: [{name: opus}, {name: sonnet}]}"
    expect(models(`${listed}\ncontext_windows:\n  opus: 1000000`)).toMatchObject({
      models: { windows: { opus: 1_000_000 } },
    })
    expect(models(listed)).toMatchObject({ models: { windows: {} } })
  })

  it("keys a window by the qualified name, as `models:` lists it and an agent writes it", () => {
    expect(
      models(
        "default: sonnet\nmodels: {claude: [{name: sonnet}], codex: [{name: gpt-5.6-sol}]}\ncontext_windows:\n  codex/gpt-5.6-sol: 258400",
      ),
    ).toMatchObject({ models: { windows: { "codex/gpt-5.6-sol": 258_400 } } })
  })

  it("refuses a window for a model the list does not name — the same typo as an agent's", () => {
    const reason = models(
      "default: sonnet\nmodels: {claude: [{name: opus}, {name: sonnet}]}\ncontext_windows:\n  opuss: 1",
    )
    expect(reason).toContain("models.yaml:")
    expect(reason).toContain("`context_windows:` names `opuss`")
  })
})

describe("an agent's model must be one this project lists", () => {
  const withModel = (model: string) =>
    load({
      models: "default: haiku\nmodels: {claude: [{name: opus}, {name: sonnet}, {name: haiku}]}",
      agents: files([["deep", agent("thinks hard").replace("model: sonnet", `model: ${model}`)]]),
    })

  it("accepts a listed model", () => {
    expect(withModel("opus")).toMatchObject({ agents: new Map([["deep", { model: "opus" }]]) })
  })

  it("refuses an unlisted one at load, not mid-trak at the provider", () => {
    const reason = withModel("opuss")
    expect(reason).toContain("agents/deep.md:")
    expect(reason).toContain("`model: opuss` is not in models.yaml")
  })

  it("names the file as it was found — a local one is not the team's of the same name", () => {
    const typo = agent("thinks hard").replace("model: sonnet", "model: opuss")
    expect(load({ agents: files([["deep", typo]], ".local/") })).toContain(".local/agents/deep.md:")
  })
})

describe("an agent's effort must be a level its model's CLI takes", () => {
  const withEffort = (model: string, effort: string) =>
    load({
      models:
        "default: haiku\nmodels: {claude: [{name: sonnet}, {name: haiku}], codex: [{name: gpt}]}",
      agents: files([
        [
          "deep",
          agent("thinks hard").replace("model: sonnet", `model: ${model}\neffort: ${effort}`),
        ],
      ]),
    })

  it("accepts one the CLI takes, and carries it on the agent", () => {
    expect(withEffort("sonnet", "max")).toMatchObject({
      agents: new Map([["deep", { model: "sonnet", effort: "max" }]]),
    })
    expect(withEffort("codex/gpt", "persistent")).toMatchObject({
      agents: new Map([["deep", { effort: "persistent" }]]),
    })
  })

  it("refuses one the CLI does not, naming the file and the levels — the CLI itself never will", () => {
    // `claude --effort persistent` warns on stderr and runs at exit 0, so this is the
    // only place the typo can be caught.
    const reason = withEffort("sonnet", "persistent")
    expect(reason).toContain("agents/deep.md:")
    expect(reason).toContain("`effort: persistent` is not a level `claude` accepts")
    expect(reason).toContain("low, medium, high, xhigh, max")
  })

  it("checks against the CLI of the agent's own model, not the bare group's", () => {
    expect(withEffort("codex/gpt", "bogus")).toContain(
      "`effort: bogus` is not a level `codex` accepts (none, minimal, low, medium, high, xhigh, max, ultra, persistent)",
    )
  })

  it("loads without a models.yaml too, against the bare CLI's levels", () => {
    const deep = agent("thinks hard").replace("model: sonnet", "model: sonnet\neffort: xhigh")
    expect(load({ agents: files([["deep", deep]]) })).toMatchObject({
      agents: new Map([["deep", { effort: "xhigh" }]]),
    })
  })
})

describe(".local/models.yaml", () => {
  const merged = (team: string | undefined, local: string): unknown =>
    Either.match(assembleLibrary(source({ models: team, localModels: local })), {
      onLeft: (e) => `${e.path}: ${e.reason}`,
      onRight: ({ library }) => library.models,
    })
  const TEAM = "default: sonnet\nmodels: {claude: [{name: opus, effort: high}, {name: sonnet}]}"

  it("adds its entries to the team's rather than replacing them", () => {
    // A project agent naming a team model has to keep loading with the overlay in place.
    expect(merged(TEAM, "models: {claude: [{name: haiku}]}")).toEqual({
      allowed: ["opus", "sonnet", "haiku"],
      efforts: new Map([["opus", "high"]]),
      composer: "sonnet",
      windows: {},
    })
  })

  it("replaces a team entry it names, which is how one person runs a team model at another effort", () => {
    expect(
      merged(TEAM, "models: {claude: [{name: opus, effort: low}, {name: sonnet, effort: max}]}"),
    ).toEqual({
      allowed: ["opus", "sonnet"],
      efforts: new Map([
        ["opus", "low"],
        ["sonnet", "max"],
      ]),
      composer: "sonnet",
      windows: {},
    })
    // And naming it with no effort takes the team's away rather than keeping it.
    expect(merged(TEAM, "models: {claude: [{name: opus}]}")).toMatchObject({ efforts: new Map() })
  })

  it("overrides `default:` when it names one", () => {
    expect(merged(TEAM, "default: opus")).toMatchObject({
      allowed: ["opus", "sonnet"],
      composer: "opus",
      windows: {},
    })
  })

  it("may do both at once, and a local default may be a model only it lists", () => {
    expect(merged(TEAM, "default: haiku\nmodels: {claude: [{name: haiku}]}")).toMatchObject({
      allowed: ["opus", "sonnet", "haiku"],
      composer: "haiku",
    })
  })

  it("merges over the defaults when the team has no models.yaml", () => {
    expect(merged(undefined, "default: haiku")).toEqual({
      allowed: ["opus", "sonnet", "haiku"],
      efforts: new Map(),
      composer: "haiku",
      windows: {},
    })
  })

  it("lays its `context_windows` over the team's, model by model", () => {
    // Model by model rather than entry by entry, which is what keeps a local file
    // switching one model's effort from dropping the window beside it — `opus` here
    // is named in the local `models:` and keeps the team's window.
    expect(
      merged(
        `${TEAM}\ncontext_windows:\n  opus: 1000000\n  sonnet: 1000000`,
        "models: {claude: [{name: opus, effort: low}, {name: haiku}]}\ncontext_windows:\n  haiku: 200000\n  sonnet: 500000",
      ),
    ).toEqual({
      allowed: ["opus", "sonnet", "haiku"],
      efforts: new Map([["opus", "low"]]),
      composer: "sonnet",
      windows: { opus: 1_000_000, sonnet: 500_000, haiku: 200_000 },
    })
  })

  it("refuses a local default that neither file lists, and blames the local file", () => {
    const reason = merged(TEAM, "default: gpt-5")
    expect(reason).toContain(".local/models.yaml:")
    expect(reason).toContain("`default: gpt-5` is not in `models:`")
  })

  it("refuses `ranked:`, a bad effort and an unknown CLI here too, blaming the local file", () => {
    expect(merged(TEAM, "ranked: [haiku]")).toContain(
      ".local/models.yaml: `ranked:` is no longer read",
    )
    expect(merged(TEAM, "models: {claude: [{name: haiku, effort: ultra}]}")).toContain(
      ".local/models.yaml: `effort: ultra` on `haiku`",
    )
    expect(merged(TEAM, "models: {opencode: [{name: x}]}")).toContain(".local/models.yaml:")
  })

  it("refuses an empty local group", () => {
    expect(merged(TEAM, "models: {claude: []}")).toContain(".local/models.yaml:")
  })
})

describe("an agent's checks must exist", () => {
  const withCheck = (name: string, checks: ReadonlyMap<string, ScriptSource>) =>
    load({ agents: files([["build", agent("builds", `\nchecks:\n  - ${name}`)]]), checks })

  it("accepts a check the project declares", () => {
    expect(withCheck("verify", new Map([["verify", script("verify")]]))).toMatchObject({
      agents: new Map([["build", { checks: ["verify"] }]]),
    })
  })

  it("refuses an invented one at load — it is a human's typo, not a composer's", () => {
    const reason = withCheck("verifyy", new Map([["verify", script("verify")]]))
    expect(reason).toContain("agents/build.md:")
    expect(reason).toContain("unknown `checks:` entr(ies): verifyy")
    expect(reason).toContain("Available: verify")
  })

  it("says the project declares none rather than listing an empty set", () => {
    expect(withCheck("verify", new Map())).toContain("this project declares none")
  })
})

/**
 * One registry backs both lists, so the *rule* is the same and the message is not: an
 * author who typed the wrong name has to be told which of their two lists it is in.
 */
describe("an agent's effects must exist", () => {
  const withEffect = (name: string, checks: ReadonlyMap<string, ScriptSource>) =>
    load({ agents: files([["build", agent("builds", `\neffects:\n  - ${name}`)]]), checks })

  it("accepts one the project declares, from the same registry checks come from", () => {
    expect(withEffect("open-pr", new Map([["open-pr", script("open-pr")]]))).toMatchObject({
      agents: new Map([["build", { effects: ["open-pr"] }]]),
    })
  })

  it("refuses an invented one at load, and names the list it was in", () => {
    const reason = withEffect("open-prr", new Map([["open-pr", script("open-pr")]]))
    expect(reason).toContain("agents/build.md:")
    expect(reason).toContain("unknown `effects:` entr(ies): open-prr")
    expect(reason).toContain("Available: open-pr")
  })
})

describe("prose policy", () => {
  it("carries COMPOSITION.md and ORKESTRA.md through verbatim", () => {
    expect(load({ composition: "Always review.", guidance: "Run pnpm verify." })).toMatchObject({
      composition: "Always review.",
      guidance: "Run pnpm verify.",
    })
  })

  it("trims the trailing newline every file has, which the template adds again", () => {
    expect(
      load({ composition: "Always review.\n", guidance: "# Guidance\n\nBe terse.\n" }),
    ).toMatchObject({ composition: "Always review.", guidance: "# Guidance\n\nBe terse." })
  })
})

/** A script with the interval a condition needs. */
const condition = (name: string, seconds = 300): ScriptSource => ({
  shown: `checks/${name}.sh`,
  path: `/tmp/${name}.sh`,
  text: `# ---\n# description: asks ${name}\n# asked_every_seconds: ${String(seconds)}\n# ---\n\nexit 1\n`,
})

describe("the names the engine answers itself", () => {
  it("refuses a script called `wait_until` — the composer writes that time on the step", () => {
    const reason = load({ checks: new Map([["wait_until", condition("wait_until")]]) })
    expect(reason).toContain("checks/wait_until.sh")
    expect(reason).toContain("a script cannot take the name")
  })
})

describe("an agent's conditions must exist", () => {
  const withCondition = (name: string, checks: ReadonlyMap<string, ScriptSource>) =>
    load({ agents: files([["asana", agent("posts", `\nconditions:\n  - ${name}`)]]), checks })

  it("accepts one the project declares, from the registry the other two lists use", () => {
    expect(
      withCondition("pr-merged", new Map([["pr-merged", condition("pr-merged")]])),
    ).toMatchObject({ agents: new Map([["asana", { conditions: ["pr-merged"] }]]) })
  })

  it("refuses an invented one at load, and names the list it was in", () => {
    const reason = withCondition("pr-mergd", new Map([["pr-merged", condition("pr-merged")]]))
    expect(reason).toContain("agents/asana.md:")
    expect(reason).toContain("unknown `conditions:` entr(ies): pr-mergd")
  })
})

/**
 * The interval belongs to a condition and to nothing else, and the parser cannot tell
 * which list a script is on — so both refusals are the assembler's, with every agent
 * read.
 */
describe("`asked_every_seconds:` goes with `conditions:`", () => {
  it("refuses a condition whose script declares no interval — there is nothing to ask it on", () => {
    const reason = load({
      agents: files([["asana", agent("posts", "\nconditions:\n  - pr-merged")]]),
      checks: new Map([["pr-merged", script("pr-merged")]]),
    })
    expect(reason).toContain("checks/pr-merged.sh:")
    expect(reason).toContain("no `asked_every_seconds:`")
  })

  it("refuses an interval on a script named only under `checks:` or `effects:`", () => {
    const reason = load({
      agents: files([["build", agent("builds", "\nchecks:\n  - verify")]]),
      checks: new Map([["verify", condition("verify")]]),
    })
    expect(reason).toContain("checks/verify.sh:")
    expect(reason).toContain("named only under `checks:` or `effects:`")
  })

  it("accepts a script one agent checks with and another waits on", () => {
    expect(
      load({
        agents: files([
          ["build", agent("builds", "\nchecks:\n  - pr-merged")],
          ["asana", agent("posts", "\nconditions:\n  - pr-merged")],
        ]),
        checks: new Map([["pr-merged", condition("pr-merged")]]),
      }),
    ).toMatchObject({
      agents: new Map([
        ["asana", { conditions: ["pr-merged"] }],
        ["build", { checks: ["pr-merged"] }],
      ]),
    })
  })

  it("leaves a script nobody names alone, which is a file written before its agent", () => {
    expect(load({ checks: new Map([["pr-merged", condition("pr-merged")]]) })).toMatchObject({
      checks: new Map([["pr-merged", { askedEverySeconds: 300 }]]),
    })
  })

  it("refuses it on the setup script, which runs once per worktree", () => {
    const reason = load({ setup: { ...condition("setup"), shown: "worktrees/setup.sh" } })
    expect(reason).toContain("worktrees/setup.sh:")
    expect(reason).toContain("setup runs once")
  })

  it("refuses it on the teardown script, for the same reason", () => {
    const reason = load({ teardown: { ...condition("teardown"), shown: "worktrees/teardown.sh" } })
    expect(reason).toContain("worktrees/teardown.sh:")
    expect(reason).toContain("teardown runs once")
  })
})

/** One of the worktree scripts, as the loader hands it over. */
const worktreeScript = (name: string, reaches: string): ScriptSource => ({
  shown: `worktrees/${name}.sh`,
  path: `/repo/.orkestra/worktrees/${name}.sh`,
  text: `# ---\n# description: ${name}s the worktree\n# reaches: ${reaches}\n# ---\n\nexit 0\n`,
})

describe("`reaches:` belongs to the two worktree scripts", () => {
  it("keeps the key each of them declares", () => {
    expect(
      load({
        setup: worktreeScript("setup", "local"),
        teardown: worktreeScript("teardown", "external"),
      }),
    ).toMatchObject({ setup: { reaches: "local" }, teardown: { reaches: "external" } })
  })

  it("refuses it on a check, naming the file", () => {
    const reason = load({
      checks: new Map([
        [
          "verify",
          {
            ...script("verify"),
            text: "# ---\n# description: verifies\n# reaches: local\n# ---\n\nexit 0\n",
          },
        ],
      ]),
    })
    expect(reason).toContain("checks/verify.sh:")
    expect(reason).toContain("not `worktrees/setup.sh` or `worktrees/teardown.sh`")
  })

  it("refuses it on deploy.sh and on env.sh, which no sandbox decides anything about", () => {
    expect(
      load({ deploy: { ...worktreeScript("deploy", "external"), shown: "deploy.sh" } }),
    ).toContain("deploy.sh: `reaches:`")
    expect(load({ env: worktreeScript("env", "local") })).toContain("worktrees/env.sh: `reaches:`")
  })
})

/** An agent that only reads — what may wait on the branch merging. */
const reader = (description: string, over = ""): string =>
  agent(description, over).replace("permission: write", "permission: read-only")

/** `deploy.sh` as the loader hands it over. */
const deployScript = (seconds?: number): ScriptSource => ({
  shown: "deploy.sh",
  path: "/repo/.orkestra/deploy.sh",
  text: `# ---\n# description: is the merge commit live\n${seconds === undefined ? "" : `# asked_every_seconds: ${String(seconds)}\n`}# ---\n\nexit 1\n`,
})

describe("the two conditions the engine answers itself", () => {
  it("accepts `merged` under `conditions:` with no script behind it", () => {
    expect(
      load({ agents: files([["verify", reader("checks prod", "\nconditions:\n  - merged")]]) }),
    ).toMatchObject({ agents: new Map([["verify", { conditions: ["merged"] }]]) })
  })

  it("accepts `deployed` only where the project has a deploy.sh, and parses the script", () => {
    expect(
      load({
        agents: files([["verify", reader("checks prod", "\nconditions:\n  - deployed")]]),
        deploy: deployScript(120),
      }),
    ).toMatchObject({
      agents: new Map([["verify", { conditions: ["deployed"] }]]),
      deploy: { name: "deploy", askedEverySeconds: 120, path: "/repo/.orkestra/deploy.sh" },
      root: "/repo",
    })
  })

  it("refuses `deployed` without the script, and says what the script is for", () => {
    const reason = load({
      agents: files([["verify", reader("checks prod", "\nconditions:\n  - deployed")]]),
    })
    expect(reason).toContain("agents/verify.md:")
    expect(reason).toContain("no `deploy.sh`")
  })

  it("refuses a project script named after either, before it is read", () => {
    const reason = load({ checks: new Map([["merged", script("merged")]]) })
    expect(reason).toContain("checks/merged.sh:")
    expect(reason).toContain("the engine answers itself")
  })

  it("does not offer them under `checks:` or `effects:`", () => {
    const reason = load({
      agents: files([["build", agent("builds", "\nchecks:\n  - merged")]]),
    })
    expect(reason).toContain("unknown `checks:` entr(ies): merged")
  })

  it("refuses a write agent that waits on either, naming the fix", () => {
    const reason = load({
      agents: files([["fix", agent("fixes prod", "\nconditions:\n  - merged")]]),
    })
    expect(reason).toContain("agents/fix.md:")
    expect(reason).toContain("`permission: write` with `conditions:` naming `merged`")
  })

  it("loads a deploy.sh that declares no interval — the engine has one of its own", () => {
    expect(load({ deploy: deployScript() })).toMatchObject({
      deploy: { askedEverySeconds: undefined },
    })
  })
})

/** A role file under `shipped/agents/`, which names no model and runs on `default:`. */
const shippedRole = (description: string, over = ""): string =>
  `---
description: ${description}
permission: write
output:
  Summary: what happened${over}
---

shipped brief for ${description}
`

const shippedScript = (name: string): ScriptSource => ({
  shown: `shipped/checks/${name}.sh`,
  path: `/engine/shipped/checks/${name}.sh`,
  text: `# ---\n# description: runs ${name}\n# ---\n\nexit 0\n`,
})

/** Role name -> the shipped file, then the repo files over it, each named by where it is. */
const layers = (
  entries: readonly (readonly [string, string | undefined, ...(readonly [string, string])[]])[],
): ReadonlyMap<string, AgentFiles> =>
  new Map(
    entries.map(([name, bottom, ...repo]) => [
      name,
      {
        shipped:
          bottom === undefined ? undefined : { shown: `shipped/agents/${name}.md`, text: bottom },
        repo: repo.map(([shown, text]) => ({ shown, text })),
      },
    ]),
  )

/** An override holding only the fields named, with no body. */
const partial = (fields: string): string => `---\n${fields}\n---\n`

/** What `assembleLibrary` reports about layering, or the failure. */
const layeredFrom = (over: Partial<LibrarySource>): unknown =>
  Either.match(assembleLibrary(source(over)), {
    onLeft: (e) => `${e.path}: ${e.reason}`,
    onRight: ({ layered }) => layered,
  })

describe("a shipped role with no file of the project's", () => {
  it("joins the fleet on the project's `default:`, beside the project's own roles", () => {
    expect(
      load({
        agents: new Map([...ONE, ...layers([["plan", shippedRole("plans things")]])]),
        models: "default: haiku\nmodels: {claude: [{name: sonnet}, {name: haiku}]}",
      }),
    ).toMatchObject({
      agents: new Map([
        ["build", { model: "sonnet" }],
        ["plan", { model: "haiku", brief: "shipped brief for plans things", checks: [] }],
      ]),
    })
  })

  it("is the fleet on its own when the project has no agents directory", () => {
    expect(load({ agents: layers([["plan", shippedRole("plans things")]]) })).toMatchObject({
      agents: new Map([["plan", { name: "plan" }]]),
    })
  })
})

/** The shipped `plan` role with the given project files over it. */
const over = (...repo: (readonly [string, string])[]): LibrarySource["agents"] =>
  layers([["plan", shippedRole("plans things"), ...repo]])

describe("a project file over a shipped role merges field by field", () => {
  it("takes the shipped brief and sections, plus the fields the override names", () => {
    const checks = new Map([["verify", script("verify")]])
    expect(
      load({
        agents: over(["agents/plan.md", partial("model: opus\nchecks: [verify]")]),
        models: "default: sonnet\nmodels: {claude: [{name: opus}, {name: sonnet}]}",
        checks,
      }),
    ).toMatchObject({
      agents: new Map([
        [
          "plan",
          {
            description: "plans things",
            model: "opus",
            checks: ["verify"],
            permission: "write",
            sections: [{ title: "Summary", description: "what happened" }],
            brief: "shipped brief for plans things",
          },
        ],
      ]),
    })
  })

  it("layers `.local/` over the team's the same way, the later file winning per field", () => {
    expect(
      load({
        agents: over(
          ["agents/plan.md", partial("description: the team's words\nicon: map")],
          [".local/agents/plan.md", partial("description: my words")],
        ),
      }),
    ).toMatchObject({
      agents: new Map([
        ["plan", { description: "my words", icon: "map", brief: "shipped brief for plans things" }],
      ]),
    })
  })

  it("replaces a list whole rather than appending to it, and a brief only when it has one", () => {
    const checks = new Map([
      ["one", script("one")],
      ["two", script("two")],
    ])
    const agents = layers([
      [
        "plan",
        undefined,
        ["agents/plan.md", agent("plans", "\nchecks: [one, two]")],
        [".local/agents/plan.md", `${partial("checks: [two]")}\nmy brief\n`],
      ],
    ])
    expect(load({ agents, checks })).toMatchObject({
      agents: new Map([["plan", { checks: ["two"], brief: "my brief" }]]),
    })
  })

  it("replaces `output:` whole", () => {
    expect(
      load({ agents: over(["agents/plan.md", partial("output:\n  Plan: the plan")]) }),
    ).toMatchObject({
      agents: new Map([["plan", { sections: [{ title: "Plan", description: "the plan" }] }]]),
    })
  })

  it("reports each layered role once, with the fields each file sets", () => {
    expect(
      layeredFrom({
        agents: new Map([
          ...ONE,
          ...over(
            ["agents/plan.md", partial("model: sonnet")],
            [".local/agents/plan.md", `${partial("icon: map")}\nmine\n`],
          ),
        ]),
      }),
    ).toEqual([
      {
        name: "plan",
        layers: [
          {
            shown: "shipped/agents/plan.md",
            fields: ["description", "permission", "output", "brief"],
          },
          { shown: "agents/plan.md", fields: ["model"] },
          { shown: ".local/agents/plan.md", fields: ["icon", "brief"] },
        ],
      },
    ])
  })
})

describe("an override is still checked file by file", () => {
  it("still refuses an unknown key in an override, blaming that file", () => {
    expect(load({ agents: over(["agents/plan.md", partial("modle: opus")]) })).toContain(
      "agents/plan.md: unknown field `modle:`",
    )
  })

  it("blames the file that named an unlisted model, not the shipped one under it", () => {
    expect(load({ agents: over([".local/agents/plan.md", partial("model: gpt-9")]) })).toContain(
      ".local/agents/plan.md: `model: gpt-9` is not in models.yaml",
    )
  })
})

describe("a role no shipped file backs has to say all of it", () => {
  it("refuses a one-field file with nothing under it, and says there is nothing to layer over", () => {
    const reason = load({
      agents: layers([["mine", undefined, ["agents/mine.md", partial("model: sonnet")]]]),
    })
    expect(reason).toContain("agents/mine.md: no `description:`, `permission:`, `output:`")
    expect(reason).toContain("Orkestra ships no role called `mine`")
  })

  it("still requires `model:` — the fallback is for shipped roles only", () => {
    const whole = agent("mine").replace("model: sonnet\n", "")
    expect(load({ agents: layers([["mine", undefined, ["agents/mine.md", whole]]]) })).toContain(
      "agents/mine.md: no `model:`",
    )
  })

  it("is whole across the team's and the local file together", () => {
    const agents = layers([
      [
        "mine",
        undefined,
        ["agents/mine.md", agent("mine")],
        [".local/agents/mine.md", partial("description: mine, locally")],
      ],
    ])
    expect(load({ agents })).toMatchObject({
      agents: new Map([["mine", { description: "mine, locally", model: "sonnet" }]]),
    })
  })
})

describe("a headerless project file over a shipped role", () => {
  it("is another engine's brief, passed over, and the shipped role stands", () => {
    const agents = layers([
      ["plan", shippedRole("plans things"), ["agents/plan.md", "# Plan\n\nsomeone else's\n"]],
    ])
    expect(load({ agents })).toMatchObject({
      agents: new Map([["plan", { brief: "shipped brief for plans things" }]]),
    })
  })
})

const fleet = (text: string, shown = "fleet.yaml"): LibrarySource["fleet"] => ({ shown, text })

describe("fleet.yaml `refused:`", () => {
  const two = new Map([
    ...ONE,
    ...layers([
      ["plan", shippedRole("plans things")],
      ["survey", shippedRole("surveys things")],
    ]),
  ])

  it("leaves a refused shipped role out of the fleet, and keeps the rest", () => {
    expect(load({ agents: two, fleet: fleet("refused: [survey]") })).toMatchObject({
      agents: new Map([
        ["build", { name: "build" }],
        ["plan", { name: "plan" }],
      ]),
    })
    expect(
      Either.map(assembleLibrary(source({ agents: two, fleet: fleet("refused: [survey]") })), (a) =>
        a.library.agents.has("survey"),
      ),
    ).toEqual(Either.right(false))
  })

  it("stops the load on a name Orkestra does not ship, naming the file", () => {
    const reason = load({ agents: two, fleet: fleet("refused: [build]", ".local/fleet.yaml") })
    expect(reason).toContain(
      ".local/fleet.yaml: `refused:` names build, which Orkestra does not ship",
    )
    expect(reason).toContain("It ships plan, survey.")
  })

  it("refuses a key that is not `refused:` rather than turning nothing off", () => {
    expect(load({ agents: two, fleet: fleet("refuse: [survey]") })).toContain(
      "fleet.yaml: expected a `refused:` list",
    )
  })

  it("reads an empty file as refusing nothing", () => {
    expect(load({ agents: two, fleet: fleet("") })).toMatchObject({
      agents: new Map([
        ["build", {}],
        ["plan", {}],
        ["survey", {}],
      ]),
    })
  })

  it("refuses a role that is both refused and written, blaming the file", () => {
    const agents = layers([
      ["survey", shippedRole("surveys things"), ["agents/survey.md", partial("model: opus")]],
    ])
    expect(load({ agents, fleet: fleet("refused: [survey]") })).toContain(
      "agents/survey.md: `survey` is under `refused:` in fleet.yaml, and this file defines it.",
    )
  })
})

describe("shipped scripts", () => {
  const publish = layers([["publish", shippedRole("opens the PR", "\neffects: [open-pr]")]])

  it("let a shipped role name one under `effects:`, and run the engine's copy", () => {
    const lib = assembleLibrary(
      source({
        agents: publish,
        checks: new Map([["open-pr", shippedScript("open-pr")]]),
        shippedChecks: ["open-pr"],
      }),
    )
    expect(
      Either.map(lib, ({ library }) => [
        library.agents.get("publish")?.effects,
        library.checks.get("open-pr")?.path,
      ]),
    ).toEqual(Either.right([["open-pr"], "/engine/shipped/checks/open-pr.sh"]))
  })

  it("run the project's copy when the project has one — the registry `overlay` hands in", () => {
    const lib = assembleLibrary(
      source({
        agents: publish,
        checks: new Map([
          ["open-pr", { ...script("open-pr"), path: "/repo/.orkestra/checks/open-pr.sh" }],
        ]),
        shippedChecks: ["open-pr"],
      }),
    )
    expect(Either.map(lib, ({ library }) => library.checks.get("open-pr")?.path)).toEqual(
      Either.right("/repo/.orkestra/checks/open-pr.sh"),
    )
  })

  it("are the only effects a shipped role may name", () => {
    expect(load({ agents: publish, checks: new Map([["open-pr", script("open-pr")]]) })).toContain(
      "shipped/agents/publish.md: `effects:` names open-pr, which Orkestra does not ship",
    )
  })

  it("take a project's `checks:` over them, which the shipped file may not name itself", () => {
    const checks = new Map([["verify", script("verify")]])
    expect(
      load({
        agents: layers([["plan", shippedRole("plans", "\nchecks: [verify]")]]),
        checks,
      }),
    ).toContain("shipped/agents/plan.md: a file Orkestra ships names no `checks:`")
  })
})

describe("`skills:` — the repository's own skills a role reads", () => {
  const SKILLS = new Map([
    ["house-style", ".claude/skills/house-style/SKILL.md"],
    ["lens", ".agents/skills/lens/SKILL.md"],
  ])

  it("resolves each name to its SKILL.md, in the order the file names them", () => {
    expect(
      load({
        agents: over(["agents/plan.md", partial("skills: [lens, house-style]")]),
        skills: SKILLS,
      }),
    ).toMatchObject({
      agents: new Map([
        [
          "plan",
          {
            brief: "shipped brief for plans things",
            skills: [
              { name: "lens", path: ".agents/skills/lens/SKILL.md" },
              { name: "house-style", path: ".claude/skills/house-style/SKILL.md" },
            ],
          },
        ],
      ]),
    })
  })

  it("is empty for a role that names none", () => {
    expect(load({ skills: SKILLS })).toMatchObject({
      agents: new Map([["build", { skills: [] }]]),
    })
  })

  it("is replaced whole by a later layer, like `checks:`", () => {
    expect(
      load({
        agents: over(
          ["agents/plan.md", partial("skills: [lens, house-style]")],
          [".local/agents/plan.md", partial("skills: [lens]")],
        ),
        skills: SKILLS,
      }),
    ).toMatchObject({
      agents: new Map([["plan", { skills: [{ name: "lens" }] }]]),
    })
  })

  it("refuses a name no skill directory holds, blaming the file that named it", () => {
    const reason = load({
      agents: over(
        ["agents/plan.md", partial("skills: [lens]")],
        [".local/agents/plan.md", partial("skills: [lense]")],
      ),
      skills: SKILLS,
    })
    expect(reason).toContain(".local/agents/plan.md: unknown `skills:` entr(ies): lense")
    expect(reason).toContain("Available: house-style, lens")
  })

  it("says the repository has none rather than listing an empty set", () => {
    expect(load({ agents: over(["agents/plan.md", partial("skills: [lens]")]) })).toContain(
      "this repository has none",
    )
  })

  it("may not be named by a shipped file — which skills a repository keeps is its own", () => {
    expect(
      load({
        agents: layers([["plan", shippedRole("plans", "\nskills: [lens]")]]),
        skills: SKILLS,
      }),
    ).toContain("shipped/agents/plan.md: a file Orkestra ships names no `skills:`")
  })
})

describe("an agent's processes must be declared", () => {
  const dev: ScriptSource = {
    shown: "processes/dev.sh",
    path: "/tmp/dev.sh",
    text: '# ---\n# description: the dev server\n# page: true\n# ---\n\nexec vite --port "$PORT"\n',
  }
  const listing = (name: string) =>
    load({
      agents: files([["build", agent("implements", `\nprocesses:\n  - ${name}`)]]),
      processes: new Map([["dev", dev]]),
    })

  it("accepts one the project declares, and keeps the declaration", () => {
    expect(listing("dev")).toMatchObject({
      agents: new Map([["build", { processes: ["dev"] }]]),
      processes: new Map([["dev", { name: "dev", page: true, path: "/tmp/dev.sh" }]]),
    })
  })

  it("refuses an undeclared one at load, and names what is declared", () => {
    const reason = listing("devv")
    expect(reason).toContain("agents/build.md:")
    expect(reason).toContain("unknown `processes:` entr(ies): devv")
    expect(reason).toContain("Available: dev.")
  })
})

const needing = (name: string, needs: string): [string, ScriptSource] => [
  name,
  {
    shown: `processes/${name}.sh`,
    path: `/tmp/${name}.sh`,
    text: `# ---\n# description: the ${name} server\n# needs: [${needs}]\n# ---\n\nexec serve\n`,
  },
]
describe("a process's needs must be declared and must not go round", () => {
  const declaring = (...entries: [string, ScriptSource][]) => load({ processes: new Map(entries) })

  it("accepts a need the project declares, and keeps it on the declaration", () => {
    expect(declaring(needing("web", ""), needing("gallery", "web"))).toMatchObject({
      processes: new Map([
        ["gallery", { needs: ["web"] }],
        ["web", { needs: [] }],
      ]),
    })
  })

  it("refuses an undeclared one, and names what is declared", () => {
    const reason = declaring(needing("web", ""), needing("gallery", "wbe"))
    expect(reason).toContain("processes/gallery.sh:")
    expect(reason).toContain("unknown `needs:` entr(ies): wbe")
    expect(reason).toContain("Available: gallery, web.")
  })

  it("refuses a process that needs itself", () => {
    expect(declaring(needing("web", "web"))).toContain("goes round in a circle: web → web")
  })

  it("refuses a cycle through other processes, naming the way round", () => {
    const reason = declaring(needing("a", "b"), needing("b", "c"), needing("c", "a"))
    expect(reason).toContain("processes/a.sh:")
    expect(reason).toContain("a → b → c → a")
  })
})

const project = (...entries: [string, ScriptSource][]) =>
  checkoutProcesses(new Map(), new Map(entries)).processes
const names = (found: ReturnType<typeof checkoutProcesses>) => ({
  processes: [...found.processes.keys()],
  unreadable: found.unreadable.map((u) => `${u.name}: ${u.reason}`),
})

describe("a trak's checkout declares processes over the project's", () => {
  it("adds its own beside the project's, and its own wins by name", () => {
    const found = checkoutProcesses(
      project(needing("web", "")),
      new Map([needing("gallery", "web"), needing("web", "")]),
    )
    expect(names(found)).toEqual({ processes: ["gallery", "web"], unreadable: [] })
    expect(found.processes.get("web")?.path).toBe("/tmp/web.sh")
  })

  it("leaves out a file that does not parse, and keeps the rest", () => {
    const broken: [string, ScriptSource] = [
      "broken",
      { shown: "processes/broken.sh", path: "/tmp/broken.sh", text: "exec serve\n" },
    ]
    const found = checkoutProcesses(project(needing("web", "")), new Map([broken]))
    expect(found.processes.has("web")).toBe(true)
    expect(found.unreadable).toMatchObject([{ name: "broken", shown: "processes/broken.sh" }])
  })

  it("leaves out what needs a process left out, however far down", () => {
    const found = checkoutProcesses(
      new Map(),
      new Map([needing("a", "b"), needing("b", "nowhere"), needing("c", "")]),
    )
    expect(names(found).processes).toEqual(["c"])
    expect(found.unreadable.map((u) => u.name).toSorted()).toEqual(["a", "b"])
  })

  it("leaves out a cycle", () => {
    const found = checkoutProcesses(new Map(), new Map([needing("a", "b"), needing("b", "a")]))
    expect(names(found).processes).toEqual([])
    expect(found.unreadable[0]?.reason).toContain("goes round in a circle")
  })
})

/** A script that reports units under `label`. */
const reporting = (name: string, label: string): ScriptSource => ({
  shown: `checks/${name}.sh`,
  path: `/tmp/${name}.sh`,
  text: `# ---\n# description: proves ${name}\n# units: ${label}\n# ---\n\nexit 0\n`,
})

describe("`units:` goes with `checks:`", () => {
  it("accepts it on a step's check", () => {
    expect(
      load({
        agents: files([["build", agent("builds", "\nchecks:\n  - verify")]]),
        checks: new Map([["verify", reporting("verify", "vitest")]]),
      }),
    ).toMatchObject({ checks: new Map([["verify", { units: "vitest" }]]) })
  })

  it("refuses it on an effect, which nothing reads units after", () => {
    const reason = load({
      agents: files([["ship", agent("ships", "\neffects:\n  - open-pr")]]),
      checks: new Map([["open-pr", reporting("open-pr", "vitest")]]),
    })
    expect(reason).toContain("checks/open-pr.sh:")
    expect(reason).toContain("`units:` on a script named under `conditions:` or `effects:`")
  })
})
