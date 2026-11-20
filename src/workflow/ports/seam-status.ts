// port: what each trak's engine action at the seam is doing now — engine memory, never on
// a log.
//
// The seam is the boundary between the engine and where a trak's work runs: a local
// process group, or a sandbox reached through `runner.sh`. An action crossing it publishes
// one status per trak while it runs — readying, crossing, or waiting out an outage — and
// clears it when it ends. The attempt, the backoff and the last error describe one engine's
// attempt, so a restart forgets them and the action it re-issues publishes its own.

import { Context, type Effect } from "effect"
import type { Outage } from "./outages.js"

/** One action at the seam, as a watcher is told of it. */
export interface SeamStatus {
  /** Which action: `stop` is the one that crosses through the seam operation today. */
  readonly action: string
  /** Asking the sandbox's state, crossing into it, or waiting before the next attempt. */
  readonly phase: "readying" | "crossing" | "waiting"
  /** The crossing being made, from one; zero while readying. */
  readonly attempt: number
  /** When the action began. */
  readonly since: number
  /** The transport failure the action is waiting out, in the runner's words. */
  readonly lastError?: { readonly kind: Outage["kind"]; readonly said: string }
}

export interface SeamStatusesShape {
  /** Say what `trak`'s action at the seam is doing now. The newest action wins. */
  readonly set: (trak: string, status: SeamStatus) => Effect.Effect<void>
  /** The action ended, however it ended. */
  readonly clear: (trak: string) => Effect.Effect<void>
  /** What `trak`'s action at the seam is doing, or `undefined` where none is running. */
  readonly of: (trak: string) => Effect.Effect<SeamStatus | undefined>
}

export class SeamStatuses extends Context.Tag("workflow/SeamStatuses")<
  SeamStatuses,
  SeamStatusesShape
>() {}
