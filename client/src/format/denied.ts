/**
 * What a run's `Denied` entries say: the denial on a call, and the rule that refused it
 * in the words a row draws.
 */

import type { DeniedEntryDto, TranscriptEntryDto } from "../api/types"

/** The denial the CLI wrote for the call `call`, where it wrote one. */
export const deniedOn = (
  group: readonly TranscriptEntryDto[],
  call: string | undefined,
): DeniedEntryDto | undefined =>
  call === undefined
    ? undefined
    : group.find((e): e is DeniedEntryDto => e._tag === "Denied" && e.call === call)

/**
 * The rule a denial names, without the brackets Claude writes around a classifier rule
 * — `[Safety Bypass Flag]` draws as `Safety Bypass Flag`. Falls back to what kind of
 * thing refused, and to nothing where the line said neither.
 */
export const deniedRule = (denied: DeniedEntryDto): string | undefined => {
  const reason = denied.reason?.trim()
  if (reason === undefined || reason === "") return denied.source
  return /^\[(.+)\]$/.exec(reason)?.[1] ?? reason
}

/** One line for a slot that holds a string: `Denied — Safety Bypass Flag`. */
export const deniedText = (denied: DeniedEntryDto): string => {
  const rule = deniedRule(denied)
  return rule === undefined ? "Denied" : `Denied — ${rule}`
}
