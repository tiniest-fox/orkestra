// types: the shape of a backup file — `.orkestra/backup.sh` for an engine, or `backup.sh`
// in the host's data directory. The engine decides what is backed up and when; the script
// decides where. Which provider holds the snapshots lives in the script and its
// `settings:`, never in the engine.

export interface Backup {
  /** Shown where the backup is named. */
  readonly description: string
  /**
   * The variables the script needs — a password beside a key pair, say. The script is
   * handed them and no other spawn is: a key that reached an agent could delete every
   * snapshot. So a runner `pass:` naming one is refused at load.
   */
  readonly secrets: readonly string[]
  /** How often a snapshot is taken. */
  readonly everyMinutes: number
  /**
   * The script's own configuration, each value reaching it as `ORKESTRA_BACKUP_<KEY>`
   * with the key upper-cased. The engine reads none of them.
   */
  readonly settings: Readonly<Record<string, string>>
  /**
   * The tool files the script runs, by name, each installed on its first call — as a
   * runner's `tools:` are. Absent for none.
   */
  readonly tools?: readonly string[]
  /** Absolute, because the engine spawns it. Supplied by the adapter. */
  readonly path: string
}
