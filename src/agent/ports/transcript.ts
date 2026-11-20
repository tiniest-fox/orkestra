// port: where normalized events go. A dependency, not a per-call callback —
// which is what lets `elicit` keep a two-argument signature and puts the
// requirement in its R channel where it can't be forgotten.

import { Context, type Effect } from "effect"
import type { ProviderEvent } from "../types/provider-event.js"

export interface TranscriptShape {
  readonly record: (event: ProviderEvent) => Effect.Effect<void>
}

export class Transcript extends Context.Tag("agent/Transcript")<Transcript, TranscriptShape>() {}
