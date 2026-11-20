// logic: the text of a `.orkestra` directory -> a validated Library.
//
// Every rule about what a valid library IS lives here, where it is pure and
// cheap to test. The adapter above it only decides which files to read.
//
// Policy errors are a human's typo, so they fail HERE — before a trak starts —
// rather than as a re-prompt in the middle of a composer's turn.

import { Either, Schema } from "effect"
import { BARE_CLI, CLI_EFFORTS } from "../../agent/types/effort.js"
import { splitModel } from "../../agent/logic/qualified-model.js"
import { type Agent, GENERIC } from "../types/agent.js"
import { type Check, ENGINE_CONDITIONS, engineCondition, WAIT_UNTIL } from "../types/check.js"
import { LoadFailed } from "../types/errors.js"
import type { Library, ModelRegistry } from "../types/library.js"
import type { CheckoutProcesses, HostedProcess, UnreadableProcess } from "../types/process.js"
import type { SandboxTool } from "../types/tool.js"
import { type AgentLayer, fieldsSet, readLayer, resolveAgent, shippedLayer } from "./agent-file.js"
import { parseCheck } from "./check-file.js"
import { parseMcpFile } from "./mcp-file.js"
import { parseProcess } from "./process-file.js"
import { parseTool } from "./tool-file.js"
import { parseYaml } from "./yaml.js"

/**
 * A definition file with the path a person would open, relative to `.orkestra/`.
 *
 * Carried rather than derived from the name, because the same name is a different
 * file in `agents/` and in `.local/agents/`, and an error about one of them has to
 * say which.
 */
export interface TextSource {
  readonly shown: string
  readonly text: string
}

/** A script the runner has to be able to spawn, so its absolute path travels too. */
export interface ScriptSource extends TextSource {
  readonly path: string
}

/**
 * What one directory holds — `.orkestra/` itself, or the `.local/` inside it, which
 * mirrors it and is read the same way. `undefined` means the file is absent.
 */
export interface TreeSource {
  /** Agent name (the filename, without `.md`) -> the file. */
  readonly agents: ReadonlyMap<string, TextSource>
  /** Check name (the filename, without `.sh`) -> the file. */
  readonly checks: ReadonlyMap<string, ScriptSource>
  /** Hosted process name (the filename, without `.sh`) -> the file. */
  readonly processes: ReadonlyMap<string, ScriptSource>
  /** Sandbox tool name (the filename, without `.sh`) -> the file. */
  readonly tools: ReadonlyMap<string, ScriptSource>
  /** `worktrees/setup.sh`, run once in each new worktree. */
  readonly setup: ScriptSource | undefined
  /** `worktrees/teardown.sh`, run in each worktree before it is removed. */
  readonly teardown: ScriptSource | undefined
  /** `worktrees/env.sh`, sourced before every spawn in a worktree. */
  readonly env: ScriptSource | undefined
  /** `deploy.sh`, what answers the `deployed` condition. */
  readonly deploy: ScriptSource | undefined
  /** `models.yaml` */
  readonly models: string | undefined
  /** `mcp.yaml` — the MCP servers every session in the project dials. */
  readonly mcp: string | undefined
  /** `COMPOSITION.md` */
  readonly composition: string | undefined
  /** `GOALS.md` */
  readonly goals: string | undefined
  /** `ORKESTRA.md` */
  readonly guidance: string | undefined
  /** `fleet.yaml` — which shipped roles this project turns off. */
  readonly fleet: TextSource | undefined
}

/** What the engine carries in `src/library/shipped/`, read the way a project's tree is. */
export interface ShippedSource {
  /** `shipped/agents/*.md` — the fleet every project starts from. */
  readonly agents: ReadonlyMap<string, TextSource>
  /** `shipped/checks/*.sh` — scripts a shipped role may name, which a project's replaces. */
  readonly checks: ReadonlyMap<string, ScriptSource>
  /** `shipped/generic.md`. See `LibrarySource.generic`. */
  readonly generic: string
}

/** Every file for one role name, bottom layer first. */
export interface AgentFiles {
  readonly shipped: TextSource | undefined
  /** The team's file, then the local one — whichever of the two exist. */
  readonly repo: readonly TextSource[]
}

/**
 * What the assembler validates: the shipped fleet and the two trees already lined up by
 * `overlay`, plus the files that are not a tree's to settle.
 */
export interface LibrarySource extends Omit<TreeSource, "agents"> {
  /**
   * Role name -> its files. Not merged yet: merging is parsing, and parsing is this
   * module's, so `overlay` only lines the layers up.
   */
  readonly agents: ReadonlyMap<string, AgentFiles>
  /**
   * The names in `shipped/checks/`, which a shipped role's `effects:` is checked against.
   * The scripts themselves are already in `checks`, under any project script that
   * replaces one.
   */
  readonly shippedChecks: readonly string[]
  /** The directory holding `.orkestra/`. See `Library.root`. */
  readonly root: string
  /**
   * The repository's skills: name -> its `SKILL.md`, relative to `root`, the first
   * directory in `SKILL_DIRS` winning. Read beside the trees rather than in them —
   * a skill belongs to the repository, not to `.orkestra/` or to one person's overlay.
   */
  readonly skills: ReadonlyMap<string, string>
  /**
   * `src/library/shipped/generic.md` — the one agent file the engine carries, in the
   * same format as a project's and read from inside the package rather than found in
   * the project. Not optional: every library has it, and a project cannot remove it.
   */
  readonly generic: string
  /**
   * `.local/models.yaml`. The one local file that is merged rather than chosen, so it
   * reaches the assembler beside the team's instead of in its place: its `models:` are
   * laid over the team's and its `default:` overrides it, and the rule needs both files
   * parsed to apply.
   */
  readonly localModels: string | undefined
}

