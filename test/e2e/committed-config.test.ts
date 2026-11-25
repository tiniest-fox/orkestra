// Under an external store, the engine's `.orkestra/` is the commit `origin`'s default branch
// names in the cache checkout — read at boot, and again whenever a git call moves that
// branch — never the directory the engine was started in.
//
// Real git throughout: an origin, the start directory cloned from it and left behind, a
// clone elsewhere standing in for the forge and for anybody else pushing, and the cache
// checkout the engine makes. What is worth knowing is which commit's files the engine holds
// after git moved, which no fake `Vcs` can say. The layers are the ones `engineLayers`
// wires: `ProjectFilesLayer` with the cache, `GitCliLayer` under `refreshingVcs`, and
// `HostGitLayer` over it.

import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Logger, Schedule, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { HealthDto } from "@orkestra/shared/dto/host-engine"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { Process } from "../../src/agent/ports/process.js"
import { Lib } from "../../src/library/ports/library.js"
import { HostGit, HostGitLayer } from "../../src/app/host-git.js"
import { SHIPPED_AGENTS, TEMPLATES } from "../../src/app/packaged.js"
import { ProjectFilesLayer, refreshingVcs } from "../../src/app/project-files.js"
import { hostRoutes } from "../../src/app/routes/host.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { NO_RUNNER_FILES } from "../../src/vcs/ports/runners.js"
import { ProjectFiles, withProjectFiles } from "../../src/workflow/ports/project-files.js"
import { addOrigin, git } from "../support/git.js"
import { serving } from "../support/http.js"
import { memoryPush } from "../support/push-memory.js"

const SETUP = ".orkestra/worktrees/setup.sh"

/** A setup script that says which one it is. */
const setupSaying = (said: string): string =>
  `#!/bin/bash\n# ---\n# description: Says which script this is.\n# ---\n\necho ${said}\n`

/** An agent file the loader refuses: its frontmatter is not YAML. */
const BROKEN = "---\ndescription: [unclosed\n---\n\nBody.\n"

/** `files` written into `repo` — `undefined` removing one — and committed. The commit. */
const committed = (
  repo: string,
  files: Readonly<Record<string, string | undefined>>,
  message: string,
): string => {
  for (const [path, text] of Object.entries(files)) {
    if (text === undefined) {
      rmSync(join(repo, path))
      continue
    }
    mkdirSync(join(repo, path, ".."), { recursive: true })
    writeFileSync(join(repo, path), text)
    if (path.endsWith(".sh")) chmodSync(join(repo, path), 0o755)
  }
  git(repo, "add", "-A")
  git(repo, "commit", "--quiet", "-m", message)
  return git(repo, "rev-parse", "HEAD")
}

/** The same, on `main` brought up to `origin`'s, and pushed there. */
const pushed = (
  repo: string,
  files: Readonly<Record<string, string | undefined>>,
  message: string,
): string => {
  git(repo, "pull", "--quiet", "--ff-only")
  const commit = committed(repo, files, message)
  git(repo, "push", "--quiet", "origin", "main")
  return commit
}

/**
 * A project whose first commit holds a setup script saying `v1`, pushed to an origin of its
 * own, and the place its cache checkout goes. The start directory is never pulled again.
 */
const project = (): Project => {
  const start = mkdtempSync(join(tmpdir(), "orkestra-committed-"))
  git(start, "init", "--quiet", "--initial-branch=main")
  git(start, "config", "user.email", "test@example.com")
  git(start, "config", "user.name", "Test")
  mkdirSync(join(start, ".orkestra", "worktrees"), { recursive: true })
  writeFileSync(join(start, SETUP), setupSaying("v1"))
  chmodSync(join(start, SETUP), 0o755)
  git(start, "add", "-A")
  git(start, "commit", "--quiet", "-m", "initial")
  const origin = addOrigin(start)
  const cache = join(mkdtempSync(join(tmpdir(), "orkestra-cache-")), "cache")
  return { start, elsewhere: origin.elsewhere, cache, credential: {} }
}

/**
 * The same, but `origin` is a forge's address git can reach only with what the Process the
 * seams provide adds to each spawn — as Orkestra Cloud's reaches GitHub only with its token.
 */
