// logic: the shape every `.orkestra` definition file has — frontmatter, then a
// body. Shared by agents and checks, which differ only in the
// fields they allow, what they derive, and how the block is spelled: a `.md`
// file writes it as a YAML document, a `.sh` file writes it as comments because
// a shebang has to come first and `---` is not shell.

import { Either, Schema } from "effect"
import { LoadFailed } from "../types/errors.js"
import { parseYaml } from "./yaml.js"

/** `---` on the first line, fields, a closing `---`. Anchored: never mid-file. */
const FRONTMATTER = /^---\r?\n([\S\s]*?)\r?\n---[^\S\n]*(?:\r?\n|$)/

/** The same block behind `# `, after an optional shebang. */
const SHEBANG = /^#![^\n]*(?:\r?\n|$)/
const COMMENT_FRONTMATTER = /^# ---[^\S\n]*\r?\n([\S\s]*?)\r?\n# ---[^\S\n]*(?:\r?\n|$)/

/**
 * `# key: value` -> `key: value`, so the same YAML parser reads both spellings.
 * A bare `#` is a blank line rather than an error: it is how a comment block is
 * usually spaced, and YAML does not care.
 */
const uncomment = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.replace(/^#[^\S\n]?/, ""))
    .join("\n")

const AnyFields = Schema.Record({ key: Schema.String, value: Schema.Unknown })

export const invalid = <A>(path: string, reason: string): Either.Either<A, LoadFailed> =>
  Either.left(new LoadFailed({ path, reason }))

export const decodeOr = <A, I>(
  path: string,
  schema: Schema.Schema<A, I>,
  value: unknown,
  what: string,
): Either.Either<A, LoadFailed> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(schema)(value),
    (e) => new LoadFailed({ path, reason: `${what}\n${e.message}` }),
  )

export interface Split {
  /** The frontmatter's decoded fields, before any per-kind validation. */
  readonly fields: Record<string, unknown>
  readonly body: string
}

/**
 * Decode a frontmatter block to plain fields and reject unknown or retired keys
 * by name.
 *
 * `allowed` and `rejected` are passed in because they are the only thing that
 * differs between an agent and a check — and because a typo
 * silently ignored is the one outcome ruled out: it gives the author no error
 * and no effect.
 */
const checkedFields = (
  path: string,
  yaml: string,
  allowed: readonly string[],
  rejected: Readonly<Record<string, string>>,
): Either.Either<Record<string, unknown>, LoadFailed> =>
  Either.gen(function* () {
    const parsed = yield* parseYaml(path, yaml)
    const fields = yield* decodeOr(
      path,
      AnyFields,
      parsed,
      "frontmatter must be `key: value` fields.",
    )

    for (const key of Object.keys(fields)) {
      const why = rejected[key]
      if (why !== undefined) {
        return yield* invalid<Record<string, unknown>>(path, `\`${key}:\` — ${why}`)
      }
      if (!allowed.includes(key)) {
        return yield* invalid<Record<string, unknown>>(
          path,
          `unknown field \`${key}:\`. Allowed: ${allowed.join(", ")}.`,
        )
      }
    }

    return fields
  })

/** A `.md` definition: a `---` document at the very top, then the body. */
export const splitFrontmatter = (
  path: string,
  text: string,
  allowed: readonly string[],
  rejected: Readonly<Record<string, string>>,
): Either.Either<Split, LoadFailed> =>
  Either.gen(function* () {
    const split = FRONTMATTER.exec(text) ?? undefined
    if (split === undefined) {
      return yield* invalid<Split>(
        path,
        "expected YAML frontmatter: a `---` line at the very top, the fields, then a closing `---`.",
      )
    }
    const fields = yield* checkedFields(path, split[1] ?? "", allowed, rejected)
    return { fields, body: text.slice(split[0].length).trim() }
  })

/**
 * A `.sh` definition: an optional shebang, then the same block written as `# `
 * comments, then the script.
 *
 * The shebang is stripped rather than tolerated inside the block because it has
 * to be the first line of the file for the kernel to see it, and the frontmatter
 * has to be anchored for the same reason it is in a `.md` file — otherwise any
 * `# ---` in the middle of a script becomes a definition.
 */
export const splitCommentFrontmatter = (
  path: string,
  text: string,
  allowed: readonly string[],
  rejected: Readonly<Record<string, string>>,
): Either.Either<Split, LoadFailed> =>
  Either.gen(function* () {
    const script = text.replace(SHEBANG, "")
    const split = COMMENT_FRONTMATTER.exec(script) ?? undefined
    if (split === undefined) {
      return yield* invalid<Split>(
        path,
        "expected comment frontmatter: a `# ---` line (after the shebang, if any), the fields each behind `# `, then a closing `# ---`.",
      )
    }
    const fields = yield* checkedFields(path, uncomment(split[1] ?? ""), allowed, rejected)
    return { fields, body: script.slice(split[0].length).trim() }
  })
