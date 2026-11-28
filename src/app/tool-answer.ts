// What a call on a trak's tools answers before `trak/tool-result` words it: the keys the
// template renders, and whether the call was refused. Shared by every group of tools, and
// by the read tools a goal's composer is offered.

import { Effect, Either, JSONSchema, Option, Schema } from "effect"
import type { McpToolResultDto } from "@orkestra/shared/dto/goals"
import { refusalReason } from "../agent/logic/refusal.js"
import { Provider } from "../agent/ports/provider.js"
import { runnerFilesNow } from "../vcs/ports/runners.js"
import { render } from "../prompts/index.js"
import { Prompts } from "../prompts/ports/prompts.js"
import { Environment } from "../workflow/ports/environment.js"
import { MintedSecrets } from "../workflow/ports/minted-secrets.js"
import { redactor, secretValues } from "./redact.js"

/** The outcome keys `trak/tool-result` renders for a call, and whether it was refused. */
export interface Answer {
  readonly said: Readonly<Record<string, unknown>>
  readonly refused: boolean
}

export const refused = (said: Readonly<Record<string, unknown>>): Answer => ({
  said,
  refused: true,
})
export const did = (said: Readonly<Record<string, unknown>>): Answer => ({ said, refused: false })

/** Decode a tool's arguments, then make its move — the refusal where they do not fit. */
export const withArgs = <A, I, B, E, R>(
  schema: Schema.Schema<A, I>,
  args: unknown,
  move: (a: A) => Effect.Effect<B, E, R>,
): Effect.Effect<B | Answer, E, R> =>
  Either.match(Schema.decodeUnknownEither(schema)(args ?? {}), {
    onLeft: (e) => Effect.succeed(refused({ badArguments: refusalReason(e) })),
    onRight: move,
  })

/**
 * Every secret value the engine holds, read at the call so a secret the host saved since
 * boot is still one: the host's named variables, the CLIs' sign-ins, the runner's and the
 * backup file's, and the engine's own key and passphrase.
 */
export const heldSecrets = Effect.gen(function* () {
  const { runner, backup } = yield* runnerFilesNow
  // Absent from a test engine that mints nothing.
  const minted = yield* Effect.serviceOption(MintedSecrets)
  const environment = yield* Environment
  return secretValues({
    env: yield* environment.engine,
    hosted: yield* environment.secretNames,
    credentials: (yield* Provider).credentials,
    runner,
    backup: backup?.secrets ?? [],
    minted: Option.isSome(minted) ? yield* minted.value.held : [],
  })
})

/**
 * One call's redaction: `hide`, for a tool to take the secrets out of each piece before it
 * cuts one, and `answer`, which words the outcome as `trak/tool-result` with every secret
 * value the engine holds taken out, and says how many it found. A transcript, a check's
 * output and an engine log line can each quote one.
 */
export const hidingAnswers = Effect.gen(function* () {
  const prompts = yield* Prompts
  const hiding = redactor(yield* heldSecrets)
  const answer = (out: Answer): McpToolResultDto => {
    const text = hiding.hide(render(prompts, "trak/tool-result", out.said))
    const found = hiding.found()
    return {
      text:
        found === 0
          ? text
          : `${text}\n\n${render(prompts, "trak/tool-result", { redacted: String(found) })}`,
      isError: out.refused,
    }
  }
  return { hide: hiding.hide, answer }
})

/**
 * A tool's arguments as MCP lists them, always with a top-level `type: "object"`: Claude
 * Code refuses the whole `tools/list` reply where one tool's schema has none, and loads no
 * tool from the server. `JSONSchema.make` writes `Schema.Struct({})` as an `anyOf` of an
 * object and an array, which is the one shape here without it — so that one is listed as
 * an empty object, and the call still decodes its arguments against the schema itself.
 */
export const inputSchemaOf = (schema: Schema.Schema.AnyNoContext): unknown => {
  const made = JSONSchema.make(schema)
  return "type" in made && made.type === "object"
    ? made
    : { $schema: made.$schema, type: "object", properties: {} }
}
