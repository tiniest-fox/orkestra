// logic: one `.orkestra/agents/*.md` file -> one Agent.
//
// Split, parse, validate, derive — the same shape the check parser has.
//
// Twelve keys, and an unknown one is an error: a directory is a shared space, a
// file is a contract. That applies to the twelve and stops there — inside
// `output:` the keys are section titles and are whatever the author wants.

import { Either, Schema } from "effect"
import Mustache, { type TemplateSpans } from "mustache"
import {
  type Agent,
  BRIEF_FLAGS,
  FIGURES,
  type OutputSection,
  type Permission,
  type Skill,
} from "../types/agent.js"
import type { LoadFailed } from "../types/errors.js"
import { decodeOr, invalid, splitFrontmatter } from "./frontmatter.js"

/**
 * The composer must write this name back verbatim in a proposal, so anything
 * that needs quoting or shifting is rejected at load rather than becoming an
 * `unknown agent` retry every time a trak is composed.
 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A section given as a string is shorthand for a required one with that
 * description — which is what nearly every section is, and writing
 * `{required: true, description: …}` seventy times would be ceremony.
 *
 * `required: false` and `when:` travel together, checked in `toSections`: an
 * optional section states the fact that makes it due, and a condition on a
 * section that is always owed is a contradiction. `OutputSection.when` has why.
 *
 * `figure:` is a string here and checked against `FIGURES` there, because a Literal
 * refused by the decoder would not say which section named it.
 */
const SectionSpec = Schema.Union(
  Schema.String,
  Schema.Struct({
    description: Schema.String,
    required: Schema.optional(Schema.Boolean),
    when: Schema.optional(Schema.String),
    figure: Schema.optional(Schema.String),
  }),
)

/**
 * One file's frontmatter, every key optional: a file may be one layer of a role rather
 * than the whole of it, so what is required is asked of the merged fields in
 * `resolveAgent` rather than of any one file.
 */
const Frontmatter = Schema.Struct({
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  // Checked against the model's CLI by the assembler, which holds the registry.
  effort: Schema.optional(Schema.String),
  permission: Schema.optional(Schema.Literal("read-only", "write")),
  output: Schema.optional(Schema.Record({ key: Schema.String, value: SectionSpec })),
  checks: Schema.optional(Schema.Array(Schema.String)),
  effects: Schema.optional(Schema.Array(Schema.String)),
  conditions: Schema.optional(Schema.Array(Schema.String)),
  processes: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  start: Schema.optional(Schema.Boolean),
  icon: Schema.optional(Schema.String),
  place: Schema.optional(Schema.Literal("sandbox", "host")),
})

type Fields = Schema.Schema.Type<typeof Frontmatter>

const ALLOWED: readonly string[] = [
  "description",
  "model",
  "effort",
  "permission",
  "output",
  "checks",
  "effects",
  "conditions",
  "processes",
  "skills",
  "start",
  "icon",
  "place",
]

/**
 * Keys an earlier format defined that this loader will not accept. Each names
 * where the thing went, because an author reaching for one of these is doing
 * something the new shape still does — just somewhere else.
 *
 * Parsing-and-ignoring is the one outcome ruled out: it gives the author no error
 * and no effect.
 */
const REJECTED: Record<string, string> = {
  disallowed_tools:
    "tool restrictions are now `permission: read-only | write`. Every use of this list spelled out the same edit tools, and which tools those are is the provider's business rather than policy's.",
  sections:
    "sections are the keys of `output:` now, so their order is the order you write them in. A separate list meant a title could differ between the shape and the artifact.",
  check: "the field is `checks:`, and it takes a list of names from `.orkestra/checks/`.",
  title:
    "orkestra has no separate display name — the composer's index labels every agent by its filename, which is what a proposal has to reference. Put the wording in `description:` instead.",
}

/**
 * `output:` is a mapping, so order is document order in the sense YAML means it.
 *
 * One case to know about: a title that parses as an integer sorts to the front
 * rather than staying put, so a section called `2024 Risks` needs quoting. That
 * is a property of objects rather than of this parser, which is why it is a note
 * and not a check — rejecting integer-like titles would cost more than it saves.
 */
