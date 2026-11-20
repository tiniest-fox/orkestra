import { Context, type Effect } from "effect"

/** Whether the store process is answering, and why not where it is not. */
export interface StoreStatus {
  readonly up: boolean
  readonly reason?: string
}

/**
 * The store process's health. Offered only under an external store, beside `Leases`; a reader
 * asks with `Effect.serviceOption`.
 */
export interface StoreHealthShape {
  /** Down once the process has exited, or while it owes an answer and has gone quiet. */
  readonly status: Effect.Effect<StoreStatus>
  /** How the process exited, once it has. Never answers while it runs. */
  readonly ended: Effect.Effect<string>
}

export class StoreHealth extends Context.Tag("workflow/StoreHealth")<
  StoreHealth,
  StoreHealthShape
>() {}
