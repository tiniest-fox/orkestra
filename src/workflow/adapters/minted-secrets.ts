// The values minted for a spawn, held in memory for the redaction an engine tool applies.
//
// **Two hours, for a token that lives one**: a transcript line quoting a token is read
// after the token expired as often as before. A restart forgets them, and the token has
// usually expired by then; a value minted for a longer life than that is not covered.

import { Clock, Effect, Layer, Ref } from "effect"
import { MintedSecrets } from "../ports/minted-secrets.js"

const KEPT_MS = 2 * 60 * 60 * 1000

export const MintedSecretsLayer = Layer.effect(
  MintedSecrets,
  Effect.gen(function* () {
    const minted = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
    const live = (all: ReadonlyMap<string, number>, now: number) =>
      new Map([...all].filter(([, at]) => now - at < KEPT_MS))
    return {
      record: (value) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Ref.update(minted, (all) => live(all, now).set(value, now)),
        ),
      held: Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.map(Ref.get(minted), (all) => [...live(all, now).keys()]),
      ),
    }
  }),
)