/**
 * Used when `models.yaml` is absent. `sonnet` as the composer's model rather than
 * the top of the list: a project that never states a preference should not be
 * spending opus rates by omission, and an agent that genuinely needs more says so.
 * No efforts: every model runs at its CLI's own default.
 */
const DEFAULT_MODELS: ModelRegistry = {
  allowed: ["opus", "sonnet", "haiku"],
  efforts: new Map(),
  composer: "sonnet",
  windows: {},
}

/** `context_windows:` as written — model name to how many tokens its context holds. */
const Windows = Schema.Record({ key: Schema.String, value: Schema.Number })

/**
 * One model as the file lists it: the name its CLI knows it by, and the effort its
 * turns run at unless an agent file says otherwise.
 */
const ModelEntry = Schema.Struct({
  name: Schema.String,
  effort: Schema.optional(Schema.String),
})

/**
 * `models:` on disk — the CLI each model runs on is the key it is listed under, so
 * the file says it rather than a prefix encoding it. The key is checked against the
 * CLIs this build spawns, and each entry's `effort:` against that CLI's levels.
 */
const ModelGroups = Schema.Record({ key: Schema.String, value: Schema.NonEmptyArray(ModelEntry) })

const ModelsFile = Schema.Struct({
  default: Schema.String,
  models: ModelGroups,
  context_windows: Schema.optional(Windows),
})

/**
 * The same keys, all optional: a local file that only adds a model says nothing
 * about `default:`, and one that only switches the default lists nothing new.
 */
const LocalModelsFile = Schema.Struct({
  default: Schema.optional(Schema.String),
  models: Schema.optional(ModelGroups),
  context_windows: Schema.optional(Windows),
})

/**
 * `refused:` is the only key, and an unknown one is refused rather than ignored: a
 * misspelt `refuse:` would otherwise turn nothing off and say nothing.
 */
const FleetFile = Schema.Struct({ refused: Schema.optional(Schema.Array(Schema.String)) })

const MODELS = "models.yaml"
const LOCAL_MODELS = ".local/models.yaml"
const SHIPPED_GENERIC = `shipped/${GENERIC}.md`

/**
 * A `.md` file in `agents/` this loader will read at all: one that opens with `---`.
 *
 * **A directory is a shared space, a file is a contract** — the same rule
 * `library-fs.ts` applies to `.orkestra/` itself, one level down. Another engine
 * reading the same directory writes a brief with no frontmatter, and passing over
 * those is what lets both fleets sit in `agents/` while a project migrates.
 *
 * It stops at the header. A file that opens with `---` is claiming to be ours, so a bad
 * key, a missing field or unparseable YAML inside it is still fatal at startup — which
 * is every realistic typo. Only a file with no header at all is passed over, and that
 * is hard to do by accident.
 */
const HEADER = /^---\r?(?:\n|$)/

/**
 * The key `models:` replaced, refused by name rather than read as an alias: one shape
 * in the loader, and a project still on the old one fails at boot with the file named
 * and the shape to write, instead of loading with every effort silently absent.
 */
const RANKED = "ranked"

const SHAPE =
  "`models:` grouped by CLI, each entry a `name:` and an optional `effort:` — e.g.\n  models:\n    claude:\n      - name: opus\n        effort: high\n    codex:\n      - name: gpt-5.6-sol"

const refusesRanked = (path: string, parsed: unknown): Either.Either<void, LoadFailed> =>
  typeof parsed === "object" && parsed !== null && RANKED in parsed
    ? Either.left(
        new LoadFailed({
          path,
          reason: `\`${RANKED}:\` is no longer read. Write ${SHAPE}`,
        }),
      )
    : Either.void

/**
 * A window for a model `models:` does not list is the same typo `checkModel` catches
 * on an agent, and it fails the same way: at load, naming the file.
 */
const windowsListed = (
  path: string,
  allowed: readonly string[],
  windows: Readonly<Record<string, number>>,
): Either.Either<void, LoadFailed> => {
  const unlisted = Object.keys(windows).filter((m) => !allowed.includes(m))
  return unlisted.length === 0
    ? Either.void
    : Either.left(
        new LoadFailed({
          path,
          reason: `\`context_windows:\` names ${unlisted.map((m) => `\`${m}\``).join(", ")}, not in \`models:\` (${allowed.join(", ")}) — a window is stated for a model this project lists.`,
        }),
      )
}

/**
 * A model as the registry holds it: the name an agent file writes, and the effort it
 * declared. The name is the CLI's own for the bare group and `<cli>/<name>` for every
 * other — a plan entry already logged holds that string, so a model keeps the one
 * spelling it has always had.
 */
