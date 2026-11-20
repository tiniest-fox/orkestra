// logic: the part of a kept pass's key, and of a unit proof's, that names the machine.
//
// One function for both keys and for `ork proofs`, because a proof published on one
// machine is read back on another by recomputing this string there: two spellings of it
// would be two keys that never meet.

import type { Check } from "../types/check.js"

/**
 * `linux arm64` under `cache_across: platform`, `linux` under `cache_across: os`. The
 * platform and architecture are arguments so the caller names whose machine it is —
 * `process.platform` and `process.arch` for this one.
 */
export const platformPart = (
  check: Pick<Check, "cacheAcross">,
  platform: string,
  arch: string,
): string => (check.cacheAcross === "os" ? platform : `${platform} ${arch}`)