const toSections = (
  path: string,
  output: Readonly<Record<string, Schema.Schema.Type<typeof SectionSpec>>>,
): Either.Either<readonly OutputSection[], LoadFailed> =>
  Either.all(
    Object.entries(output).map(([title, spec]): Either.Either<OutputSection, LoadFailed> => {
      if (typeof spec === "string") {
        return Either.right({ title, description: spec.trim(), when: undefined, figure: undefined })
      }
      const figure = FIGURES.find((name) => name === spec.figure)
      if (spec.figure !== undefined && figure === undefined) {
        return invalid(
          path,
          `\`${title}\` asks for \`figure: ${spec.figure}\`, which is not a figure. A figure is one of ${FIGURES.join(", ")}.`,
        )
      }
      const required = spec.required ?? true
      // Trimmed before the checks: a `when:` that folds to nothing would otherwise
      // make the section optional to the schema while the prompt renders no
      // condition — required in name, omitted in practice, and nobody told.
      const when = spec.when?.trim() === "" ? undefined : spec.when?.trim()
      if (!required && when === undefined) {
        return invalid(
          path,
          `\`${title}\` is \`required: false\` with no \`when:\`. An optional section names the fact that makes it due — a file that exists, a plan that splits — because one left to judgement is written every time.`,
        )
      }
      if (required && when !== undefined) {
        return invalid(
          path,
          `\`${title}\` has a \`when:\` but is required. A condition only makes sense on a section that may be omitted — add \`required: false\`, or drop the condition.`,
        )
      }
      return Either.right({ title, description: spec.description.trim(), when, figure })
    }),
  )

/**
 * One file's part of a role: its fields as written, and its body, `""` when it has none.
 * `shown` is where a person would open it, relative to `.orkestra/` — `agents/x.md`,
 * `.local/agents/x.md`, or `shipped/agents/x.md` for one inside the package — because
 * the same name is a different file in each, and an error has to point at the one that
 * is wrong.
 */
export interface AgentLayer {
  readonly shown: string
  readonly fields: Fields
  readonly brief: string
}

/** The merged role, and which file each field was taken from — so an error can blame it. */
export interface Resolved {
  readonly agent: Agent
  /** A frontmatter key, or `brief` -> the `shown` of the file that supplied it. */
  readonly from: ReadonlyMap<string, string>
}

/** The fields a file sets, `brief` last when it has a body: what the boot log names. */
export const fieldsSet = (layer: AgentLayer): readonly string[] => [
  ...ALLOWED.filter((key) => Object.hasOwn(layer.fields, key)),
  ...(layer.brief === "" ? [] : ["brief"]),
]

/**
 * Split and decode one file. Unknown and retired keys are refused here, per file, because
 * a typo is in a file and nowhere else; nothing is required yet.
 */
export const readLayer = (shown: string, text: string): Either.Either<AgentLayer, LoadFailed> =>
  Either.gen(function* () {
    const split = yield* splitFrontmatter(shown, text, ALLOWED, REJECTED)
    const fields = yield* decodeOr(
      shown,
      Frontmatter,
      split.fields,
      "frontmatter takes `description:` as a string, `permission: read-only|write`, an `output:` mapping of section titles, and `checks:`, `effects:`, `conditions:`, `processes:` and `skills:` as lists of names.",
    )
    return { shown, fields, brief: split.body }
  })

/**
 * A file shipped inside the engine names no `model:`, `effort:`, `checks:`, `conditions:`,
 * `processes:` or `skills:`, and that is checked rather than trusted: all six resolve against
 * the project — a model and an effort against `models.yaml`, the scripts against `checks/` and
 * `processes/`, the skills
 * against the repository's skill directories — so a file the engine carries naming any
 * of them would be engine code knowing what a project holds. `model: opus` shipped to a project listing only `haiku` spends at a rate nobody
 * there sanctioned.
 *
 * `effects:` is the one list it may fill, and only with a script the engine ships beside
 * it — `scripts` — which a project's script of the same name then replaces.
 */