interface Listed {
  readonly name: string
  readonly effort: string | undefined
}

const listed = (
  path: string,
  groups: Schema.Schema.Type<typeof ModelGroups>,
): Either.Either<readonly Listed[], LoadFailed> =>
  Either.gen(function* () {
    const out: Listed[] = []
    for (const [cli, entries] of Object.entries(groups)) {
      const levels = CLI_EFFORTS.get(cli)
      if (levels === undefined) {
        return yield* Either.left<LoadFailed>(
          new LoadFailed({
            path,
            reason: `\`models:\` lists \`${cli}:\`, which is not a CLI this build spawns (${[...CLI_EFFORTS.keys()].join(", ")}).`,
          }),
        )
      }
      for (const entry of entries) {
        // The group already names the CLI, and a slash in the name would reach the
        // registry as a second qualifier.
        if (entry.name.includes("/")) {
          return yield* Either.left<LoadFailed>(
            new LoadFailed({
              path,
              reason: `\`name: ${entry.name}\` under \`${cli}:\` — the group names the CLI, so the name is bare.`,
            }),
          )
        }
        if (entry.effort !== undefined && !levels.includes(entry.effort)) {
          return yield* Either.left<LoadFailed>(
            new LoadFailed({
              path,
              reason: `\`effort: ${entry.effort}\` on \`${entry.name}\` is not a level \`${cli}\` accepts (${levels.join(", ")}).`,
            }),
          )
        }
        out.push({
          name: cli === BARE_CLI ? entry.name : `${cli}/${entry.name}`,
          effort: entry.effort,
        })
      }
    }
    return out
  })

/** Later entries replace earlier ones of the same name, which is how a local file overrides a team model's effort. */
const modelRegistry = (
  path: string,
  composer: string,
  models: readonly Listed[],
  windows: Readonly<Record<string, number>>,
): Either.Either<ModelRegistry, LoadFailed> =>
  Either.gen(function* () {
    const byName = new Map(models.map((m) => [m.name, m.effort]))
    const allowed = [...byName.keys()]
    if (!allowed.includes(composer)) {
      return yield* Either.left<LoadFailed>(
        new LoadFailed({
          path,
          reason: `\`default: ${composer}\` is not in \`models:\` (${allowed.join(", ")}) — the default has to be a model this project actually lists.`,
        }),
      )
    }
    yield* windowsListed(path, allowed, windows)
    const efforts = new Map<string, string>()
    for (const [name, effort] of byName) if (effort !== undefined) efforts.set(name, effort)
    return { allowed, efforts, composer, windows }
  })

/** The registry as a list again, so a local file can be laid over it entry by entry. */
const entriesOf = (models: ModelRegistry): readonly Listed[] =>
  models.allowed.map((name) => ({ name, effort: models.efforts.get(name) }))

const readTeamModels = (text: string | undefined): Either.Either<ModelRegistry, LoadFailed> =>
  text === undefined
    ? Either.right(DEFAULT_MODELS)
    : Either.gen(function* () {
        const parsed = yield* parseYaml(MODELS, text)
        yield* refusesRanked(MODELS, parsed)
        const file = yield* Either.mapLeft(
          Schema.decodeUnknownEither(ModelsFile)(parsed),
          (e) =>
            new LoadFailed({
              path: MODELS,
              reason: `expected \`default:\` and ${SHAPE}\n${e.message}`,
            }),
        )
        return yield* modelRegistry(
          MODELS,
          file.default,
          yield* listed(MODELS, file.models),
          file.context_windows ?? {},
        )
      })

/**
 * A local `models:` adds to the team's rather than replacing it, so a project agent
 * naming a team model still loads with the overlay in place — and an entry naming a
 * model the team lists replaces that one, which is how one person runs a team model at
 * another effort. A local `default:` wins, because it is the one thing a person running
 * locally most wants to switch. A local default has to be in the merged list, and the
 * file blamed is the local one.
 *
 * Local `context_windows:` lay over the team's model by model rather than entry by
 * entry, so switching one model's effort locally does not drop the window beside it.
 */
const readModels = (
  team: string | undefined,
  local: string | undefined,
): Either.Either<ModelRegistry, LoadFailed> =>
  Either.gen(function* () {
    const base = yield* readTeamModels(team)
    if (local === undefined) return base
    const parsed = yield* parseYaml(LOCAL_MODELS, local)
    yield* refusesRanked(LOCAL_MODELS, parsed)
    const file = yield* Either.mapLeft(
      Schema.decodeUnknownEither(LocalModelsFile)(parsed),
      (e) =>
        new LoadFailed({
          path: LOCAL_MODELS,
          reason: `expected \`default:\` and/or ${SHAPE}\n${e.message}`,
        }),
    )
    const added = file.models === undefined ? [] : yield* listed(LOCAL_MODELS, file.models)
    return yield* modelRegistry(
      LOCAL_MODELS,
      file.default ?? base.composer,
      [...entriesOf(base), ...added],
      { ...base.windows, ...file.context_windows },
    )
  })

/**
 * The shipped roles this project turns off. A name Orkestra does not ship stops the load:
 * it is a typo, or a project role somebody meant to delete, and either way refusing it
 * would turn nothing off.
 */
