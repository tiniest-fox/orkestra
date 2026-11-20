// A trak driven by a real `.orkestra` directory rather than a Library literal.
//
// Touches the filesystem on purpose: this is the tier that proves the whole
// chain — frontmatter on disk, into the exact prompt and session request an
// agent receives. The pure rules are covered beside their source in
// src/library/logic/.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import { agentIndex } from "../../src/library/logic/index-summary.js"
import { agentNamed, fleet } from "../../src/library/logic/resolve.js"
import { FIGURES } from "../../src/library/types/agent.js"
import { FsLibraryLayer } from "../../src/library/adapters/library-fs.js"
import { Lib } from "../../src/library/ports/library.js"
import type { Library } from "../../src/library/types/library.js"
import { SHIPPED_AGENTS, TEMPLATES } from "../../src/app/packaged.js"
import { TEMPLATE_NAMES, type Templates } from "../../src/prompts/index.js"
import { buildSystemPrompt } from "../../src/workflow/domain/prompt.js"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { approveAll, create, expectState } from "../support/scenario.js"
import { reply, type AgentLog } from "../support/scripted-agent.js"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const FIXTURE = join(FIXTURES, "library")
/** The same kind of project with a `.local/` inside it, so the overlay is read off disk. */
const OVERLAY = join(FIXTURES, "overlay")
/**
 * Stand-ins for `src/library/shipped/`, so what these tests assert about a project does
 * not move whenever the real fleet does: `bare` ships only a `generic.md`, `fleet` ships
 * three roles and an `open-pr.sh` as well.
 */
const BARE = join(FIXTURES, "shipped", "bare")
const FLEET = join(FIXTURES, "shipped", "fleet")
/** A project with no `agents/` at all, and one that layers over, refuses and replaces. */
const FLEETLESS = join(FIXTURES, "fleetless")
const LAYERED = join(FIXTURES, "layered")

const loadFrom = (dir: string, shipped = BARE): Promise<Library> =>
  Effect.runPromise(Effect.provide(Lib, FsLibraryLayer(dir, shipped)))

const failureFrom = (dir: string, shipped = BARE): Promise<string> =>
  Effect.runPromise(
    Effect.match(Effect.provide(Lib, FsLibraryLayer(dir, shipped)), {
      onFailure: (e) => `${e.path}: ${e.reason}`,
      onSuccess: () => "unexpectedly loaded",
    }),
  )

/** A script file with `frontmatter`, already behind `# `, and a body that fails. */
const script = (frontmatter: string): string =>
  `#!/bin/bash\n# ---\n${frontmatter}\n# ---\n\nexit 1\n`

