// types: the failure vocabulary of this module.

import { Data } from "effect"
import type { ApiErrorKind } from "./provider-event.js"
import type { RunnerFailure } from "./runner-failure.js"

export class ElicitFailed extends Data.TaggedError("ElicitFailed")<{
  readonly reason: string
  readonly attempts: number
}> {}

/**
 * `kind` is the classification `ProviderEvent.ApiError` carried, kept so a consumer
 * reading the failure can act on the handle rather than on the sentence. Absent whenever
 * the failure was not one the provider reported in-band — a non-zero exit, a fake that
 * fails by construction — where there is no classification to make and `unclassified`
 * would be a claim nobody made.
 */
export class ProviderFailed extends Data.TaggedError("ProviderFailed")<{
  readonly provider: string
  readonly reason: string
  readonly kind?: ApiErrorKind
  /** The runner verb that failed under the CLI, carried up from `ProcessFailed`. */
  readonly runner?: RunnerFailure
  /** The runners-only guard's refusal of the CLI's spawn, carried up from `ProcessFailed`. */
  readonly runnersOnly?: string
  /** The ref holding the sandbox's uncommitted changes, carried up from `ProcessFailed`. */
  readonly carried?: string
  /** The rejoined command is gone from its sandbox, carried up from `ProcessFailed`. */
  readonly gone?: true
}> {}

/**
 * `runner` is present where the spawn failed because a runner verb did — a sandbox the
 * provider would not start, or one that could not be reached — and absent everywhere else.
 *
 * `runnersOnly` is present where the guard of an engine started under `--runners-only`
 * refused the spawn, as the guard's own sentence. It rides every failure built from this
 * one up to `TrakState.Failed`, so the trak's screen names the guard and its fix.
 *
 * `carried` is present where readying the sandbox remade it and the uncommitted changes
 * it captured were not put back — the ref that holds them, off `GitFailed.carried`. It
 * rides up the same way, so the screen says where they are.
 *
 * `gone` is present where a rejoin's first `attach` found no such command in the sandbox:
 * the turn a dead engine started ended with nothing this engine read of it. It rides up to
 * the runtime, which leaves the trak stopped rather than failed. A `gone` on any later
 * connection — the reattach after a drop — is absent here: that turn ran under this engine,
 * and its failure carries its reason and its spend.
 */
export class ProcessFailed extends Data.TaggedError("ProcessFailed")<{
  readonly command: string
  readonly reason: string
  readonly runner?: RunnerFailure
  readonly runnersOnly?: string
  readonly carried?: string
  readonly gone?: true
}> {}

/**
 * A request about an MCP server that the CLI holding the pipe did not answer with what
 * was asked for: it refused, the pipe closed with the answer owed, or the wait ran out.
 * Never raised for a session with no open pipe, which is an absence and not a failure.
 */
export class McpFailed extends Data.TaggedError("McpFailed")<{
  readonly reason: string
}> {}
