/**
 * The project checkout's files as git sees them: every tracked file still on disk, and
 * every untracked one `.gitignore` does not exclude. Relative to `root`, which is the
 * checkout's absolute path — the paths name nothing without it.
 */
export interface ProjectFiles {
  readonly root: string
  readonly paths: readonly string[]
}

/** One line of one file that holds the text a search asked for. */
export interface ProjectMatch {
  readonly path: string
  /** 1-based, as git numbers it. */
  readonly line: number
  readonly text: string
}

/** What a search of the project checkout found, and whether the cap cut it short. */
export interface ProjectGrep {
  readonly matches: readonly ProjectMatch[]
  readonly cut: boolean
}
