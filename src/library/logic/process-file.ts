// logic: one `.orkestra/processes/*.sh` file -> one HostedProcess.
//
// The check parser's four steps over the same comment block, with its own keys:
// what a hosted process declares is whether it has a page, how long it may take to come
// up and which processes have to be up first, and nothing about an exit, because exiting
// is not what it is for. Whether the names in `needs:` exist is the library's to say.

import { Either, Schema } from "effect"
import type { LoadFailed } from "../types/errors.js"
import { DEFAULT_READY_SECONDS, type HostedProcess } from "../types/process.js"
import { decodeOr, invalid, splitCommentFrontmatter } from "./frontmatter.js"

/**
 * An agent file names a process by this, and it becomes part of an environment
 * variable's name — so kebab, which upper-cases to something a shell accepts.
 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const Frontmatter = Schema.Struct({
  description: Schema.String,
  page: Schema.optional(Schema.Boolean),
  ready_seconds: Schema.optional(Schema.Positive),
  needs: Schema.optional(Schema.Array(Schema.String)),
})

const ALLOWED: readonly string[] = ["description", "page", "ready_seconds", "needs"]

const REJECTED: Record<string, string> = {
  timeout_seconds:
    "a hosted process is meant to keep running, so there is no time it is allowed to take. `ready_seconds:` is how long it may take to start answering on `$PORT`.",
  asked_every_seconds:
    "that is how often a condition is asked. A hosted process is started once and runs until it is stopped.",
  port: "the engine picks the port and hands it over as `$PORT`, so two checkouts never fight over one. Pass `$PORT` to the tool in the script.",
}

export const parseProcess = (
  shown: string,
  name: string,
  path: string,
  text: string,
): Either.Either<HostedProcess, LoadFailed> =>
  Either.gen(function* () {
    if (!KEBAB.test(name)) {
      return yield* invalid<never>(
        shown,
        `\`${name}\` cannot be a process name — an agent file lists a process by its filename, so use lowercase-kebab (dev-server.sh).`,
      )
    }
    const split = yield* splitCommentFrontmatter(shown, text, ALLOWED, REJECTED)
    const fields = yield* decodeOr(
      shown,
      Frontmatter,
      split.fields,
      "frontmatter needs `description:`; `page:` must be true or false if present, and `ready_seconds:` a positive number, and `needs:` a list of process names.",
    )
    if (split.body === "") {
      return yield* invalid<never>(
        shown,
        "no script after the frontmatter — a hosted process has to start something.",
      )
    }
    return {
      name,
      description: fields.description.trim(),
      page: fields.page ?? false,
      readySeconds: fields.ready_seconds ?? DEFAULT_READY_SECONDS,
      needs: fields.needs ?? [],
      path,
    }
  })
