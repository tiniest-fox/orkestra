import { Context, type Effect } from "effect"
import type { Check } from "../../library/types/check.js"
import type { ProofPrint } from "../../vcs/ports/vcs.js"
import type { StoreFailed } from "./store-errors.js"

/**
 * The step checks that passed, kept by what they ran on, so a check that passed on exactly
 * these files is accepted on that pass rather than run again.
 *
 * **Passes only**, for a whole check. A failure is run again every time: the agent sent back reads the
 * failure's output, and that has to come from a run of the files it is fixing.
 *
 * Kept per machine, not per trak: a pass in one checkout counts in every other holding
 * the same files.
 */
export interface PassesShape {
  /**
   * What a pass of `check` over the checkout's `tree` is kept under: the tree, the
   * script's text as it is on disk now, the check's name, and its platform part.
   * `undefined` where the script cannot be read, and a check with no key runs.
   *
   * Taken once, before the run, and recorded under after it: a check that writes files
   * changes the tree, and a key taken afterwards would never be asked for again.
   */
  readonly keyOf: (check: Check, tree: string) => Effect.Effect<string | undefined>
  readonly has: (key: string) => Effect.Effect<boolean, StoreFailed>
  readonly record: (key: string) => Effect.Effect<void, StoreFailed>
  /**
   * The tree `check` last passed on in the checkout at `cwd`, or `undefined` where it has
   * passed on none there. Handed to the check as `ORKESTRA_PASSED_TREE`, so a script can
   * choose its work by what changed since its last pass rather than since the branch
   * began: the engine commits after every step, so a branch's earlier steps are history
   * by the time a later step's checks run. By name and checkout, and not by script: a
   * pass of an older script is still a pass of that tree.
   */
  readonly lastPassed: (check: Check, cwd: string) => Effect.Effect<string | undefined, StoreFailed>
  readonly passedOn: (check: Check, cwd: string, tree: string) => Effect.Effect<void, StoreFailed>
  /**
   * What the units a check with `units:` proved on `tree` are kept under: the tree, the
   * label and the platform part — not the check's name or its script, so two checks
   * declaring one label read each other's. `undefined` for a check with no label, or one
   * that keeps no pass.
   *
   * **Unlike a pass, units are kept from a run however it ended.** A unit a check writes
   * is one it proved, so a failure or a timeout keeps the ones it finished; the unit that
   * failed was never written, and runs again.
   */
  readonly unitKeyOf: (check: Check, tree: string) => Effect.Effect<string | undefined>
  /** Every unit proven under `key`, each once. */
  readonly proven: (key: string) => Effect.Effect<readonly string[], StoreFailed>
  readonly prove: (key: string, units: readonly string[]) => Effect.Effect<void, StoreFailed>
  /**
   * What a check with `fingerprint:` keeps its prints under: its label, its sealed tools,
   * the recording format, and the OS and architecture whatever `cache_across:` says — and
   * no tree, since a print is checked against whatever checkout asks, and not whether the
   * machine trusts, since each print names what it leaned on. `undefined` for a check
   * that declares none, or keeps no pass.
   *
   * **A store of its own, which `proven` never reads.** A unit skipped on its print has not
   * run on this tree, so it is no proof of the tree: `ork proofs publish` carries the
   * prints beside the units proven on the tree, and CI skips on them under what its own
   * check accepts.
   */
  readonly printKeyOf: (check: Check) => Effect.Effect<string | undefined>
  /**
   * The units under `key` whose print leans on no assumption this machine does not accept,
   * and that every file in the checkout at `cwd` still agrees with. A trusting machine
   * accepts every assumption and a skeptical one only the floor — see `trustsOn`. Each
   * print that holds counts as used, so it outlives the unit's prints nobody skips on.
   */
  readonly printed: (key: string, cwd: string) => Effect.Effect<readonly string[], StoreFailed>
  /**
   * Every file of the prints under `key` — of `units` alone, where given — and the texts
   * they name, by the name each has inside the prints directory, so a copy laid out by
   * those names is a prints directory `adopt` takes.
   */
  readonly packed: (
    key: string,
    units?: readonly string[],
  ) => Effect.Effect<readonly ProofPrint[], StoreFailed>
  /**
   * Copy the prints under `key` in the prints directory `from` over this store's own, with
   * the texts they name, and answer the units they are of.
   */
  readonly adopt: (key: string, from: string) => Effect.Effect<readonly string[], StoreFailed>
  /**
   * Keep a print, from the hook's `recording` of a run in `cwd`, for each of `units` it
   * recorded with nothing it was unsure of — beside the prints the unit has on other content.
   */
  readonly print: (
    key: string,
    cwd: string,
    recording: string,
    units: readonly string[],
  ) => Effect.Effect<void, StoreFailed>
}

export class Passes extends Context.Tag("workflow/Passes")<Passes, PassesShape>() {}