const readFleet = (
  file: TextSource | undefined,
  shipped: readonly string[],
): Either.Either<ReadonlySet<string>, LoadFailed> =>
  file === undefined
    ? Either.right(new Set())
    : Either.gen(function* () {
        // An empty file parses to `null`, and says as much as an absent one.
        const parsed = (yield* parseYaml(file.shown, file.text)) ?? {}
        const { refused = [] } = yield* Either.mapLeft(
          Schema.decodeUnknownEither(FleetFile, { onExcessProperty: "error" })(parsed),
          (e) =>
            new LoadFailed({
              path: file.shown,
              reason: `expected a \`refused:\` list of shipped role names, and nothing else.\n${e.message}`,
            }),
        )
        const unknown = refused.filter((name) => !shipped.includes(name))
        if (unknown.length === 0) return new Set(refused)
        const ships =
          shipped.length === 0 ? "This build ships none." : `It ships ${shipped.join(", ")}.`
        return yield* Either.left<LoadFailed>(
          new LoadFailed({
            path: file.shown,
            reason: `\`refused:\` names ${unknown.join(", ")}, which Orkestra does not ship — it turns off a shipped role, and a project's own role is turned off by deleting its file. ${ships}`,
          }),
        )
      })

/**
 * An agent's model is required and handed to the provider verbatim, so an
 * unlisted name is caught here instead of surfacing as a provider error mid-trak
 * — the one policy typo that costs a whole trak to discover.
 *
 * Its `effort:` is checked against the CLI that model runs on, for a worse version of
 * the same reason: a CLI handed a level it does not know warns and runs at its default
 * with exit 0, so nothing after this would ever report it.
 */
const checkModel = (
  a: Agent,
  shown: string,
  models: ModelRegistry,
): Either.Either<void, LoadFailed> => {
  if (!models.allowed.includes(a.model)) {
    return Either.left(
      new LoadFailed({
        path: shown,
        reason: `\`model: ${a.model}\` is not in ${MODELS} (${models.allowed.join(", ")}).`,
      }),
    )
  }
  if (a.effort === undefined) return Either.void
  const cli = splitModel(a.model).provider ?? BARE_CLI
  const levels = CLI_EFFORTS.get(cli) ?? []
  return levels.includes(a.effort)
    ? Either.void
    : Either.left(
        new LoadFailed({
          path: shown,
          reason: `\`effort: ${a.effort}\` is not a level \`${cli}\` accepts (${levels.join(", ")}).`,
        }),
      )
}

/**
 * A script an agent names has to exist. Validated here rather than at decode time
 * because nothing selects it at decode time: a bad name is a human's typo in a
 * policy file, not an agent's mistake for `elicit` to re-prompt on.
 *
 * One registry serves `checks:`, `effects:` and `conditions:`, so one function asks
 * about all three — what separates the lists is when they run and what a non-zero
 * exit means, and neither is a fact about the file being named. `conditions:` alone
 * may also name the two the engine answers, which no file backs: `merged` always,
 * and `deployed` where the project has a `deploy.sh`.
 */
const scriptNames = (
  a: Agent,
  shown: string,
  field: "checks" | "effects" | "conditions",
  checks: ReadonlyMap<string, Check>,
  deploy: Check | undefined,
): Either.Either<void, LoadFailed> => {
  const engine: readonly string[] =
    field === "conditions"
      ? ENGINE_CONDITIONS.filter((c) => c !== "deployed" || deploy !== undefined)
      : []
  const missing = a[field].filter((name) => !checks.has(name) && !engine.includes(name))
  if (missing.length === 0) return Either.void
  if (field === "conditions" && missing.includes("deployed")) {
    return Either.left(
      new LoadFailed({
        path: shown,
        reason:
          "`conditions:` names `deployed`, and this project has no `deploy.sh` — the engine answers `deployed` by running `.orkestra/deploy.sh` with the merge commit, so the wait has nothing to ask.",
      }),
    )
  }
  const named = [...checks.keys(), ...engine]
  const available = named.length === 0 ? "this project declares none" : named.join(", ")
  return Either.left(
    new LoadFailed({
      path: shown,
      reason: `unknown \`${field}:\` entr(ies): ${missing.join(", ")}. Available: ${available}.`,
    }),
  )
}

/**
 * A process an agent lists has to be declared, for `scriptNames`'s reason: a typo here
 * is a human's, and a step whose dev server silently never starts is the cost of it.
 */
const processNames = (
  a: Agent,
  shown: string,
  processes: ReadonlyMap<string, HostedProcess>,
): Either.Either<void, LoadFailed> => {
  const missing = a.processes.filter((name) => !processes.has(name))
  if (missing.length === 0) return Either.void
  const available =
    processes.size === 0 ? "this project declares none" : [...processes.keys()].join(", ")
  return Either.left(
    new LoadFailed({
      path: shown,
      reason: `unknown \`processes:\` entr(ies): ${missing.join(", ")} — a hosted process is a script under \`.orkestra/processes/\`. Available: ${available}.`,
    }),
  )
}

/**
 * An agent that waits on the branch merging runs once it is in, and the branch after
 * a merge is not a base anything may write to — so a `permission: write` agent may
 * not list `merged` or `deployed`. Refused here, where the file is, rather than at
 * the step, where the plan holding it has already been approved. The composer's
 * decode holds the same rule over plan order.
 */