const forgeProject = (): Project => {
  const p = project()
  const real = git(p.start, "remote", "get-url", "origin")
  const forge = "https://forge.invalid/project.git"
  git(p.start, "remote", "set-url", "origin", forge)
  return {
    ...p,
    credential: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${real}.insteadOf`,
      GIT_CONFIG_VALUE_0: forge,
    },
  }
}

interface Project {
  readonly start: string
  readonly elsewhere: string
  readonly cache: string
  readonly credential: Readonly<Record<string, string>>
}

/**
 * What the engine's log took, by line, how many reads the runner reader was asked for, and
 * every git command the Process the seams provide was handed, as its arguments joined.
 */
interface Watched {
  readonly lines: string[]
  reads: number
  readonly gits: string[]
}

/**
 * The Process the seams provide, as a hosted engine's is built: over the library, whose
 * runner files it reads. The node layer beneath, every git command it spawns kept in `watched`,
 * and each handed `credential` — what a hosted engine's adds to reach its forge.
 */
const seamsProcess = (watched: Watched, credential: Readonly<Record<string, string>> = {}) =>
  Layer.effect(
    Process,
    Effect.gen(function* () {
      yield* Lib
      const inner = yield* Process
      return {
        ...inner,
        spawn: (spec) =>
          Effect.zipRight(
            Effect.sync(() => {
              if (spec.command === "git") watched.gits.push(spec.args.join(" "))
            }),
            inner.spawn({ ...spec, env: { ...spec.env, ...credential } }),
          ),
      }
    }),
  ).pipe(Layer.provide(NodeProcessLayer))

/** The layers `engineLayers` wires for the library and git, over `p`'s cache checkout. */
const engineOver = (p: Project, watched: Watched) => {
  const files = ProjectFilesLayer(
    p.start,
    SHIPPED_AGENTS,
    TEMPLATES,
    () =>
      Effect.sync(() => {
        watched.reads += 1
        return NO_RUNNER_FILES
      }),
    p.cache,
  )
  const proc = seamsProcess(watched, p.credential).pipe(Layer.provide(files))
  const vcs = refreshingVcs(GitCliLayer(p.start, p.cache)).pipe(
    Layer.provide(Layer.merge(proc, files)),
  )
  return Layer.mergeAll(files, vcs, HostGitLayer.pipe(Layer.provide(vcs)))
}

/** Run `body` over a booted engine for `p`, every log line it writes kept in `watched`. */
const booted = <A, E>(
  p: Project,
  watched: Watched,
  body: Effect.Effect<A, E, Layer.Layer.Success<ReturnType<typeof engineOver>>>,
) =>
  body.pipe(
    Effect.provide(engineOver(p, watched)),
    Effect.provide(
      Logger.replace(
        Logger.defaultLogger,
        Logger.make(({ message }) => {
          watched.lines.push(Array.isArray(message) ? message.join(" ") : String(message))
        }),
      ),
    ),
    Effect.scoped,
    Effect.runPromise,
  )

const watching = (): Watched => ({ lines: [], reads: 0, gits: [] })

/** What the next unit of work would run as its setup script: the held library's, run. */
const setupRun = withProjectFiles(
  Effect.map(Lib, (lib) =>
    lib.setup === undefined
      ? "no setup"
      : execFileSync("bash", [lib.setup.path], { encoding: "utf8" }).trim(),
  ),
)

const health = Effect.gen(function* () {
  const push = yield* memoryPush
  const { call } = serving(hostRoutes())
  const response = yield* Effect.provide(
    call(new Request("http://localhost/api/health")),
    push.layer,
  )
  const body: unknown = yield* Effect.promise(() => toWeb(response).json())
  return Schema.decodeUnknownSync(HealthDto)(body)
})

/** The commit the engine holds, read until it is `commit` — a refresh forked off a merge lands on its own time. */
const holding = (commit: string) =>
  Effect.flatMap(ProjectFiles, (files) =>
    files.served.pipe(
      Effect.filterOrFail((served) => served?.commit === commit),
      Effect.retry(Schedule.spaced("20 millis").pipe(Schedule.upTo("10 seconds"))),
    ),
  )

const refusals = (watched: Watched) => watched.lines.filter((l) => l.includes("would not load"))

describe("the engine's .orkestra/ under an external store", () => {
  it("runs a setup script merged to the default branch at the next trak's setup, with no restart and no pull", async () => {
    const p = project()
    const said = await booted(
      p,
      watching(),
      Effect.gen(function* () {
        expect(yield* setupRun).toBe("v1")
        // The forge merging a trak's pull request, which is what the engine's Merge asks of it.
        git(p.elsewhere, "checkout", "--quiet", "-b", "trak/fix-setup")
        committed(p.elsewhere, { [SETUP]: setupSaying("v2") }, "fix setup")
        git(p.elsewhere, "checkout", "--quiet", "main")
        git(
          p.elsewhere,
          "merge",
          "--quiet",
          "--no-ff",
          "-m",
          "Merge trak/fix-setup",
          "trak/fix-setup",
        )
        git(p.elsewhere, "push", "--quiet", "origin", "main")
        const tip = git(p.elsewhere, "rev-parse", "HEAD")
        yield* (yield* HostGit).afterMerge("main")
        yield* holding(tip)
        return yield* setupRun
      }),
    )
    expect(said).toBe("v2")
  })

  it("holds what origin has moved to once Pull is pressed", async () => {
    const p = project()
    const after = await booted(
      p,
      watching(),
      Effect.gen(function* () {
        const tip = pushed(p.elsewhere, { [SETUP]: setupSaying("pulled") }, "move on")
        // Not before the press: a commit on origin is not a commit the engine has seen.
        expect(yield* setupRun).toBe("v1")
        yield* (yield* HostGit).pull({ stash: false })
        return { tip, setup: yield* setupRun, served: yield* (yield* ProjectFiles).served }
      }),
    )
    expect(after.setup).toBe("pulled")
    expect(after.served).toEqual({ commit: after.tip })
  })

  it("boots holding origin's files when the start directory and the cache are behind it", async () => {
    const p = project()
    // A first boot makes the cache checkout, which then falls behind with the start directory.
    expect(await booted(p, watching(), setupRun)).toBe("v1")
    pushed(p.elsewhere, { [SETUP]: setupSaying("origin") }, "move on")
    expect(git(p.start, "show", `HEAD:${SETUP}`)).toContain("v1")
    expect(await booted(p, watching(), setupRun)).toBe("origin")
  })

  it("clones and fetches the cache checkout at boot through the Process the seams provide", async () => {
    const p = forgeProject()
    const first = watching()
    await booted(p, first, Effect.void)
    expect(first.gits.filter((g) => g.startsWith("clone"))).toHaveLength(1)
    const tip = pushed(p.elsewhere, { [SETUP]: setupSaying("fetched") }, "move on")
    const second = watching()
    const after = await booted(
      p,
      second,
      Effect.gen(function* () {
        return { setup: yield* setupRun, served: yield* (yield* ProjectFiles).served }
      }),
    )
    expect(second.gits).toContain("fetch --quiet origin")
    expect(after).toEqual({ setup: "fetched", served: { commit: tip } })
  })
})

describe("a default branch whose .orkestra/ will not load", () => {
  it("keeps serving through a default branch that will not load, reports it, and clears it once a good one lands", async () => {
    const p = project()
    const watched = watching()
    await booted(
      p,
      watched,
      Effect.gen(function* () {
        const before = yield* (yield* ProjectFiles).served
        const bad = pushed(p.elsewhere, { ".orkestra/agents/broken.md": BROKEN }, "break it")
        yield* (yield* HostGit).fetch
        expect(yield* setupRun).toBe("v1")
        expect(yield* (yield* ProjectFiles).served).toMatchObject({ commit: before?.commit })
        expect(refusals(watched)).toHaveLength(1)
        expect(refusals(watched)[0]).toContain("agents/broken.md: invalid YAML")
        const refused = (yield* health).config?.refused
        expect(refused).toMatchObject({ commit: bad })
        expect(refused?.reason).toContain("agents/broken.md: invalid YAML")
        // Asked again at the next fetch, the same commit is not read or logged again.
        yield* (yield* HostGit).fetch
        expect(refusals(watched)).toHaveLength(1)

        const fixed = pushed(
          p.elsewhere,
          { ".orkestra/agents/broken.md": undefined, [SETUP]: setupSaying("fixed") },
          "fix it",
        )
        yield* (yield* HostGit).fetch
        expect(yield* setupRun).toBe("fixed")
        expect((yield* health).config).toEqual({ commit: fixed })
      }),
    )
  })

  it("keeps the start directory's files over a default branch that will not load at the first boot, and reports why", async () => {
    const p = project()
    const bad = pushed(p.elsewhere, { ".orkestra/agents/broken.md": BROKEN }, "break it")
    const watched = watching()
    const seen = await booted(
      p,
      watched,
      Effect.gen(function* () {
        const { library } = yield* (yield* ProjectFiles).current
        return {
          setup: library.setup,
          agents: [...library.agents.keys()],
          config: (yield* health).config,
        }
      }),
    )
    // The boot read the start directory, for there was no cache checkout yet; the read of
    // origin's commit once the git layer had made one was refused, and the read held stays.
    expect(seen.setup?.path).toBe(join(p.start, SETUP))
    expect(seen.agents).toContain("build")
    expect(seen.config?.commit).toBeUndefined()
    expect(seen.config?.refused).toMatchObject({ commit: bad })
    expect(seen.config?.refused?.reason).toContain("agents/broken.md: invalid YAML")
    expect(refusals(watched)).toHaveLength(1)
  })

  it("reads and logs nothing for a fetch that leaves the default branch where it was", async () => {
    const p = project()
    const watched = watching()
    await booted(
      p,
      watched,
      Effect.gen(function* () {
        const reads = watched.reads
        const lines = watched.lines.length
        yield* (yield* HostGit).fetch
        yield* (yield* HostGit).fetch
        expect(watched.reads).toBe(reads)
        expect(watched.lines).toHaveLength(lines)
      }),
    )
  })
})

describe("the engine's .orkestra/ with no external store", () => {
  it("reports no config on /api/health", async () => {
    const p = project()
    const config = await health.pipe(
      Effect.provide(ProjectFilesLayer(p.start, SHIPPED_AGENTS, TEMPLATES)),
      Effect.map((answer) => answer.config),
      Effect.runPromise,
    )
    expect(config).toBeUndefined()
  })
})
