import { describe, expect, it } from "vitest"
import type { ScriptSource, ShippedSource, TextSource, TreeSource } from "./assemble.js"
import { overlay } from "./overlay.js"

const agent = (dir: string, name: string): [string, TextSource] => [
  name,
  { shown: `${dir}agents/${name}.md`, text: `---\n${dir}${name}\n---\n` },
]

const check = (dir: string, name: string): [string, ScriptSource] => [
  name,
  { shown: `${dir}checks/${name}.sh`, path: `/repo/.orkestra/${dir}checks/${name}.sh`, text: "" },
]

const tree = (dir: "" | ".local/", over: Partial<TreeSource> = {}): TreeSource => ({
  agents: new Map([agent(dir, "build")]),
  checks: new Map([check(dir, "verify")]),
  processes: new Map(),
  tools: new Map(),
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
  models: undefined,
  composition: undefined,
  goals: undefined,
  guidance: undefined,
  fleet: undefined,
  ...over,
})

const NONE: ShippedSource = { agents: new Map(), checks: new Map(), generic: "shipped" }

const shipped = (over: Partial<ShippedSource> = {}): ShippedSource => ({
  agents: new Map([agent("shipped/", "build"), agent("shipped/", "review")]),
  checks: new Map([check("shipped/", "open-pr")]),
  generic: "shipped",
  ...over,
})

describe("with no .local/ directory and no shipped fleet", () => {
  it("is the team's tree, each agent one layer, and nothing is shadowed", () => {
    const team = tree("", { guidance: "team" })
    const { source, shadows } = overlay(NONE, team, undefined, "/repo")
    expect(source).toMatchObject({
      guidance: "team",
      generic: "shipped",
      root: "/repo",
      localModels: undefined,
      shippedChecks: [],
    })
    expect(source.agents).toEqual(
      new Map([
        [
          "build",
          { shipped: undefined, repo: [{ shown: "agents/build.md", text: "---\nbuild\n---\n" }] },
        ],
      ]),
    )
    expect(shadows).toEqual([])
  })
})

describe("agents are lined up by name, bottom layer first, rather than merged", () => {
  it("keeps the shipped file under the team's and the local one over both", () => {
    const { source } = overlay(shipped(), tree(""), tree(".local/"), "/repo")
    expect(source.agents.get("build")).toMatchObject({
      shipped: { shown: "shipped/agents/build.md" },
      repo: [{ shown: "agents/build.md" }, { shown: ".local/agents/build.md" }],
    })
  })

  it("carries a shipped role nobody wrote a file for, and a local role nobody shipped", () => {
    const { source } = overlay(
      shipped(),
      tree("", { agents: new Map() }),
      tree(".local/", { agents: new Map([agent(".local/", "mine")]) }),
      "/repo",
    )
    expect([...source.agents.keys()].sort()).toEqual(["build", "mine", "review"])
    expect(source.agents.get("review")).toMatchObject({ repo: [] })
    expect(source.agents.get("mine")).toMatchObject({ shipped: undefined })
  })
})

describe("checks union by name across all three layers, the later file winning", () => {
  it("adds a shipped script nobody replaces, and names it for the rule on shipped roles", () => {
    const { source, shadows } = overlay(shipped(), tree(""), undefined, "/repo")
    expect([...source.checks.keys()].sort()).toEqual(["open-pr", "verify"])
    expect(source.shippedChecks).toEqual(["open-pr"])
    expect(shadows).toEqual([])
  })

  it("replaces a shipped script with the project's, and names both files", () => {
    const { source, shadows } = overlay(
      shipped(),
      tree("", { checks: new Map([check("", "open-pr")]) }),
      undefined,
      "/repo",
    )
    expect(source.checks.get("open-pr")?.path).toBe("/repo/.orkestra/checks/open-pr.sh")
    expect(shadows).toEqual([{ over: "checks/open-pr.sh", under: "shipped/checks/open-pr.sh" }])
  })

  it("replaces a team script with a local one of the same name", () => {
    const { source, shadows } = overlay(NONE, tree(""), tree(".local/"), "/repo")
    expect(source.checks.get("verify")).toMatchObject({
      path: "/repo/.orkestra/.local/checks/verify.sh",
    })
    expect(shadows).toEqual([{ over: ".local/checks/verify.sh", under: "checks/verify.sh" }])
  })
})

describe("prose, fleet.yaml and the worktree scripts are replaced outright, never appended", () => {
  const team = tree("", {
    guidance: "team guidance",
    composition: "team composition",
    fleet: { shown: "fleet.yaml", text: "refused: [review]" },
    setup: { shown: "worktrees/setup.sh", path: "/repo/.orkestra/worktrees/setup.sh", text: "" },
    teardown: {
      shown: "worktrees/teardown.sh",
      path: "/repo/.orkestra/worktrees/teardown.sh",
      text: "",
    },
    env: { shown: "worktrees/env.sh", path: "/repo/.orkestra/worktrees/env.sh", text: "" },
    deploy: { shown: "deploy.sh", path: "/repo/.orkestra/deploy.sh", text: "" },
  })

  it("takes the local file when there is one", () => {
    // Two pieces of guidance can contradict each other, and an agent reading both has
    // no way to tell which the project meant.
    const { source } = overlay(
      NONE,
      team,
      tree(".local/", {
        guidance: "local guidance",
        composition: "local composition",
        fleet: { shown: ".local/fleet.yaml", text: "refused: []" },
        setup: {
          shown: ".local/worktrees/setup.sh",
          path: "/repo/.orkestra/.local/worktrees/setup.sh",
          text: "",
        },
        teardown: {
          shown: ".local/worktrees/teardown.sh",
          path: "/repo/.orkestra/.local/worktrees/teardown.sh",
          text: "",
        },
        env: {
          shown: ".local/worktrees/env.sh",
          path: "/repo/.orkestra/.local/worktrees/env.sh",
          text: "",
        },
        deploy: { shown: ".local/deploy.sh", path: "/repo/.orkestra/.local/deploy.sh", text: "" },
      }),
      "/repo",
    )
    expect(source).toMatchObject({
      guidance: "local guidance",
      composition: "local composition",
      fleet: { shown: ".local/fleet.yaml", text: "refused: []" },
      setup: { shown: ".local/worktrees/setup.sh" },
      teardown: { shown: ".local/worktrees/teardown.sh" },
      env: { shown: ".local/worktrees/env.sh" },
      deploy: { shown: ".local/deploy.sh" },
    })
  })

  it("keeps the team's when the overlay has none", () => {
    const { source } = overlay(NONE, team, tree(".local/"), "/repo")
    expect(source).toMatchObject({
      guidance: "team guidance",
      composition: "team composition",
      fleet: { shown: "fleet.yaml" },
      setup: { shown: "worktrees/setup.sh" },
      teardown: { shown: "worktrees/teardown.sh" },
      env: { shown: "worktrees/env.sh" },
      deploy: { shown: "deploy.sh" },
    })
  })
})

describe("models.yaml is carried beside the team's rather than over it", () => {
  it("hands both texts to the assembler, which is what can merge them", () => {
    const { source } = overlay(
      NONE,
      tree("", { models: "default: sonnet\nmodels: {claude: [{name: sonnet}]}" }),
      tree(".local/", { models: "default: haiku\nmodels: {claude: [{name: haiku}]}" }),
      "/repo",
    )
    expect(source.models).toBe("default: sonnet\nmodels: {claude: [{name: sonnet}]}")
    expect(source.localModels).toBe("default: haiku\nmodels: {claude: [{name: haiku}]}")
  })
})
