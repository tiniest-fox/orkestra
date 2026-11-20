// types: how far a spawn that runs in a sandbox has got before its command starts, for a
// caller that shows a person what the spawn is waiting on.

import { Data } from "effect"

/**
 * `Readying` is the sandbox being woken, its seed checked and, where it is stale and
 * nothing else holds it, remade. `Copying` is the files a command there reads being sent,
 * `sent` of `total`, reported before the first batch and after each one. `Launching` is
 * everything from the last of those to the command running.
 */
export type SpawnStage = Data.TaggedEnum<{
  Readying: {}
  Copying: { readonly sent: number; readonly total: number }
  Launching: {}
}>
export const SpawnStage = Data.taggedEnum<SpawnStage>()
