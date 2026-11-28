// Where a problem report goes: the host's. The engine builds the report (`report.ts`) and
// hands it here; where the destination is kept, and the signed send, belong to the host
// that started the engine, so the browser never holds a secret. It reaches the engine as
// the `reports` seam, the way `Push` does.

import { Context, Effect, Layer } from "effect"
import type { ReportDto } from "@orkestra/shared/dto/report"

/** A destination the host has, and the name it gives it where it gives one. */
export interface ReportDestination {
  readonly name?: string
}

/** What a send came to: the receiver's reference, or why it did not go. */
export type ReportSent = { readonly reference: string } | { readonly reason: string }

export interface ReportsShape {
  /** The destination, asked on every read; `undefined` where the host has none. */
  readonly destination: Effect.Effect<ReportDestination | undefined>
  /**
   * Send one report. A failure the host can word is a `reason`, never an error, because
   * the person reads it beside their kept text and tries again.
   */
  readonly send: (report: ReportDto) => Effect.Effect<ReportSent>
}

export class Reports extends Context.Tag("app/Reports")<Reports, ReportsShape>() {}

/** An engine nobody hosts: no destination, so nothing offers a report. */
export const NoReportsLayer = Layer.succeed(Reports, {
  destination: Effect.succeed(undefined),
  send: () => Effect.succeed({ reason: "This engine has nowhere to send a report." }),
})