export const shippedLayer = (
  layer: AgentLayer,
  scripts: readonly string[],
): Either.Either<AgentLayer, LoadFailed> => {
  const named = (
    ["model", "effort", "checks", "conditions", "processes", "skills"] as const
  ).filter((key) => layer.fields[key] !== undefined)
  if (named.length > 0) {
    return invalid(
      layer.shown,
      `a file Orkestra ships names no ${named.map((k) => `\`${k}:\``).join(", ")} — each resolves against the project, which the engine cannot know. It runs on the project's \`default:\` model, and a project's own file for this role adds the rest.`,
    )
  }
  const unshipped = (layer.fields.effects ?? []).filter((e) => !scripts.includes(e))
  if (unshipped.length > 0) {
    const ships = scripts.length === 0 ? "it ships none" : `it ships ${scripts.join(", ")}`
    return invalid(
      layer.shown,
      `\`effects:\` names ${unshipped.join(", ")}, which Orkestra does not ship — a file the engine carries may name only a script in \`shipped/checks/\`, and ${ships}.`,
    )
  }
  return Either.right(layer)
}

/** Every tag in a parsed body but a section on a `BRIEF_FLAGS` name, as it was written. */
const unknownTags = (spans: TemplateSpans): readonly string[] =>
  spans.flatMap((span) => {
    const [type, value] = span
    if (type === "text") return []
    const inner = span.length === 6 ? unknownTags(span[4]) : []
    const flag = (type === "#" || type === "^") && BRIEF_FLAGS.some((f) => f === value)
    if (flag) return inner
    const written = type === "name" ? `{{${value}}}` : `{{${type}${value}}}`
    return [written, ...inner]
  })

/**
 * The merged body, refused if it uses any tag but a section on a flag the engine fills.
 * Checked on the merged brief rather than per layer, because the body that runs is the
 * top one that has a body. A variable, a partial or a misspelt flag would otherwise
 * render as nothing — Mustache's default — and drop what it wraps without an error.
 */
