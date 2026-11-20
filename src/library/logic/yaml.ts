// logic: the only place YAML text becomes a value.

import { Either } from "effect"
import * as YAML from "yaml"
import { LoadFailed } from "../types/errors.js"

/**
 * `YAML.parse` is typed `any`. Widening it to `unknown` here — once — is what
 * forces every caller through a Schema decode instead of trusting the file.
 */
const asUnknown = (text: string): unknown => YAML.parse(text)

export const parseYaml = (path: string, text: string): Either.Either<unknown, LoadFailed> =>
  Either.try({
    try: () => asUnknown(text),
    catch: (cause) =>
      new LoadFailed({
        path,
        reason: `invalid YAML — ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  })
