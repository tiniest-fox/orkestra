// types: the shape of a `.orkestra/processes/*.sh` declaration — a long-running program a
// trak may keep up in its checkout: a dev server, a gallery, anything that listens.
//
// The same file kind as a check, read by the same comment-frontmatter rules, and the
// opposite contract: a check is judged by how it exits, and a hosted process is
// expected never to. Exiting is what it does when something went wrong.

/** Used when a declaration's header names no `ready_seconds`. */
export const DEFAULT_READY_SECONDS = 30

export interface HostedProcess {
  /** Derived from the filename: `dev.sh` -> `dev`. */
  readonly name: string
  /** Required, for the reason a check's is: what an agent is told the process is. */
  readonly description: string
  /**
   * Whether it serves a page a person would look at. A process without one is still
   * handed a port and still probed on it — an API server is that case — but nothing
   * offers to draw what it answers.
   */
  readonly page: boolean
  /**
   * How long the engine waits for `$PORT` to answer before it calls the start a failure
   * and kills the process. A run that exits before the port answers has failed too,
   * whatever its code: a second `atelier dev` exits 0 having pointed at the first one.
   */
  readonly readySeconds: number
  /**
   * The processes that have to be running before this one is spawned. Starting this one
   * starts them; stopping, restarting or an exit of one of them stops this one first.
   * Library assembly refuses a name nobody declares, and a cycle.
   */
  readonly needs: readonly string[]
  /** Absolute, because the supervisor spawns it. Supplied by the adapter. */
  readonly path: string
}

/**
 * The variable a turn finds a running process's address in — `dev-server` is
 * `HOSTED_DEV_SERVER_URL`. Not `ORKESTRA_`-prefixed: the engine strips that family from
 * every child, so a variable spelled that way would never arrive.
 */
export const urlVariable = (name: string): string =>
  `HOSTED_${name.toUpperCase().replaceAll("-", "_")}_URL`

/** A declaration in a trak's checkout that cannot be used, and why — reported, never fatal. */
export interface UnreadableProcess {
  /** The filename without `.sh`, or `processes` where the directory itself would not read. */
  readonly name: string
  /** The path a person would open, relative to the checkout. */
  readonly shown: string
  readonly reason: string
}

/**
 * What a trak's checkout declares: the project's processes with the checkout's own over
 * them by name, less any whose file or `needs:` is broken, which are in `unreadable`.
 */
export interface CheckoutProcesses {
  readonly processes: ReadonlyMap<string, HostedProcess>
  readonly unreadable: readonly UnreadableProcess[]
}