const readOnlyAfterMerge = (a: Agent, shown: string): Either.Either<void, LoadFailed> => {
  const waits = a.conditions.filter((c) => engineCondition(c) !== undefined)
  return a.permission !== "write" || waits.length === 0
    ? Either.void
    : Either.left(
        new LoadFailed({
          path: shown,
          reason: `\`permission: write\` with \`conditions:\` naming ${waits.map((w) => `\`${w}\``).join(" and ")} — this agent runs once the branch is in, and nothing may write to a branch after it has merged. Make it \`read-only\`, or leave what has to change to a new trak.`,
        }),
      )
}

/**
 * `asked_every_seconds:` is a condition's interval and nothing else's, and the
 * parser cannot tell which list a script is on — so the two refusals live here,
 * where every agent has been read.
 *
 * A script named under `conditions:` without one has no interval to be asked on. A
 * script carrying one that no `conditions:` names, while `checks:` or `effects:`
 * does, is a number that reads as a policy and sets none — and `worktrees/setup.sh`
 * and `teardown.sh` are that case with no list at all. A script nobody names is left alone: it is the
 * ordinary state of a file written before the agent that uses it.
 */
const intervals = (
  agents: readonly (readonly [string, Agent])[],
  shown: ReadonlyMap<string, string>,
  checks: ReadonlyMap<string, Check>,
  setup: Check | undefined,
  teardown: Check | undefined,
): Either.Either<void, LoadFailed> => {
  const asConditions = new Set(agents.flatMap(([, a]) => a.conditions))
  const asOthers = new Set(agents.flatMap(([, a]) => [...a.checks, ...a.effects]))
  // `merged` and `deployed` back onto no script here: the engine's interval for one,
  // and `deploy.sh`'s own header for the other — see `Library.deploy`.
  for (const [name, check] of checks) {
    const path = shown.get(name) ?? `checks/${name}.sh`
    if (asConditions.has(name) && check.askedEverySeconds === undefined) {
      return Either.left(
        new LoadFailed({
          path,
          reason:
            "named under an agent's `conditions:` with no `asked_every_seconds:` — a condition is asked again on the interval its own header declares, and this one declares none.",
        }),
      )
    }
    if (!asConditions.has(name) && asOthers.has(name) && check.askedEverySeconds !== undefined) {
      return Either.left(
        new LoadFailed({
          path,
          reason:
            "`asked_every_seconds:` on a script named only under `checks:` or `effects:` — it is how often a condition is asked, and a check or an effect runs once. Name it under `conditions:`, or drop the field.",
        }),
      )
    }
  }
  for (const [name, script] of [
    ["setup", setup],
    ["teardown", teardown],
  ] as const) {
    if (script?.askedEverySeconds !== undefined) {
      return Either.left(
        new LoadFailed({
          path: `worktrees/${name}.sh`,
          reason: `\`asked_every_seconds:\` on the ${name} script — it is how often a condition is asked, and ${name} runs once per worktree.`,
        }),
      )
    }
  }
  return Either.void
}

/**
 * `units:` is read only where a step's check runs, and the parser cannot tell which list a
 * script is on. A condition or an effect carrying one would be a label that reads as a
 * cache and keeps nothing — refused here, where every agent has been read.
 */
const unitLabels = (
  agents: readonly (readonly [string, Agent])[],
  shown: ReadonlyMap<string, string>,
  checks: ReadonlyMap<string, Check>,
): Either.Either<void, LoadFailed> => {
  const elsewhere = new Set(agents.flatMap(([, a]) => [...a.conditions, ...a.effects]))
  for (const [name, check] of checks) {
    if (check.units !== undefined && elsewhere.has(name)) {
      return Either.left(
        new LoadFailed({
          path: shown.get(name) ?? `checks/${name}.sh`,
          reason:
            "`units:` on a script named under `conditions:` or `effects:` — units are proven by a step's check and read by the next one, and a condition or an effect is never either. Drop the field, or name the script only under `checks:`.",
        }),
      )
    }
  }
  return Either.void
}

/**
 * `reaches:` is read on `worktrees/setup.sh` and `worktrees/teardown.sh` and nowhere
 * else: it is how a sandbox decides whether to run one of them again or skip it. On a
 * check, a condition, an effect, `deploy.sh` or `env.sh` the word would read as a policy
 * and set none, so it is refused — the same rule `asked_every_seconds:` and `units:` are
 * held to, and here rather than in the parser because the parser cannot tell which file
 * it has.
 */
const reachesKeys = (
  src: LibrarySource,
  shown: ReadonlyMap<string, string>,
  checks: ReadonlyMap<string, Check>,
  deploy: Check | undefined,
  env: Check | undefined,
): Either.Either<void, LoadFailed> => {
  for (const [name, check] of checks) {
    if (check.reaches !== undefined) return refuseReaches(shown.get(name) ?? `checks/${name}.sh`)
  }
  const others: readonly (readonly [string, Check | undefined])[] = [
    [src.deploy?.shown ?? "deploy.sh", deploy],
    [src.env?.shown ?? "worktrees/env.sh", env],
  ]
  for (const [path, script] of others) {
    if (script?.reaches !== undefined) return refuseReaches(path)
  }
  return Either.void
}