describe("finding the directory", () => {
  it("loads the fixture's agents, keyed by filename", async () => {
    const lib = await loadFrom(FIXTURE)
    expect([...lib.agents.keys()]).toEqual(["review", "work"])
    expect(lib.agents.get("work")).toMatchObject({
      description: "Implements the plan.",
      brief: "Do the work, from an agent file on disk.",
      model: "sonnet",
      permission: "write",
      checks: ["spelling"],
      start: true,
    })
    // The other side of the same key, and the case the endpoint depends on: a file
    // that says nothing about starting is not offered as an opening move.
    expect(lib.agents.get("review")).toMatchObject({ start: false })
  })

  it("reads `output:` as ordered sections, which is what the schema checks against", async () => {
    const lib = await loadFrom(FIXTURE)
    expect(lib.agents.get("work")?.sections).toEqual([
      {
        title: "Summary",
        description: "What changed, and what now works that did not before.",
        when: undefined,
        figure: undefined,
      },
    ])
  })

  it("loads the fixture's checks, with the path the runner has to spawn", async () => {
    const lib = await loadFrom(FIXTURE)
    expect([...lib.checks.keys()]).toEqual(["spelling"])
    expect(lib.checks.get("spelling")).toMatchObject({
      description: "Nothing in the tree is spelled `teh`.",
      timeoutSeconds: 15,
      askedEverySeconds: undefined,
      exclusive: false,
      cache: true,
      ignoresLinguistGenerated: false,
      units: undefined,
      cacheAcross: "platform" as const,
    })
    // The one place a `.orkestra` path escapes the adapter: a check is spawned,
    // not just read, so where it lives is part of what it is.
    expect(lib.checks.get("spelling")?.path).toContain("/.orkestra/checks/spelling.sh")
  })

  it("walks up from a subdirectory, the way `ork` has to", async () => {
    const nested = join(FIXTURE, "nested")
    expect(readdirSync(nested)).toContain("README.md") // a real directory, not a guess
    expect([...(await loadFrom(nested)).agents.keys()]).toEqual(["review", "work"])
  })

  it("carries the agent Orkestra ships, out of the package rather than the project", async () => {
    // The real `src/library/shipped/generic.md`, parsed by the same rules as a
    // project's file and held beside the fleet rather than in it. This is the tier
    // that reads that file at all — everything else works from a fixture.
    const lib = await loadFrom(FIXTURE, SHIPPED_AGENTS)
    expect(lib.agents.has("generic")).toBe(false)
    expect(lib.generic).toMatchObject({
      name: "generic",
      permission: "write",
      // A person may open a trak with it — New Chat is that door — and the fleet's
      // own `start:` is what says so, rather than a screen deciding.
      start: true,
      icon: "bot",
      // It names neither, so nothing runs against what it writes: both would resolve
      // against a `checks/` directory the engine cannot know the contents of.
      checks: [],
      effects: [],
      conditions: [],
      processes: [],
      skills: [],
    })
    // And its model is this project's `default:` — `haiku` here — because a shipped
    // file naming one would spend at a rate no project sanctioned.
    expect(lib.generic.model).toBe("haiku")
    expect(lib.generic.model).toBe(lib.models.composer)
    // One required section: a role-less agent has no natural shape, and two would
    // force one to be padded or omitted on every turn.
    expect(lib.generic.sections.map((s) => s.title)).toEqual(["What happened"])
  })

  it("resolves that name where a step's agent is looked up, and nowhere else", async () => {
    const lib = await loadFrom(FIXTURE)
    expect(agentNamed(lib, "generic")).toBe(lib.generic)
    expect(agentNamed(lib, "work")).toBe(lib.agents.get("work"))
    expect(agentNamed(lib, "invented")).toBeUndefined()
    // `fleet` is the list `GET /api/agents` sends, so a plan row running `generic`
    // can resolve its glyph. The composer's index is built from `agents` alone.
    expect(fleet(lib).map((a) => a.name)).toEqual(["review", "work", "generic"])
    expect(agentIndex(lib)).not.toContain("generic")
  })

  it("says so plainly when there is no .orkestra anywhere above", async () => {
    // The filesystem root, because it is the only directory with no parent to
    // walk to. A temp directory was the obvious choice and it FAILED this test:
    // macOS's temp root already holds a real `.orkestra` left by ../orkestra, so
    // the walk found it. That is the walk working, and a fair warning that
    // "upwards until something matches" can match something surprising.
    expect(await failureFrom("/")).toContain("no .orkestra/ directory here or in any parent")
  })
})

