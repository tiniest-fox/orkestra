// logic: one `.orkestra/tools/*.sh` file -> one SandboxTool.
//
// The header is all the engine reads: the script installs the tool itself, so there is no
// key for a URL, a checksum or an architecture, and the engine owns no schema for one.

import { Either, Schema } from "effect"
import type { LoadFailed } from "../types/errors.js"
import type { SandboxTool } from "../types/tool.js"
import { decodeOr, invalid, splitCommentFrontmatter } from "./frontmatter.js"

/** The command a call names, and a file and a directory in the sandbox. */
const COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** One path segment, since the install lands in a directory named for it. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

const Frontmatter = Schema.Struct({
  description: Schema.String,
  version: Schema.String,
})

const ALLOWED: readonly string[] = ["description", "version"]

const REJECTED: Record<string, string> = {
  url: "the script downloads the tool itself, so the address belongs in its body.",
  checksum: "the script downloads the tool itself, so it checks what it fetched.",
  arch: "the script downloads the tool itself, so it picks the build for the machine it runs on.",
}

export const parseTool = (
  shown: string,
  name: string,
  path: string,
  text: string,
): Either.Either<SandboxTool, LoadFailed> =>
  Either.gen(function* () {
    if (!COMMAND.test(name)) {
      return yield* invalid<never>(
        shown,
        `\`${name}\` cannot be a tool name — a call names the tool by its filename, so use letters, digits, \`.\`, \`_\` and \`-\` (rclone.sh).`,
      )
    }
    const split = yield* splitCommentFrontmatter(shown, text, ALLOWED, REJECTED)
    const fields = yield* decodeOr(
      shown,
      Frontmatter,
      split.fields,
      'frontmatter needs `description:` and `version:`, and `version:` must be a string — quote a version YAML would read as a number, such as `"1.70"`.',
    )
    const version = fields.version.trim()
    if (!VERSION.test(version)) {
      return yield* invalid<never>(
        shown,
        `\`version: ${version}\` — the install lands in a directory named for it, so use letters, digits, \`.\`, \`_\`, \`+\` and \`-\`.`,
      )
    }
    if (split.body === "") {
      return yield* invalid<never>(
        shown,
        "no script after the frontmatter — a tool script has to install the tool into the directory it is handed as `$1`.",
      )
    }
    return { name, description: fields.description.trim(), version, path }
  })

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

/** The command a sandbox finds on PATH as `tool.name`: the launcher, told which tool it is. */
export const toolEntry = (tool: SandboxTool, launcher: string): string =>
  `#!/bin/sh\nexec sh ${[launcher, tool.path, tool.name, tool.version].map(quoted).join(" ")} "$@"\n`
