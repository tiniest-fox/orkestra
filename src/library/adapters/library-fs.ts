// The only Layer here: read a `.orkestra` directory off disk, at startup and again on a reload.
//
// Exported as a FUNCTION of the starting directory rather than a value, because
// which project we are loading is runtime input — a CLI is invoked from wherever
// the user happens to be standing.
//
// This file decides only WHICH files to read. Every rule about what a valid
// library is lives in logic/assemble.ts, where it is pure.

import { access, readFile, readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { Effect, Layer } from "effect"
import { SKILL_DIRS } from "../logic/agent-file.js"
import {
  assembleLibrary,
  checkoutProcesses,
  type Layered,
  type LibrarySource,
  type ScriptSource,
  type ShippedSource,
  type TextSource,
  type TreeSource,
} from "../logic/assemble.js"
import { overlay } from "../logic/overlay.js"
import { Lib } from "../ports/library.js"
import { GENERIC } from "../types/agent.js"
import { LoadFailed } from "../types/errors.js"
import type { Library } from "../types/library.js"
import type { CheckoutProcesses, HostedProcess } from "../types/process.js"

const DIR = ".orkestra"
/**
 * A person's private mirror of the directory, dot-prefixed because it is kept out
 * of git by `Vcs.ensureIgnored` like the runtime directories beside it — but it is
 * policy a person writes, not data the tool leaves. Read by the same walk as the
 * directory it sits in, and merged over it by `overlay`.
 */
const LOCAL = ".local"
const AGENTS = "agents"
const CHECKS = "checks"
const PROCESSES = "processes"
const TOOLS = "tools"
/**
 * The directory, not the file: presence is a lookup in `entries`, and the two
 * scripts inside it are entries of the map `readScripts` returns. `.worktrees/`
 * beside it is where the checkouts go — policy without the dot, runtime data
 * with it, the same split as `.database/`.
 */
const WORKTREES = "worktrees"
const DEPLOY = "deploy.sh"
const FLEET = "fleet.yaml"

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const list = (full: string, shown: string): Effect.Effect<readonly string[], LoadFailed> =>
  Effect.tryPromise({
    try: () => readdir(full),
    catch: (cause) => new LoadFailed({ path: shown, reason: why(cause) }),
  })

/** The subdirectories of `full`, by name — a skill is a directory, so a file beside one is not. */
const listDirs = (full: string, shown: string): Effect.Effect<readonly string[], LoadFailed> =>
  Effect.tryPromise({
    try: async () =>
      (await readdir(full, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    catch: (cause) => new LoadFailed({ path: shown, reason: why(cause) }),
  })

const readText = (full: string, shown: string): Effect.Effect<string, LoadFailed> =>
  Effect.tryPromise({
    try: () => readFile(full, "utf8"),
    catch: (cause) => new LoadFailed({ path: shown, reason: why(cause) }),
  })

interface Found {
  readonly root: string
  /** Listed once, so presence is a lookup rather than a caught ENOENT. */
  readonly entries: readonly string[]
  /**
   * What a path under `root` is called in an error: `""` for `.orkestra/` itself,
   * `.local/` for the overlay inside it, `shipped/` for the engine's own — so the same
   * `agents/x.md` is told apart.
   */
  readonly shown: "" | ".local/" | "shipped/"
}

/**
 * Walks up from `start` the way git finds `.git`, so `ork` works from any
 * subdirectory of a project.
 */
const findRoot = (start: string): Effect.Effect<Found, LoadFailed> => {
  const step = (from: string): Effect.Effect<Found, LoadFailed> => {
    const root = join(from, DIR)
    return Effect.catchAll(
      Effect.map(list(root, root), (entries): Found => ({ root, entries, shown: "" })),
      () => {
        const up = dirname(from)
        return up === from
          ? Effect.fail(
              new LoadFailed({
                path: start,
                reason: `no ${DIR}/ directory here or in any parent directory.`,
              }),
            )
          : step(up)
      },
    )
  }
  return step(resolve(start))
}

/**
 * The `.orkestra` directory itself, found by the same walk-up `FsLibraryLayer`
 * uses. Exported so `store-file.ts` and `runs-file.ts` cannot disagree with the
 * library about which project a command is running against — both ask this
 * question the same way `.git` is found.
 */
export const orkestraDir = (start: string): Effect.Effect<string, LoadFailed> =>
  Effect.map(findRoot(start), (f) => f.root)

/**
 * Every `*.md` in one subdirectory, keyed by filename without the extension. `shown`
 * is the path relative to `.orkestra/` — `.local/agents/x.md` for the overlay — and
 * travels with the text because an error has to name the file a person would open.
 */
const readDefinitions = Effect.fn("readDefinitions")(function* (found: Found, sub: string) {
  const dir = join(found.root, sub)
  const files = (yield* list(dir, sub)).filter((f) => f.endsWith(".md"))
  const texts = yield* Effect.forEach(files, (f) =>
    readText(join(dir, f), `${found.shown}${sub}/${f}`),
  )
  return new Map(
    files.map((f, i): [string, TextSource] => [
      f.slice(0, -".md".length),
      { shown: `${found.shown}${sub}/${f}`, text: texts[i] ?? "" },
    ]),
  )
})

/**
 * Every `*.sh` in one subdirectory, with its path.
 *
 * Unlike a definition, a check is not only read — it is spawned, so where it
 * lives is part of what it is. This is the only place a `.orkestra` path escapes
 * the adapter, and it goes into `Check.path` rather than into anything pure.
 */
const readScripts = Effect.fn("readScripts")(function* (found: Found, sub: string) {
  const dir = join(found.root, sub)
  const files = (yield* list(dir, sub)).filter((f) => f.endsWith(".sh"))
  const texts = yield* Effect.forEach(files, (f) =>
    readText(join(dir, f), `${found.shown}${sub}/${f}`),
  )
  return new Map(
    files.map((f, i): [string, ScriptSource] => [
      f.slice(0, -".sh".length),
      { shown: `${found.shown}${sub}/${f}`, path: join(dir, f), text: texts[i] ?? "" },
    ]),
  )
})

/**
 * What a trak's checkout declares under `.orkestra/processes/`, over the project's
 * `project`, read on every call so a script an agent adds is the next start's. Read at
 * `checkout` itself rather than walked up to, because the checkout is known. Never
 * fails: a checkout without the directory declares nothing of its own, and one that
 * cannot be read is one unreadable entry beside the project's processes.
 */
export const readCheckoutProcesses = (
  checkout: string,
  project: ReadonlyMap<string, HostedProcess>,
): Effect.Effect<CheckoutProcesses> =>
  Effect.gen(function* () {
    const root = join(checkout, DIR)
    const present = yield* Effect.promise(() =>
      access(join(root, PROCESSES)).then(
        () => true,
        () => false,
      ),
    )
    if (!present) return checkoutProcesses(project, new Map())
    const found: Found = { root, entries: [PROCESSES], shown: "" }
    return yield* readScripts(found, PROCESSES).pipe(
      Effect.map((files) => checkoutProcesses(project, files)),
      Effect.catchTag("LoadFailed", (e) =>
        Effect.succeed({
          processes: project,
          unreadable: [{ name: PROCESSES, shown: e.path, reason: e.reason }],
        }),
      ),
    )
  })

/** Where a checkout's own process declarations are, relative to the checkout. */
export const CHECKOUT_PROCESSES = `${DIR}/${PROCESSES}`

/**
 * `readCheckoutProcesses` from texts read elsewhere — a checkout in a sandbox, whose
 * `.orkestra/processes/` was copied out as `texts` by each file's name there. Only a
 * `*.sh` directly in it declares a process, as on disk; `checkout` is the path the
 * scripts are run at, which the sandbox shares.
 */
export const checkoutProcessesOf = (
  checkout: string,
  project: ReadonlyMap<string, HostedProcess>,
  texts: ReadonlyMap<string, string>,
): CheckoutProcesses =>
  checkoutProcesses(
    project,
    new Map(
      [...texts]
        .filter(([name]) => name.endsWith(".sh") && !name.includes("/"))
        .map(([name, text]): [string, ScriptSource] => [
          name.slice(0, -".sh".length),
          {
            shown: `${PROCESSES}/${name}`,
            path: join(checkout, CHECKOUT_PROCESSES, name),
            text,
          },
        ]),
    ),
  )

/**
 * Reads only the files it knows and ignores every other entry — deliberately the
 * opposite of how an agent file is parsed, where an unknown key is an error. A
 * real `.orkestra/` also holds `workflow.yaml`, `.database/` and `.worktrees/`
 * from today's engine; a directory is a shared space, a file is a contract.
 *
 * That is also why `skills/` needs nothing here: the skills an agent file names are
 * the repository's, found by `readSkills` beside `.orkestra/` rather than in it.
 *
 * One function for both trees: `.local/` mirrors `.orkestra/`, so what is read
 * from each is the same list of names.
 */
const readTree = Effect.fn("readTree")(function* (found: Found) {
  const optional = (name: string): Effect.Effect<string | undefined, LoadFailed> =>
    found.entries.includes(name)
      ? readText(join(found.root, name), `${found.shown}${name}`)
      : Effect.succeed(undefined)

  // Absent is normal for both: a worktree used as git left it is right for a project
  // whose checks need nothing installed, and inheriting the engine's environment is
  // right for one whose toolchain is already on its PATH.
  const worktrees = found.entries.includes(WORKTREES)
    ? yield* readScripts(found, WORKTREES)
    : new Map<string, ScriptSource>()
  const tree: TreeSource = {
    // Absent produces an empty map rather than failing here, so the message a
    // human reads comes from `assembleLibrary` — which is where every other rule
    // about what a valid library is already lives.
    agents: found.entries.includes(AGENTS)
      ? yield* readDefinitions(found, AGENTS)
      : new Map<string, TextSource>(),
    // Absent is normal: a project that declares no checks has no agent naming
    // one, which is what every project did before checks existed.
    checks: found.entries.includes(CHECKS)
      ? yield* readScripts(found, CHECKS)
      : new Map<string, ScriptSource>(),
    // Absent is normal: most projects keep no server running for a trak.
    processes: found.entries.includes(PROCESSES)
      ? yield* readScripts(found, PROCESSES)
      : new Map<string, ScriptSource>(),
    // Absent is normal: a sandbox's template already carries what most projects call.
    tools: found.entries.includes(TOOLS)
      ? yield* readScripts(found, TOOLS)
      : new Map<string, ScriptSource>(),
    setup: worktrees.get("setup"),
    teardown: worktrees.get("teardown"),
    env: worktrees.get("env"),
    // At the root rather than under `worktrees/`: it runs in no worktree, and its
    // presence is the switch that turns the `deployed` condition on.
    deploy: found.entries.includes(DEPLOY)
      ? {
          shown: `${found.shown}${DEPLOY}`,
          path: join(found.root, DEPLOY),
          text: yield* readText(join(found.root, DEPLOY), `${found.shown}${DEPLOY}`),
        }
      : undefined,
    fleet: found.entries.includes(FLEET)
      ? {
          shown: `${found.shown}${FLEET}`,
          text: yield* readText(join(found.root, FLEET), `${found.shown}${FLEET}`),
        }
      : undefined,
    models: yield* optional("models.yaml"),
    composition: yield* optional("COMPOSITION.md"),
    goals: yield* optional("GOALS.md"),
    guidance: yield* optional("ORKESTRA.md"),
  }
  return tree
})

/**
 * The engine's own directory: `generic.md`, and the fleet and scripts every project
 * starts from. Read by absolute path rather than found — it is ours, so a missing
 * `generic.md` is a broken install and `readText` says so. `agents/` and `checks/` may be
 * absent, which is a build that ships no fleet.
 */
const readShipped = Effect.fn("readShipped")(function* (shipped: string) {
  const found: Found = {
    root: shipped,
    entries: yield* list(shipped, "shipped/"),
    shown: "shipped/",
  }
  const source: ShippedSource = {
    agents: found.entries.includes(AGENTS)
      ? yield* readDefinitions(found, AGENTS)
      : new Map<string, TextSource>(),
    checks: found.entries.includes(CHECKS)
      ? yield* readScripts(found, CHECKS)
      : new Map<string, ScriptSource>(),
    generic: yield* readText(join(shipped, `${GENERIC}.md`), `shipped/${GENERIC}.md`),
  }
  return source
})

/**
 * The repository's skills: every directory under one of `SKILL_DIRS` holding a
 * `SKILL.md`, name -> that file relative to `repo`, the earlier directory winning a name
 * both hold. Only listed, never read — an agent opens the file itself, in its own
 * checkout. A directory that is absent, at any depth, holds none.
 */
const readSkills = Effect.fn("readSkills")(function* (repo: string) {
  const skills = new Map<string, string>()
  for (const dir of SKILL_DIRS) {
    let at = repo
    let present = true
    for (const part of dir.split("/")) {
      if (!(yield* list(at, dir)).includes(part)) {
        present = false
        break
      }
      at = join(at, part)
    }
    if (!present) continue
    for (const name of [...(yield* listDirs(at, dir))].sort()) {
      const holds = (yield* list(join(at, name), `${dir}/${name}`)).includes("SKILL.md")
      if (holds && !skills.has(name)) skills.set(name, `${dir}/${name}/SKILL.md`)
    }
  }
  return skills
})

/** `build: shipped/agents/build.md, then agents/build.md (model, checks)` — one line per role. */
const describeLayers = (role: Layered): string => {
  const [bottom, ...over] = role.layers
  const above = over.map((l) => `${l.shown} (${l.fields.join(", ")})`).join(", then ")
  return `${role.name}: ${bottom?.shown ?? ""}, then ${above}`
}

/**
 * The shipped fleet, the team's tree and the overlay's when there is one, lined up — with
 * every script another hides written to the log. The log is the only place a shadow is
 * reported, so it is written here, where which file came from where is still known.
 *
 * A script over the engine's is how a project replaces one, so it is information; over
 * the team's it is a copy the team will keep improving while traks here run the old one,
 * which is worth a warning.
 */
const readSource = Effect.fn("readSource")(function* (found: Found, shipped: string) {
  const team = yield* readTree(found)
  const localRoot = join(found.root, LOCAL)
  const local = found.entries.includes(LOCAL)
    ? yield* readTree({
        root: localRoot,
        entries: yield* list(localRoot, LOCAL),
        shown: `${LOCAL}/`,
      })
    : undefined
  const repo = dirname(found.root)
  const { source, shadows } = overlay(yield* readShipped(shipped), team, local, repo)
  yield* Effect.forEach(shadows, (s) =>
    s.under.startsWith("shipped/")
      ? Effect.logInfo(`${DIR}/${s.over} replaces the engine's ${s.under}`)
      : Effect.logWarning(
          `${DIR}/${s.over} shadows ${DIR}/${s.under} for every trak this engine runs`,
        ),
  )
  const skills: LibrarySource = { ...source, skills: yield* readSkills(repo) }
  return skills
})

/**
 * `shipped` is the directory holding the engine's own agent files and scripts. It is handed in
 * rather than resolved here because it ships inside the package, not the project:
 * `process.cwd()` is the user's repository and never holds it, and where the package
 * is depends on whether this runs from the checkout or from a bundle — which is
 * `app/packaged.ts`'s to say.
 *
 * The whole read, from the walk-up to the assembled library: what a boot does, and what
 * a reload does again.
 */
export const loadLibrary = (
  startDir: string,
  shipped: string,
): Effect.Effect<Library, LoadFailed> =>
  findRoot(startDir).pipe(
    Effect.flatMap((found) => readSource(found, shipped)),
    Effect.flatMap((source) => assembleLibrary(source)),
    // One line per role more than one file speaks for, naming the fields each file
    // sets: a repo layering its whole fleet would otherwise log a shadow per file.
    Effect.tap(({ layered }) =>
      Effect.forEach(layered, (role) => Effect.logInfo(`layered ${describeLayers(role)}`)),
    ),
    Effect.map(({ library }) => library),
  )

/**
 * Fails loudly at startup rather than at the moment a trak needs an agent — a
 * half-loaded library would otherwise surface as a composer that keeps proposing
 * agents the engine rejects.
 */
export const FsLibraryLayer = (startDir: string, shipped: string): Layer.Layer<Lib, LoadFailed> =>
  Layer.effect(Lib, loadLibrary(startDir, shipped))