describe("a sandbox tool under tools/", () => {
  it("loads each script's header with the path a sandbox runs it at, and refuses one with no version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orkestra-tools-load-"))
    try {
      cpSync(FIXTURE, dir, { recursive: true })
      mkdirSync(join(dir, ".orkestra", "tools"))
      const path = join(dir, ".orkestra", "tools", "rclone.sh")
      writeFileSync(path, script("# description: Cloud storage sync.\n# version: 1.68.2"))
      expect((await loadFrom(dir)).tools.get("rclone")).toEqual({
        name: "rclone",
        description: "Cloud storage sync.",
        version: "1.68.2",
        path,
      })
      writeFileSync(path, script("# description: Cloud storage sync."))
      expect(await failureFrom(dir)).toContain("tools/rclone.sh: frontmatter needs")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * `.orkestra/.local/` read by the same walk and merged over the team's tree. The merge
 * rules are covered beside `overlay.ts`; this is the tier that proves the directory is
 * found, the paths are the ones a person would open, and a local check is spawned from
 * where it actually is.
 */
describe("a .local/ directory inside .orkestra/", () => {
  it("adds a local agent to the fleet and lets a local one shadow the team's", async () => {
    const lib = await loadFrom(OVERLAY)
    expect([...lib.agents.keys()]).toEqual(["mine", "review", "work"])
    expect(lib.agents.get("work")).toMatchObject({
      description: "Implements the plan, my way.",
      brief: "Do the work, from a local agent file that shadows the team's.",
    })
    expect(lib.agents.get("review")).toMatchObject({ description: "Reviews the work." })
  })

  it("spawns a local check from the overlay, not from the team's directory", async () => {
    const lib = await loadFrom(OVERLAY)
    expect(lib.checks.get("spelling")).toMatchObject({ timeoutSeconds: 5 })
    expect(lib.checks.get("spelling")?.path).toContain("/.orkestra/.local/checks/spelling.sh")
    expect(lib.setup?.path).toContain("/.orkestra/.local/worktrees/setup.sh")
  })

  it("takes the local teardown script over the team's", async () => {
    const lib = await loadFrom(OVERLAY)
    expect(lib.teardown).toMatchObject({ name: "teardown", timeoutSeconds: 5 })
    expect(lib.teardown?.path).toContain("/.orkestra/.local/worktrees/teardown.sh")
  })

  it("keeps the team's env script when the overlay's worktrees/ has none", async () => {
    // The worktree scripts are replaced one by one, not as a directory: a local
    // setup.sh does not take the team's env.sh with it.
    const lib = await loadFrom(OVERLAY)
    expect(lib.env).toMatchObject({ name: "env", timeoutSeconds: 5 })
    expect(lib.env?.path).toContain("/.orkestra/worktrees/env.sh")
  })

  it("replaces ORKESTRA.md outright and keeps a COMPOSITION.md the overlay lacks", async () => {
    const lib = await loadFrom(OVERLAY)
    expect(lib.guidance).toBe("Local guidance, in place of the team's.")
    expect(lib.composition).toBe("Team composition, kept because the overlay has none.")
  })

  it("adds the local models.yaml's entries to the team's, with their efforts, and takes its default", async () => {
    const lib = await loadFrom(OVERLAY)
    expect(lib.models).toEqual({
      allowed: ["opus", "sonnet", "haiku", "local-model"],
      efforts: new Map([["local-model", "high"]]),
      composer: "local-model",
      windows: {},
    })
    // Which is what lets the shadowing agent name a model only the overlay lists.
    expect(lib.agents.get("work")?.model).toBe("local-model")
  })
})

/**
 * The shipped fleet read off disk under a project. The merge rules are covered beside
 * `assemble.ts`; this tier proves the engine's directories are found, and that a script
 * the engine ships is spawned from the engine while a project's replaces it.
 */
describe("a shipped fleet under the project", () => {
  it("is the whole fleet of a project with no agents directory, in the composer's index", async () => {
    const lib = await loadFrom(FLEETLESS, FLEET)
    expect([...lib.agents.keys()]).toEqual(["plan", "pull-request", "survey"])
    expect(agentIndex(lib)).toContain("- plan: Plans the work, from the fixture fleet.")
    // Shipped roles name no model, so each runs on this project's `default:`.
    expect(lib.agents.get("plan")?.model).toBe("haiku")
  })

  it("runs the engine's own script where the project has none of that name", async () => {
    const lib = await loadFrom(FLEETLESS, FLEET)
    expect(lib.agents.get("pull-request")?.effects).toEqual(["open-pr"])
    expect(lib.checks.get("open-pr")?.path).toBe(join(FLEET, "checks", "open-pr.sh"))
  })

  it("layers a two-field override over the shipped role, and leaves out a refused one", async () => {
    const lib = await loadFrom(LAYERED, FLEET)
    expect([...lib.agents.keys()]).toEqual(["plan", "pull-request"])
    expect(lib.agents.get("plan")).toMatchObject({
      description: "Plans the work, from the fixture fleet.",
      brief: "Plan it, from a shipped agent file.",
      permission: "read-only",
      model: "opus",
      checks: ["spelling"],
    })
  })

  it("runs the project's script in place of the engine's of the same name", async () => {
    const lib = await loadFrom(LAYERED, FLEET)
    expect(lib.checks.get("open-pr")?.path).toBe(join(LAYERED, ".orkestra", "checks", "open-pr.sh"))
    expect(lib.checks.get("open-pr")?.description).toBe(
      "The project's own open-pr.sh, in place of the engine's.",
    )
  })
})

/**
 * The real fleet's briefs, rendered into the contract a step is handed. The rendering
 * rules are covered beside `prompt.ts`; this is the tier that proves which grammars each
 * shipped role is actually taught, which moves whenever a brief's `figure:` keys do.
 */
describe("the figures the shipped fleet is taught", () => {
  const templates: Templates = new Map(
    TEMPLATE_NAMES.map((n) => [n, readFileSync(join(TEMPLATES, `${n}.md`), "utf8")]),
  )
  /** The figure labels a contract opens a fence with — each taught grammar's example. */
  const taught = (lib: Library, name: string): readonly string[] => {
    const sections = lib.agents.get(name)?.sections ?? []
    const { contract } = buildSystemPrompt(templates, {
      role: "step",
      sections,
      conversational: false,
      skills: [],
    })
    return [...contract.matchAll(/^```(\w+)$/gmu)]
      .map((m) => m[1] ?? "")
      .filter((label) => FIGURES.some((f) => f === label))
  }

  it("teaches build and review the criteria", async () => {
    const lib = await loadFrom(FLEETLESS, SHIPPED_AGENTS)
    expect(taught(lib, "build")).toEqual(["criteria", "table"])
    expect(taught(lib, "review")).toEqual(["criteria", "table"])
    // Its What changed section becomes the GitHub body, which has to read as markdown.
    expect(taught(lib, "pull-request")).toEqual(["table"])
  })
})

/** compose -> work -> review, cleared, so one call exercises both steps. */
const TURNS = [
  composer("work", "review"),
  step(1, "work", reply.artifact("v1")),
  step(2, "review", reply.artifact("no blockers")),
]

/**
 * Defined at module scope, not inside the describe, so the assertion callback is
 * not four levels deep before it starts — `max-nested-callbacks` is 4.
 */
const flowWith = (lib: Library, assert: (log: AgentLog) => void): Promise<void> =>
  runFlowWithAgentLog(
    TURNS,
    (id, agentLog) =>
      Effect.gen(function* () {
        // Both artifacts gate; the gates are not what this file is about.
        const done = yield* approveAll(id, yield* create(id, "Add a --json flag"))
        expectState(done, "Finished")
        assert(yield* agentLog)
      }),
    lib,
  )

describe("policy read off disk reaches the agents", () => {
  let lib: Library
  beforeAll(async () => {
    lib = await loadFrom(FIXTURE)
  })

  const prompts = (assert: (prompts: readonly string[]) => void) =>
    flowWith(lib, (log) => assert(log.requests.map((r) => r.prompt)))

  it("puts COMPOSITION.md and the frontmatter descriptions in the composer's prompt", async () => {
    await prompts(([composerPrompt = ""]) => {
      expect(composerPrompt).toContain("Propose exactly one step for anything trivial")
      expect(composerPrompt).toContain("- work: Implements the plan.")
      expect(composerPrompt).toContain("- review: Reviews the work.")
      // the brief is not in the index — selection is name + description only
      expect(composerPrompt).not.toContain("from an agent file on disk")
      // and neither is anything else the agent owns: what it costs, what it may
      // do, what has to pass. Three registries became one.
      expect(composerPrompt).not.toContain("spelling")
      expect(composerPrompt).not.toContain("sonnet")
      expect(composerPrompt).not.toContain("read-only")
    })
  })

  it("puts the agent's brief and ORKESTRA.md in the step's prompt", async () => {
    await prompts(([, work = "", review = ""]) => {
      expect(work).toContain("Do the work, from an agent file on disk.")
      expect(work).toContain("This fixture project pins every guidance string")
      // each step gets ONLY its own agent's brief
      expect(work).not.toContain("Review it")
      expect(review).toContain("Review it, from an agent file on disk.")
    })
  })

  it("tells the read-only agent why its edit tools are denied, and not the writing one", async () => {
    await prompts(([, work = "", review = ""]) => {
      expect(review).toContain("tools that edit files are denied")
      expect(work).not.toContain("tools that edit files are denied")
    })
  })
})

describe("`skills:` resolves against the repository's skill directories", () => {
  it("names each SKILL.md relative to the repository, `.claude/skills/` hiding `.agents/skills/`", async () => {
    const lib = await loadFrom(FIXTURE)
    expect(lib.agents.get("work")?.skills).toEqual([
      { name: "lens", path: ".agents/skills/lens/SKILL.md" },
      { name: "house-style", path: ".claude/skills/house-style/SKILL.md" },
    ])
    expect(lib.agents.get("review")?.skills).toEqual([])
  })

  it("puts them on the session of the step that names them, and on no other", async () => {
    const lib = await loadFrom(FIXTURE)
    await flowWith(lib, (log) => {
      const [work, review] = stepRuns(log).map((r) => r.brief?.contract ?? "")
      expect(work).toContain("- `lens` — `.agents/skills/lens/SKILL.md`")
      expect(work).toContain("- `house-style` — `.claude/skills/house-style/SKILL.md`")
      expect(review).not.toContain("SKILL.md")
    })
  })
})

describe("frontmatter drives the session request, not just the prompt", () => {
  it("takes each step's model and tool access from the agent it names", async () => {
    // No resolution left to do: one agent per step, read as written. This used
    // to be max-over-the-techniques for the model and a union for the deny list.
    const lib = await loadFrom(FIXTURE)
    await flowWith(lib, (log) => {
      const runs = stepRuns(log)
      expect(runs.map((r) => r.model)).toEqual(["sonnet", "opus"])
      expect(runs.map((r) => r.toolAccess)).toEqual(["write", "read-only"])
    })
  })

  it("runs a step that writes under auto mode, and the reader and the composer bypassed", async () => {
    // The classifier guards what a writer does; a reader has nothing for it to guard,
    // and the composer's own MCP calls must not meet it.
    const lib = await loadFrom(FIXTURE)
    await flowWith(lib, (log) => {
      expect(stepRuns(log).map((r) => r.permission)).toEqual(["auto", "full"])
      expect(new Set(composerRuns(log).map((r) => r.permission))).toEqual(new Set(["full"]))
    })
  })
})