const refuseReaches = (path: string): Either.Either<never, LoadFailed> =>
  Either.left(
    new LoadFailed({
      path,
      reason:
        "`reaches:` on a script that is not `worktrees/setup.sh` or `worktrees/teardown.sh` — it says whether a sandbox may skip one of those two or must not repeat it, and nothing else reads it. Drop the field.",
    }),
  )

/**
 * A role more than one file speaks for, bottom layer first, with the fields each file
 * sets. The loader logs one line per role at boot, the only place layering is reported.
 */
export interface Layered {
  readonly name: string
  readonly layers: readonly { readonly shown: string; readonly fields: readonly string[] }[]
}

export interface Assembled {
  readonly library: Library
  readonly layered: readonly Layered[]
}

interface RoleContext {
  readonly src: LibrarySource
  readonly models: ModelRegistry
  readonly refused: ReadonlySet<string>
  readonly checks: ReadonlyMap<string, Check>
  readonly deploy: Check | undefined
  readonly processes: ReadonlyMap<string, HostedProcess>
}

/**
 * One role from its files — the shipped one, then the project's that have a header —
 * merged and validated, or `undefined` when there is no role: nothing but headerless
 * files, or a refused shipped role.
 */
const assembleRole = (
  name: string,
  shipped: TextSource | undefined,
  repo: readonly TextSource[],
  ctx: RoleContext,
): Either.Either<
  { readonly agent: Agent; readonly layered: Layered | undefined } | undefined,
  LoadFailed
> =>
  Either.gen(function* () {
    const top = repo.at(-1) ?? shipped
    if (top === undefined) return undefined
    // The one name a project may not use, refused here rather than resolved by an
    // order somewhere else. Both readings of a clash are silent and wrong: a step
    // the engine spliced would run a project's role, or a step the composer
    // proposed would run the engine's. Neither is visible in the log, and the log
    // is the only place either would show up.
    //
    // Below the header check, not above it: a headerless `generic.md` is another
    // engine's brief, so it is passed over and never becomes an agent — there is
    // nothing for the shipped file to clash with, and refusing it would stop a
    // migrating project over a filename this engine never read.
    //
    // And the same refusal for `.local/agents/generic.md`: the directory changes who
    // can see the file, not whose name it is.
    if (name === GENERIC) {
      return yield* Either.left<LoadFailed>(
        new LoadFailed({
          path: top.shown,
          reason: `\`${GENERIC}\` is the agent Orkestra itself ships — the one a person is put in front of when they ask something of finished work. Name this role for what it does instead.`,
        }),
      )
    }
    if (ctx.refused.has(name)) {
      // Refused and written both is two instructions that disagree. Which one the
      // project meant is not the engine's to guess, and either guess is silent.
      const [written] = repo
      if (written === undefined) return undefined
      return yield* Either.left<LoadFailed>(
        new LoadFailed({
          path: written.shown,
          reason: `\`${name}\` is under \`refused:\` in ${ctx.src.fleet?.shown ?? "fleet.yaml"}, and this file defines it. Delete this file to turn the role off, or take the name out of \`refused:\` to layer over it.`,
        }),
      )
    }

    const layers: AgentLayer[] = []
    if (shipped !== undefined) {
      const bottom = yield* readLayer(shipped.shown, shipped.text)
      layers.push(yield* shippedLayer(bottom, ctx.src.shippedChecks))
    }
    for (const file of repo) layers.push(yield* readLayer(file.shown, file.text))
    const [first, ...rest] = layers
    if (first === undefined) return undefined
    // A shipped role runs on this project's `default:`, which is the whole of what a
    // shipped file may not say about itself — see `shippedLayer`.
    const fallback = shipped === undefined ? undefined : ctx.models.composer
    const { agent, from } = yield* resolveAgent(name, [first, ...rest], fallback, ctx.src.skills)
    const blame = (key: string): string => from.get(key) ?? top.shown
    yield* checkModel(agent, blame("model"), ctx.models)
    yield* scriptNames(agent, blame("checks"), "checks", ctx.checks, ctx.deploy)
    yield* scriptNames(agent, blame("effects"), "effects", ctx.checks, ctx.deploy)
    yield* scriptNames(agent, blame("conditions"), "conditions", ctx.checks, ctx.deploy)
    yield* processNames(agent, blame("processes"), ctx.processes)
    yield* readOnlyAfterMerge(agent, top.shown)
    return {
      agent,
      layered:
        rest.length === 0
          ? undefined
          : { name, layers: layers.map((l) => ({ shown: l.shown, fields: fieldsSet(l) })) },
    }
  })

/** Every sandbox tool declaration, parsed, in name order. */
const readTools = (
  files: ReadonlyMap<string, ScriptSource>,
): Either.Either<ReadonlyMap<string, SandboxTool>, LoadFailed> =>
  Either.map(
    Either.all(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, script]) =>
          Either.map(
            parseTool(script.shown, name, script.path, script.text),
            (t): [string, SandboxTool] => [name, t],
          ),
        ),
    ),
    (parsed) => new Map(parsed),
  )

