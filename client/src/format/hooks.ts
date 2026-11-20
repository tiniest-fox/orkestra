/**
 * What a run's hooks say, read off the `Hook` entries `gather` put in it: which call each
 * ran for, the one status a mark stands for, and the inks the mark and its card draw in.
 */

import type { HookEntryDto, TranscriptEntryDto } from "../api/types"
import { toneInk } from "./tone"

type HookStatus = HookEntryDto["status"]

/**
 * Blocked and stopped outrank failed: either changed what the agent did, where a failed
 * hook went wrong itself and left the call alone.
 */
const RANK: Record<HookStatus, number> = { completed: 0, failed: 1, stopped: 2, blocked: 2 }

/** The status one mark stands for, over every hook on its call. */
export const worstHook = (hooks: readonly HookEntryDto[]): HookStatus =>
  hooks.reduce<HookStatus>(
    (worst, h) => (RANK[h.status] > RANK[worst] ? h.status : worst),
    "completed",
  )

/** The mark's ink: faint when every hook ran cleanly, a tone when one did not. */
export const hookInk: Record<HookStatus, string> = {
  completed: "text-fg-subtle/60",
  failed: toneInk.bad,
  blocked: toneInk.waiting,
  stopped: toneInk.waiting,
}

/** The card's word for how a hook ended. */
export const hookWord: Record<HookStatus, string> = {
  completed: "ran",
  failed: "failed",
  blocked: "blocked",
  stopped: "stopped",
}

/**
 * The ink of a printed line's kind label. Keyed by the provider's words; a word it adds
 * later draws in the quietest ink rather than not at all.
 */
const OUTPUT_INK: Readonly<Record<string, string>> = {
  warning: toneInk.waiting,
  stop: toneInk.waiting,
  error: toneInk.bad,
  feedback: "text-fg-muted",
}

export const outputInk = (kind: string): string => OUTPUT_INK[kind] ?? "text-fg-subtle"

export const hookDuration = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`

/** The hooks in a run that ran for the call `call`. */
export const hooksOn = (
  group: readonly TranscriptEntryDto[],
  call: string | undefined,
): readonly HookEntryDto[] =>
  call === undefined ? [] : group.flatMap((e) => (e._tag === "Hook" && e.call === call ? [e] : []))

/** The hooks in a run that name none of its calls — each drawn as a quiet line of its own. */
export const strayHooks = (group: readonly TranscriptEntryDto[]): readonly HookEntryDto[] => {
  const calls = new Set(group.flatMap((e) => (e._tag === "Tool" ? [e.call] : [])))
  return group.flatMap((e) =>
    e._tag === "Hook" && (e.call === undefined || !calls.has(e.call)) ? [e] : [],
  )
}

/** How a mark names itself to a screen reader: `2 hooks, blocked`. */
export const hookLabel = (hooks: readonly HookEntryDto[]): string => {
  const worst = worstHook(hooks)
  const count = `${hooks.length} ${hooks.length === 1 ? "hook" : "hooks"}`
  return worst === "completed" ? count : `${count}, ${worst}`
}
