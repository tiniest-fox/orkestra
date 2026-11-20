// types: what a drafted goal declares, in the shape of a goal file.

/** The run modes a goal's traks may be opened on, spelled as a trak's `mode` is. */
export const GOAL_MODES = ["manual", "smart", "auto", "decider"] as const
export type GoalMode = (typeof GOAL_MODES)[number]

/**
 * Whether a goal's traks merge their own pull requests: `never`, or `always` once its
 * checks pass. Absent is neither — the composer decides per trak as it opens one.
 */
export const GOAL_AUTO_MERGES = ["never", "always"] as const
export type GoalAutoMerge = (typeof GOAL_AUTO_MERGES)[number]

/**
 * The bounds the engine holds a goal's composer to, each absent where the file sets none.
 * A composer's `open_trak` past one is refused with the reason, so a goal nobody is
 * watching cannot widen them.
 */
export interface GoalLimits {
  /** How many of the goal's traks may be live at once. */
  readonly parallel?: number
  readonly perHour?: number
  readonly perDay?: number
  /** The modes a trak may be opened on; absent allows all four. */
  readonly modes?: readonly [GoalMode, ...GoalMode[]]
  /**
   * `never` refuses a trak opened to merge its own pull request, `always` opens every one
   * that way; absent leaves it to the composer.
   */
  readonly autoMerge?: GoalAutoMerge
}

/**
 * One goal as a file would declare it. `name` is the kebab name its composer drafted.
 * `finished` is the body: the world once the goal is over, in the person's words.
 */
export interface GoalFile {
  readonly name: string
  readonly title: string
  readonly line: string
  readonly finished: string
  readonly limits: GoalLimits
  /**
   * The goal branch: where every trak of the goal lands, through its pull request or the
   * Merge press, and what one pull request into the default branch carries once the goal
   * is done. Absent, the traks land on the default branch as any trak does.
   */
  readonly branch?: string
}