const checkBrief = (shown: string, brief: string): Either.Either<string, LoadFailed> => {
  const flags = BRIEF_FLAGS.map((f) => `\`{{#${f}}}\``).join(", ")
  const parsed = Either.try(() => Mustache.parse(brief))
  if (Either.isLeft(parsed)) {
    const cause = parsed.left instanceof Error ? parsed.left.message : String(parsed.left)
    return invalid(shown, `the body is not a template that parses — ${cause}.`)
  }
  const unknown = unknownTags(parsed.right)
  if (unknown.length > 0) {
    return invalid(
      shown,
      `the body uses ${unknown.map((t) => `\`${t}\``).join(", ")} — a body may test only ${flags}, as a section or an inverted one, which the engine fills on every turn.`,
    )
  }
  return Either.right(brief)
}

const REQUIRED = ["description", "permission", "output"] as const

/**
 * Where a repository keeps its skills, relative to its root, searched in this order: a
 * name resolves to the first `<dir>/<name>/SKILL.md` that exists. Claude Code reads the
 * first and Codex the second, and the engine spawns both.
 */
export const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const

/**
 * `skills:` names -> each `SKILL.md`, or the file that named one no directory holds.
 * Checked at load for the reason a script name is: a typo here is a human's, and a role
 * pointed at a skill that is not there reads nothing and says nothing.
 */
const toSkills = (
  path: string,
  names: readonly string[],
  available: ReadonlyMap<string, string>,
): Either.Either<readonly Skill[], LoadFailed> => {
  const missing = names.filter((n) => !available.has(n))
  if (missing.length > 0) {
    const have =
      available.size === 0 ? "this repository has none" : [...available.keys()].join(", ")
    return invalid(
      path,
      `unknown \`skills:\` entr(ies): ${missing.join(", ")} — a skill is a directory holding a \`SKILL.md\` under ${SKILL_DIRS.map((d) => `\`${d}/\``).join(" or ")}. Available: ${have}.`,
    )
  }
  return Either.right(names.map((name) => ({ name, path: available.get(name) ?? "" })))
}

/**
 * The layers of one role, bottom first, merged field by field — the later file wins, and
 * `output:`, `checks:`, `effects:`, `conditions:`, `processes:` and `skills:` are each one field,
 * replaced whole.
 * A body replaces the brief only when one is present. The merged fields are what is
 * validated, so a file over another may hold a single key.
 *
 * **`fallbackModel` is what a role shipped inside the engine runs on, and passing it is
 * what says the bottom layer is one.** It is the only reason `model:` is not simply
 * required: a role no shipped file backs gets no fallback, so the key stays required for
 * every role a human writes whole.
 *
 * `skills` is the repository's skills, name -> `SKILL.md` path; `skills:` is resolved
 * against it, and a role no project file names skills for needs none.
 *
 * `name` comes from the filename, so it is the one field no file can lie about.
 */
export const resolveAgent = (
  name: string,
  layers: readonly [AgentLayer, ...AgentLayer[]],
  fallbackModel?: string,
  skills: ReadonlyMap<string, string> = new Map(),
): Either.Either<Resolved, LoadFailed> =>
  Either.gen(function* () {
    const top = layers[layers.length - 1]?.shown ?? layers[0].shown

    if (!KEBAB.test(name)) {
      return yield* invalid<never>(
        top,
        `\`${name}\` cannot be an agent name — a proposal references an agent by its filename, so use lowercase-kebab (scope-and-design.md).`,
      )
    }

    // A key a file leaves out is absent from its decoded fields rather than `undefined`,
    // so assigning one over another is exactly "the later file wins where it speaks".
    const merged: Fields = {}
    const from = new Map<string, string>()
    let brief = ""
    for (const layer of layers) {
      Object.assign(merged, layer.fields)
      for (const key of fieldsSet(layer)) from.set(key, layer.shown)
      if (layer.brief !== "") brief = layer.brief
    }

    const { description, permission, output } = merged
    if (description === undefined || permission === undefined || output === undefined) {
      const missing = REQUIRED.filter((key) => merged[key] === undefined)
      const alone =
        fallbackModel === undefined
          ? ` Orkestra ships no role called \`${name}\` for this file to layer over, so it has to say all of it.`
          : ""
      return yield* invalid<never>(
        top,
        `no ${missing.map((k) => `\`${k}:\``).join(", ")} — a role needs \`description:\`, \`permission: read-only|write\` and an \`output:\` mapping of section titles.${alone}`,
      )
    }

    const model = merged.model ?? fallbackModel
    if (model === undefined) {
      return yield* invalid<never>(
        top,
        "no `model:`. It is required and handed to the provider verbatim, so an agent without one has nothing to run on.",
      )
    }

    const outputFrom = from.get("output") ?? top
    const sections = yield* toSections(outputFrom, output)
    if (sections.length === 0) {
      return yield* invalid<never>(
        outputFrom,
        "`output:` has no sections. Every agent declares what it produces — an agent whose output is one blob of markdown declares one section, which is the degenerate case rather than a missing one.",
      )
    }

    if (brief === "") {
      return yield* invalid<never>(
        top,
        "no body after the frontmatter — an agent with no brief tells the model nothing about the role.",
      )
    }

    yield* checkBrief(from.get("brief") ?? top, brief)

    const named = yield* toSkills(from.get("skills") ?? top, merged.skills ?? [], skills)

    const agent: Agent = {
      name,
      // Trimmed: a folded scalar (`description: >`) ends with a newline, which
      // would put a blank line between every entry of the composer's index.
      description: description.trim(),
      model,
      effort: merged.effort,
      permission: permission satisfies Permission,
      sections,
      checks: merged.checks ?? [],
      effects: merged.effects ?? [],
      conditions: merged.conditions ?? [],
      processes: merged.processes ?? [],
      // Absent is `false`, not "unknown": an agent nobody marked is not offered as
      // an opening move, which is the direction that fails safe.
      start: merged.start ?? false,
      // Passed through unchecked, and see `Agent.icon` for why: validating it here
      // would put a client library's icon set inside the engine.
      icon: merged.icon,
      // Absent is the sandbox, the direction that fails safe: only the host can widen it.
      place: merged.place ?? "sandbox",
      skills: named,
      brief,
    }
    return { agent, from }
  })

/** One file that is the whole of a role — a project's own, with nothing under it. */
export const parseAgent = (
  shown: string,
  name: string,
  text: string,
): Either.Either<Agent, LoadFailed> =>
  Either.gen(function* () {
    const layer = yield* readLayer(shown, text)
    return (yield* resolveAgent(name, [layer])).agent
  })