/** Every hosted process declaration, parsed, in name order. */
const readProcesses = (
  files: ReadonlyMap<string, ScriptSource>,
): Either.Either<ReadonlyMap<string, HostedProcess>, LoadFailed> =>
  Either.map(
    Either.all(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, script]) =>
          Either.map(
            parseProcess(script.shown, name, script.path, script.text),
            (p): [string, HostedProcess] => [name, p],
          ),
        ),
    ),
    (parsed) => new Map(parsed),
  )

/**
 * Every name under a process's `needs:` is declared, and following them never comes
 * back to where it started — a process that needs itself, however far round, could
 * never be spawned, because each start waits for the one before it.
 */
const processNeeds = (
  files: ReadonlyMap<string, ScriptSource>,
  processes: ReadonlyMap<string, HostedProcess>,
): Either.Either<void, LoadFailed> => {
  const shownOf = (name: string): string => files.get(name)?.shown ?? `processes/${name}.sh`
  for (const p of processes.values()) {
    const missing = p.needs.filter((name) => !processes.has(name))
    if (missing.length > 0) {
      return Either.left(
        new LoadFailed({
          path: shownOf(p.name),
          reason: `unknown \`needs:\` entr(ies): ${missing.join(", ")} — a needed process is a script under \`.orkestra/processes/\`. Available: ${[...processes.keys()].join(", ")}.`,
        }),
      )
    }
  }
  for (const p of processes.values()) {
    const cycle = cycleFrom(p.name, [p.name], processes)
    if (cycle !== undefined) {
      return Either.left(
        new LoadFailed({
          path: shownOf(p.name),
          reason: `\`needs:\` goes round in a circle: ${cycle.join(" → ")}. Each process waits for the one it needs to be up first, so none of them could ever start.`,
        }),
      )
    }
  }
  return Either.void
}

/**
 * A trak's checkout's declarations over the project's, by name. Unlike `assembleLibrary`,
 * nothing here fails the whole: an agent writes these mid-trak, and one broken file must
 * not hide the processes beside it. A file that does not parse is left out, and so is a
 * process whose `needs:` names one not left in or goes round in a circle — repeated
 * until nothing more drops, since leaving one out can break what needs it.
 */
export const checkoutProcesses = (
  project: ReadonlyMap<string, HostedProcess>,
  files: ReadonlyMap<string, ScriptSource>,
): CheckoutProcesses => {
  const processes = new Map(project)
  const unreadable: UnreadableProcess[] = []
  for (const [name, script] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = parseProcess(script.shown, name, script.path, script.text)
    if (Either.isRight(parsed)) processes.set(name, parsed.right)
    else {
      processes.delete(name)
      unreadable.push({ name, shown: script.shown, reason: parsed.left.reason })
    }
  }
  const shownOf = (name: string): string => files.get(name)?.shown ?? `processes/${name}.sh`
  let dropped = true
  while (dropped) {
    dropped = false
    for (const p of processes.values()) {
      const missing = p.needs.filter((name) => !processes.has(name))
      const cycle = missing.length > 0 ? undefined : cycleFrom(p.name, [p.name], processes)
      if (missing.length === 0 && cycle === undefined) continue
      processes.delete(p.name)
      dropped = true
      unreadable.push({
        name: p.name,
        shown: shownOf(p.name),
        reason:
          cycle === undefined
            ? `\`needs:\` names ${missing.join(", ")}, which is not declared here or could not be read.`
            : `\`needs:\` goes round in a circle: ${cycle.join(" → ")}.`,
      })
    }
  }
  const sorted = [...processes].sort(([a], [b]) => a.localeCompare(b))
  return { processes: new Map(sorted), unreadable }
}

/** The path back to `origin` along `needs:`, ending where it started, or nothing. */
const cycleFrom = (
  origin: string,
  path: readonly string[],
  processes: ReadonlyMap<string, HostedProcess>,
): readonly string[] | undefined => {
  const last = path.at(-1) ?? origin
  for (const next of processes.get(last)?.needs ?? []) {
    if (next === origin) return [...path, next]
    if (path.includes(next)) continue
    const found = cycleFrom(origin, [...path, next], processes)
    if (found !== undefined) return found
  }
  return undefined
}

