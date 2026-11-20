import { Context, type Effect } from "effect"
import type { ProviderEvent } from "../../agent/types/provider-event.js"
import type { Trak } from "../domain/trak.js"

/**
 * Observability. A dependency, not a parameter — which is what stops it being
 * threaded through every recursive `advance` call. The engine itself prints
 * nothing; the default implementation is a no-op.
 *
 * `agentEvent` is every normalized event from the running agent, as it arrives.
 * It is here rather than in `agent/Transcript` because a Transcript is a *sink*
 * that workflow already points at the Store — a caller that wants to watch a turn
 * happen cannot replace it without also throwing away the recording.
 */
export interface ObserverShape {
  readonly transition: (trak: Trak, reduction: string) => Effect.Effect<void>
  readonly agentEvent: (event: ProviderEvent) => Effect.Effect<void>
}

export class Observer extends Context.Tag("workflow/Observer")<Observer, ObserverShape>() {}
