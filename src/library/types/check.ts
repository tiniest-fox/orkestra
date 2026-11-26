// types: the shape of a `.orkestra/checks/*.sh` definition.
//
// An agent declares which of these run on its artifact, and the composer never
// sees them: verification is a property of the role, so *every agent that can
// write declares a check* is a rule you can state, where *every step that writes
// code gets `verify` attached* is one the composer has to remember on each plan.
//
// The objection to attaching checks per step is the **union**, not the coupling:
// two sources on one step have to union their checks, which makes verification an
// emergent property of whatever knowledge the step happened to carry. One agent,
// one definition, nothing to union.

/** Used when a check's frontmatter names no `timeout_seconds`. */
export const DEFAULT_CHECK_TIMEOUT = 60

/**
 * The least often a condition may be asked, in seconds. Below it a poll is a busy
 * loop against whatever the script consults — a forge, a deploy — and nothing a
 * trak waits on moves faster than this.
 */
export const CONDITION_MIN_INTERVAL = 60

/**
 * The two conditions the engine answers itself, named under an agent's `conditions:`
 * beside a project's own scripts and never backed by one.
 *
 * `merged` is the trak's branch having gone in — a merged pull request, or a merge
 * made from this machine. `deployed` is `merged` and then `.orkestra/deploy.sh`
 * saying the merge commit is live. A project may not name a check either word, and
 * may not list `deployed` without the script: both are refused where the library is
 * assembled, before any trak runs.
 */
export const ENGINE_CONDITIONS = ["merged", "deployed"] as const
export type EngineCondition = (typeof ENGINE_CONDITIONS)[number]

export const engineCondition = (name: string): EngineCondition | undefined =>
  ENGINE_CONDITIONS.find((c) => c === name)

/**
 * Where `deploy.sh` sits from the project's root. What the project's own place runs: the
 * file this machine read may be a copy of a commit, which that place does not hold.
 */
export const DEPLOY_SCRIPT = ".orkestra/deploy.sh"

/**
 * The name a plan entry's time wait is recorded under, beside the conditions an agent
 * declares. Not a condition an agent may list — `wait_until` is a field the composer
 * writes on the step, and the engine resolves and answers it with no script — and not
 * a name a script may take, refused where the library is assembled for the reason the
 * two above are: a script under it would answer the wrong wait.
 */
export const WAIT_UNTIL = "wait_until"

/** What a check's `cache_across:` may say. */
export const CACHE_ACROSS = ["platform", "os"] as const
export type CacheAcross = (typeof CACHE_ACROSS)[number]

/**
 * What `reaches:` may say — how far outside the checkout a worktree script's work
 * goes. `local` is the machine the script runs on and nothing else: a directory, a
 * container, a database on localhost. `external` is anything another machine holds —
 * a preview deployment, a branch of a cloud database, a row in somebody's API.
 */
export const REACHES = ["local", "external"] as const
export type Reaches = (typeof REACHES)[number]