export const assembleLibrary = (src: LibrarySource): Either.Either<Assembled, LoadFailed> =>
  Either.gen(function* () {
    const models = yield* readModels(src.models, src.localModels)

    // Scripts first, because an agent's `checks:`, `effects:` and `conditions:` all
    // name them.
    const checks: [string, Check][] = []
    for (const [name, script] of [...src.checks].sort(([a], [b]) => a.localeCompare(b))) {
      // The three names the engine answers itself, refused before the file is read:
      // a script under any of them would be shadowed silently, and the wait it was
      // written for answered by something else.
      if (engineCondition(name) !== undefined) {
        return yield* Either.left<LoadFailed>(
          new LoadFailed({
            path: script.shown,
            reason: `\`${name}\` is a condition the engine answers itself — the branch merging, and \`deploy.sh\` saying the merge is live — so a script cannot take the name. Call it what it checks instead.`,
          }),
        )
      }
      if (name === WAIT_UNTIL) {
        return yield* Either.left<LoadFailed>(
          new LoadFailed({
            path: script.shown,
            reason: `\`${name}\` is the time a plan entry waits for — the composer writes it on the step, and the engine answers it against its own clock — so a script cannot take the name. Call it what it checks instead.`,
          }),
        )
      }
      checks.push([name, yield* parseCheck(script.shown, name, script.path, script.text)])
    }
    const byName = new Map(checks)

    // Before the agents, because an agent listing `deployed` is refused without it.
    // The same file kind as a check, run once per ask with the merge commit as `$1`.
    const deploy =
      src.deploy === undefined
        ? undefined
        : yield* parseCheck(src.deploy.shown, "deploy", src.deploy.path, src.deploy.text)

    const shippedRoles = [...src.agents].filter(([, f]) => f.shipped !== undefined).map(([n]) => n)
    const refused = yield* readFleet(src.fleet, shippedRoles)
    // Before the agents too, because an agent's `processes:` names them.
    const processes = yield* readProcesses(src.processes)
    yield* processNeeds(src.processes, processes)
    const context: RoleContext = { src, models, refused, checks: byName, deploy, processes }

    // Sorted, not directory order: the index order is what the composer reads,
    // and it must not depend on how the filesystem happened to list the files.
    const agents: [string, Agent][] = []
    const layered: Layered[] = []
    let passedOver = 0
    for (const name of [...src.agents.keys()].sort()) {
      const files = src.agents.get(name) ?? { shipped: undefined, repo: [] }
      const repo = files.repo.filter((file) => HEADER.test(file.text))
      passedOver += files.repo.length - repo.length
      const role = yield* assembleRole(name, files.shipped, repo, context)
      if (role === undefined) continue
      agents.push([name, role.agent])
      if (role.layered !== undefined) layered.push(role.layered)
    }
    // The one registry that may not be empty. Every other is optional — no
    // checks, no COMPOSITION.md, no ORKESTRA.md are all normal — but a project
    // with no agents cannot have a plan, so a composer would spend a turn
    // discovering it had nothing to propose.
    //
    // Which of the two messages is the difference between an empty directory and
    // one full of another engine's briefs: telling somebody to add a `*.md` while
    // twenty-nine of them sit there is the report that sends them looking in the
    // wrong place.
    if (agents.length === 0) {
      return yield* Either.left<LoadFailed>(
        new LoadFailed({
          path: "agents/",
          reason:
            passedOver === 0
              ? "no agents. A plan entry names an agent, so a project without at least one cannot compose anything — put a `*.md` brief in this directory."
              : `no agents this engine can read. All ${String(passedOver)} file(s) here open with something other than a \`---\` frontmatter line, so they belong to another engine and were passed over. A plan entry names an agent, so nothing can be composed until one brief in this directory is in this format.`,
        }),
      )
    }

    // The same file kind as a check — a shell script with comment frontmatter,
    // where `exit 0` is the whole contract — so it is parsed by the same rules
    // and runs through the same port. What differs is who chooses it: nothing
    // does. A worktree is not a step, and there is no composer at the point it
    // is made.
    const setup =
      src.setup === undefined
        ? undefined
        : yield* parseCheck(src.setup.shown, "setup", src.setup.path, src.setup.text)
    // Setup's mirror, parsed for setup's reason.
    const teardown =
      src.teardown === undefined
        ? undefined
        : yield* parseCheck(src.teardown.shown, "teardown", src.teardown.path, src.teardown.text)
    // The same argument once more: a script nothing selects, whose whole contract is
    // what it leaves exported and whether it exited 0.
    const env =
      src.env === undefined
        ? undefined
        : yield* parseCheck(src.env.shown, "env", src.env.path, src.env.text)
    const tools = yield* readTools(src.tools)

    // After every agent and the worktree scripts, because these refusals need the lists.
    const shownChecks = new Map([...src.checks].map(([name, script]) => [name, script.shown]))
    yield* intervals(agents, shownChecks, byName, setup, teardown)
    yield* unitLabels(agents, shownChecks, byName)
    yield* reachesKeys(src, shownChecks, byName, deploy, env)

    // The engine's own, parsed by the same rules and kept out of the map above. It
    // runs on this project's `default:`, which is the whole of what a shipped file
    // may not say about itself — see `shippedLayer`, which also holds any effect it
    // names to a script shipped beside it, so nothing here has to check the name.
    const genericLayer = yield* readLayer(SHIPPED_GENERIC, src.generic)
    const { agent: generic } = yield* resolveAgent(
      GENERIC,
      [yield* shippedLayer(genericLayer, src.shippedChecks)],
      models.composer,
    )

    const library: Library = {
      agents: new Map(agents),
      generic,
      checks: byName,
      processes: context.processes,
      setup,
      teardown,
      env,
      deploy,
      tools,
      root: src.root,
      models,
      mcp: parseMcpFile(".orkestra/mcp.yaml", src.mcp),
      // Trimmed: a file ends with a newline, and the templates already put a
      // blank line after the section — untrimmed, every prose file leaves a
      // widening gap in the rendered prompt.
      composition: src.composition?.trim() ?? "",
      goals: src.goals?.trim() ?? "",
      guidance: src.guidance?.trim() ?? "",
    }
    return { library, layered }
  })
