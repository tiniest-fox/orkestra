// types: a runner verb that failed, in the parts a person reads — what kind of failure
// it was, the sentence to lead with, and which runner file and verb said so.

import { Schema } from "effect"

/**
 * One runner verb's failure, carried beside the reason on `GitFailed`, `ProcessFailed`
 * and `ProviderFailed`, and from there onto `WorktreeFailed`, `TurnFailed` and
 * `TrakState.Failed`, so the trak's screen can lead with it.
 *
 * `kind` is the script's word, off `ORKESTRA_RUNNER_RESULT`: `limited` for a provider's
 * rate or quota limit, `unreachable` for a provider whose own API could not be reached,
 * `absent` for a trak that has no sandbox — the provider removed it, so nothing ran and
 * waiting brings nothing back — `lost` for a sandbox that could not be reached otherwise,
 * and `failed` for a provider that refused the request, or a verb that exited non-zero and
 * wrote none of them. `said` is the sentence to lead with — the script's own reason where
 * it wrote one, and otherwise the last line of its stderr.
 * `stderr` is everything the script printed there, kept for a person who wants the
 * provider's own words. `file` is the runner file relative to the project.
 *
 * A `Schema` as well as a type, because it is read back out of a stored log.
 */
export const RunnerFailure = Schema.Struct({
  kind: Schema.Literal("limited", "unreachable", "absent", "lost", "failed"),
  said: Schema.String,
  file: Schema.String,
  verb: Schema.String,
  stderr: Schema.String,
})
export type RunnerFailure = Schema.Schema.Type<typeof RunnerFailure>