export interface Check {
  /** Derived from the filename: `verify.sh` -> `verify`. */
  readonly name: string
  /**
   * Required, and read by two audiences that are both human-adjacent: it is
   * what a step's prompt says a check will judge it on — told up front, so an
   * agent can run it itself rather than spend a whole iteration being told —
   * and it is what the CLI shows when one fails.
   *
   * Not a selection signal any more. It was the composer's, the same way an
   * agent's `description` still is, until checks became the agent's.
   */
  readonly description: string
  /** Wall clock. A check that hangs is a check that failed. */
  readonly timeoutSeconds: number
  /**
   * How often the engine asks this script again while a trak waits on it — the
   * whole of the scheduling policy, with no backoff and no ceiling added.
   *
   * **Present on a condition and on nothing else.** A script named under an agent's
   * `conditions:` has to declare it, and one named only under `checks:` or
   * `effects:` may not: there the number would mean nothing and read as if it
   * did. Both are refused where the lists are known, in `assembleLibrary`.
   * `undefined` is the ordinary check.
   */
  readonly askedEverySeconds: number | undefined
  /**
   * Runs one at a time across every trak this engine drives, queued behind another
   * exclusive check rather than beside it. `timeoutSeconds` counts from the turn it
   * gets, not from the queue. A run in a trak's sandbox never queues: that machine is
   * the trak's own.
   *
   * For a check that already takes every core it is given: two of those at once take as
   * long together as one after the other, and each takes twice as long, so a run that
   * fits its timeout alone does not fit it beside another.
   */
  readonly exclusive: boolean
  /**
   * Whether a pass may be reused. A step's check that passed on exactly these files —
   * the same working tree, script text, name and platform part (`cacheAcross`) — is not run again,
   * and the step is accepted on the earlier pass.
   *
   * `false` for a check whose answer depends on anything outside the checkout: a
   * network call, the clock, a tool's version. Read only for a script under `checks:`;
   * effects and conditions act on or read the world, and are never reused.
   */
  readonly cache: boolean
  /**
   * Whether the files `.gitattributes` marks `linguist-generated` are left out of the tree
   * a pass is kept against, so editing only those reuses the pass. Pointed at the attribute
   * rather than at paths, so one line of `.gitattributes` extends every check that opted in.
   *
   * **A promise about the script, which the engine cannot check**: a check that reads one
   * of those files and says `true` here passes on a tree it never saw. `false` unless the
   * file says otherwise, and meaningless where `cache` is `false`.
   */
  readonly ignoresLinguistGenerated: boolean
  /**
   * The label this check's unit proofs are kept under, or `undefined` for a check that
   * reports none. A check with a label is handed two files: one it appends each unit it
   * proved to, a line each, and one listing the units already proven under the label on
   * this tree and platform part. Every check declaring the same label shares the proofs,
   * provided they agree on `ignoresLinguistGenerated` and `cacheAcross`, which set the
   * tree and the platform part.
   *
   * **The engine never reads a unit**, unless the check also declares `fingerprint:`. A line
   * is an opaque string one script wrote and a later script reads back; what it names is
   * the project's. Read only where `cache` is `true`, and refused on a script named under
   * `conditions:` or `effects:`.
   */
  readonly units: string | undefined
  /**
   * The tools a test may spawn and still be skipped, for a check that opts in to skipping a
   * unit whose recorded inputs are unchanged although the tree has changed. `undefined` for
   * a check that keeps its units by tree alone, and empty for one that opts in and trusts
   * no tool. Only on a check with `units:`.
   *
   * **Under it a unit is a test file's path from the checkout root**, because the engine
   * matches each unit to the recording of the file that ran. The check runs with the
   * recording hook loaded into every Node process it starts, and its test runner has to
   * list the hook's setup file — see `src/recording-hook.ts`.
   *
   * A listed tool is a promise the engine cannot check: that the tool, run in a directory
   * the test made, depends on nothing but its binary, its arguments and its environment.
   */
  readonly fingerprint?: readonly string[]
  /**
   * How much of the machine a kept pass and a unit proof are tied to: `platform` is the
   * OS and the architecture, `os` the OS alone. A check whose answer does not change
   * between architectures says `os`, so a proof made on one is found on the other.
   */
  readonly cacheAcross: CacheAcross
  /**
   * How far the script's work goes outside the checkout, and **read on
   * `worktrees/setup.sh` and `worktrees/teardown.sh` alone** — refused on every other
   * script in `assembleLibrary`, where `asked_every_seconds:` and `units:` are refused
   * for the same reason: a declaration nothing consults reads as a policy and sets none.
   *
   * It is a sandbox that reads it, and only a sandbox. Releasing one destroys
   * everything `local` work made, so a `local` teardown is skipped there and a `local`
   * setup runs again on every sandbox the trak is given. `external` work outlives the
   * sandbox: that teardown runs before the release, and that setup is not repeated,
   * because repeating it makes a second resource rather than finding the first.
   *
   * Absent is the two defaults a project has not chosen between, and they differ
   * because what each risks differs: an undeclared teardown runs, leaking nothing and
   * costing an `exec`, and an undeclared setup is run again, which is harmless for the
   * `local` work a setup usually does. Both are logged where the key would have
   * changed what happened. With no runner file nothing reads this at all.
   *
   * Optional rather than `Reaches | undefined`, as `fingerprint` is: a fixture that
   * declares no key is every script written before the key existed.
   */
  readonly reaches?: Reaches
  /**
   * Absolute, because the runner spawns it. The adapter supplies this — nothing
   * in `logic/` builds a path, which is what keeps `node:path` out of here.
   */
  readonly path: string
}
