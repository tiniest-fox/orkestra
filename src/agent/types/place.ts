// types: where a piece of work ran — on the engine's own machine, or in a sandbox — as
// the record a person reads back later to tell which.

import { Schema } from "effect"

/** The work ran on the engine's own machine. */
const Local = Schema.TaggedStruct("Local", {})

/**
 * The work ran in a sandbox through the project's runner. `runner` is the runner file's
 * `description` when the work ran, so a record keeps naming the runner that ran it after
 * the file changes. `sandbox` is the provider's own id for the sandbox, which the runner's
 * `create` and `status` print — absent where the runner prints none. `exec` is the
 * runner's id for the command, absent on a record of the checkout rather than of one
 * command.
 */
const Remote = Schema.TaggedStruct("Remote", {
  runner: Schema.String,
  sandbox: Schema.optional(Schema.String),
  exec: Schema.optional(Schema.String),
})

/**
 * A `Schema` as well as a type, because it is written on the log and the transcript and
 * read back from both. Every field that carries one is optional: a record written before
 * the field existed says nothing about where its work ran.
 */
export const Place = Schema.Union(Local, Remote)
export type Place = Schema.Schema.Type<typeof Place>

export const Places = {
  local: (): Place => Local.make({}),
  remote: (runner: string, sandbox?: string, exec?: string): Place =>
    Remote.make({
      runner,
      ...(sandbox === undefined ? {} : { sandbox }),
      ...(exec === undefined ? {} : { exec }),
    }),
}
