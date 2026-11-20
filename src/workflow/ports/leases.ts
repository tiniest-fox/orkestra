import { Context, type Effect } from "effect"
import type { StoreFailed } from "./store-errors.js"

/**
 * One lease as the store holds it. `expired` is the store's own reading of its clock,
 * which is true from a release onward too; `record` is what the last holder noted, kept
 * across a release and an expiry so the next holder can read it.
 */
export interface LeaseRow {
  readonly key: string
  readonly holder: string
  readonly fence: number
  readonly expired: boolean
  /** When its holder took it, by the store's clock: what custody shows on another copy. */
  readonly since: number
  readonly record?: unknown
}

/**
 * The store's lease rows: one per trak, per goal (`goal/<id>`) and per job the engine runs
 * by itself (`job/<name>`). Offered only under an external store, by the layer that speaks to
 * its process; `Locks` and `Runs` are built over it there.
 *
 * **`fence` grows on every take, and it is the whole of the safety.** A copy that paused
 * past its lease still believes it holds it; the append it makes with the old fence is
 * refused as `StoreFenced`, in the same transaction as the insert.
 */
export interface LeasesShape {
  /** This engine copy's name as a holder: unique to the process. */
  readonly holder: string
  /** The lease and the record its last holder left, or `undefined` while another holder's is unexpired. */
  readonly take: (
    key: string,
    ttlMs: number,
  ) => Effect.Effect<{ readonly fence: number; readonly record?: unknown } | undefined, StoreFailed>
  /** `false` where `fence` no longer holds the lease. */
  readonly renew: (key: string, fence: number, ttlMs: number) => Effect.Effect<boolean, StoreFailed>
  /** Let go of the lease. The record stays for the next holder. */
  readonly release: (key: string, fence: number) => Effect.Effect<void, StoreFailed>
  /** Replace the lease's record; `undefined` clears it. `false` where `fence` no longer holds it. */
  readonly note: (
    key: string,
    fence: number,
    record: unknown,
  ) => Effect.Effect<boolean, StoreFailed>
  readonly read: (key: string) => Effect.Effect<LeaseRow | undefined, StoreFailed>
  readonly list: () => Effect.Effect<readonly LeaseRow[], StoreFailed>
}

export class Leases extends Context.Tag("workflow/Leases")<Leases, LeasesShape>() {}
