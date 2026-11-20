/**
 * A goal's five settings as its controls hold them — traks at once, per hour, per day,
 * run modes and auto-merge — and the words each is drawn with.
 *
 * **Every option is a value here, absence included.** On the wire a limit left out is no
 * limit, `modes` left out allows all three and `autoMerge` left out is the composer
 * deciding; a control has to draw each of those as a choice, so `settingsOf` spells them
 * out and `limitsOf` folds them back. The engine replaces a goal's limits whole, so what
 * `limitsOf` returns is the entire setting, never a patch.
 */

import type { GoalLimitsDto, GoalSettingsDto, RunModeDto } from "../../api/types"
import { MODES } from "../../format/runMode"

export type Merge = "never" | "composer" | "always"
export type Limit = "parallel" | "perHour" | "perDay"

export interface Settings {
  readonly parallel: number | undefined
  readonly perHour: number | undefined
  readonly perDay: number | undefined
  /** Never empty: a goal that could open nothing is not one worth running. */
  readonly modes: readonly [RunModeDto, ...RunModeDto[]]
  readonly merge: Merge
}

export const LIMITS: readonly Limit[] = ["parallel", "perHour", "perDay"]

export const LIMIT_WORDS: Record<
  Limit,
  { readonly label: string; readonly unit: string; readonly none: string; readonly max: number }
> = {
  parallel: { label: "At once", unit: "at once", none: "any number at once", max: 10 },
  perHour: { label: "Per hour", unit: "an hour", none: "no hourly limit", max: 20 },
  perDay: { label: "Per day", unit: "a day", none: "no daily limit", max: 50 },
}

/** Where a limit turned on comes back to, when it has held no number on this screen. */
export const FIRST: Record<Limit, number> = { parallel: 2, perHour: 2, perDay: 10 }

export const limitText = (k: Limit, n: number | undefined): string =>
  n === undefined ? LIMIT_WORDS[k].none : `${String(n)} ${LIMIT_WORDS[k].unit}`

export const MERGES: readonly Merge[] = ["never", "composer", "always"]

export const MERGE_WORDS: Record<
  Merge,
  { readonly name: string; readonly short: string; readonly phrase: string }
> = {
  never: { name: "Never", short: "never", phrase: "Every pull request waits for you" },
  composer: {
    name: "Composer decides",
    short: "composer decides",
    phrase: "Chosen per trak as it opens",
  },
  always: { name: "Always", short: "always", phrase: "Merges once its checks pass" },
}

const nonEmpty = (modes: readonly RunModeDto[]): readonly [RunModeDto, ...RunModeDto[]] => {
  const [first, ...rest] = modes
  return first === undefined ? ["manual", "smart", "decider", "auto"] : [first, ...rest]
}

export const settingsOf = (limits: GoalLimitsDto): Settings => ({
  parallel: limits.parallel,
  perHour: limits.perHour,
  perDay: limits.perDay,
  modes: nonEmpty(MODES.filter((m) => limits.modes?.includes(m) ?? true)),
  merge: limits.autoMerge ?? "composer",
})

/** What the engine is sent: a key only where it limits something, as a file is written. */
export const limitsOf = (s: Settings): GoalSettingsDto => ({
  ...(s.parallel === undefined ? {} : { parallel: s.parallel }),
  ...(s.perHour === undefined ? {} : { perHour: s.perHour }),
  ...(s.perDay === undefined ? {} : { perDay: s.perDay }),
  ...(s.modes.length === MODES.length ? {} : { modes: s.modes }),
  ...(s.merge === "composer" ? {} : { autoMerge: s.merge }),
})

/** One mode turned on or off, in the order they are offered. The last one stays on. */
export const toggledMode = (s: Settings, m: RunModeDto): Settings => {
  const on = s.modes.includes(m)
  const next = MODES.filter((x) => (x === m ? !on : s.modes.includes(x)))
  return next.length === 0 ? s : { ...s, modes: nonEmpty(next) }
}

/** The only mode still on, which a press cannot turn off. */
export const modeLocked = (s: Settings, m: RunModeDto): boolean =>
  s.modes.length === 1 && s.modes[0] === m

export type SettingKey = Limit | "modes" | "merge"

/** Whether `key` differs between the two — the gate card's mark against the draft. */
export const differs = (from: Settings, to: Settings, key: SettingKey): boolean =>
  key === "modes" ? from.modes.join() !== to.modes.join() : from[key] !== to[key]

const KEYS: readonly SettingKey[] = [...LIMITS, "modes", "merge"]

export const sameSettings = (a: Settings, b: Settings): boolean =>
  KEYS.every((key) => !differs(a, b, key))
