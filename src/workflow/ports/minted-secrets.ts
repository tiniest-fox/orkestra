import { Context, type Effect } from "effect"

/**
 * Secret values the engine handed to a spawn without holding them itself — a GitHub token
 * minted for one spawn sits in `ProcessSpec.inherits` and never in the engine's
 * environment — so an answer that redacts the environment's secrets can redact these too.
 */
export interface MintedSecretsShape {
  readonly record: (value: string) => Effect.Effect<void>
  /** The values minted lately enough to be live. */
  readonly held: Effect.Effect<readonly string[]>
}

export class MintedSecrets extends Context.Tag("workflow/MintedSecrets")<
  MintedSecrets,
  MintedSecretsShape
>() {}
