import { Context, Data, type Effect } from "effect"
import type { Place } from "../../agent/types/place.js"
import type { SpawnStage } from "../../agent/types/spawn-stage.js"
import type { UnreadableProcess } from "../../library/types/process.js"
import type { TrakId } from "../domain/trak.js"

/**
 * Where a hosted process stands. The eight a surface draws, and `NotStarted` is a
 * declared process this engine has no run of.
 *
 * `Preparing` is a start before its script runs: the sandbox woken and sent its files,
 * the environment captured. `stage` is how far it has got, and each stage has a time
 * limit, so a start that stops moving ends `DidNotComeUp` naming the stage.
 *
 * `DidNotComeUp` is a start that failed — the port never answered in time, the script
 * exited before it did, or it could not be spawned at all — and the process is dead.
 * `Exited` is one that came up and later ended on its own. `StoppedByRestart` is one the
 * engine found still running from before it restarted, and killed: its log went with
 * the process that held it.
 */
export type HostedState = Data.TaggedEnum<{
  NotStarted: {}
  Preparing: { readonly port: number; readonly startedAt: number; readonly stage: SpawnStage }
  Starting: { readonly port: number; readonly startedAt: number }
  Running: {
    readonly port: number
    readonly startedAt: number
    readonly readyAt: number
    /** The loopback address that answered — `127.0.0.1` or `[::1]` — as a URL. */
    readonly url: string
  }
  DidNotComeUp: {
    readonly port: number
    readonly startedAt: number
    readonly at: number
    readonly reason: string
  }
  Exited: {
    readonly port: number
    readonly startedAt: number
    readonly at: number
    readonly code: number | undefined
    readonly signal: string | undefined
  }
  Stopped: { readonly port: number; readonly startedAt: number; readonly at: number }
  StoppedByRestart: { readonly at: number }
}>
export const HostedState = Data.taggedEnum<HostedState>()

/**
 * One declared process at one trak, as a watcher sees it: what the declaration says,
 * where it stands, and what its current run has printed.
 */
export interface HostedRun {
  readonly name: string
  readonly description: string
  readonly page: boolean
  readonly readySeconds: number
  /**
   * Which run this is — counted across the daemon, so a restart is told apart from the
   * run before it. `0` for a process that has never run here.
   */
  readonly run: number
  readonly state: HostedState
  /** stdout and stderr together, in arrival order, kept from the end. */
  readonly log: string
  /** How many `ProcessOutput` frames this run has sent — the gap detector. */
  readonly chunks: number
  /** Where this run's script runs, from the moment it is spawned. Absent before that. */
  readonly place?: Place
}

/**
 * A name no `.orkestra/processes/` script declares where it was asked for. `reason` is
 * there when a script by that name exists in a trak's checkout and cannot be used —
 * its path and what is wrong with it.
 */
export class UnknownProcess extends Data.TaggedError("UnknownProcess")<{
  readonly name: string
  readonly reason?: string
}> {}

/** What the boot reap did about one recorded process, for `serve.ts` to print. */
export interface ProcessReaped {
  readonly trak: TrakId | undefined
  readonly name: string
  readonly pid: number
  readonly outcome: "killed" | "gone" | "declined"
}

/**
 * The daemon's long-running processes: one per declared name per trak, each started in
 * that trak's checkout on a port the engine picked — and one per name on the project
 * checkout, which no trak owns. Where a method takes `trak: TrakId | undefined`,
 * `undefined` is the project checkout: a person starts and stops those, and no turn
 * runs there, so `stopAll` and `turnEnv` take a trak only.
 *
 * **Owned by the daemon, not by a drive.** A drive's scope closes on every stop,
 * recompose and archive, and a dev server has to outlive all of them, so the
 * supervisor's scope is the engine's. It ends a process on a stop, before the checkout
 * goes, and when the engine stops; a pid record is what lets the next boot kill one a
 * crash left behind.
 *
 * **No event is written for any of it.** A process never moves a trak — exiting,
 * failing to start and being stopped all leave the state where it was — so it lives in
 * memory and reaches a watcher as its own frames, the shape the check family has.
 */
export interface HostedProcessesShape {
  /**
   * Every declared process at this trak or the project, by name, run or not. A trak's
   * checkout `cwd` is read for its own declarations over the project's — see
   * `readCheckoutProcesses` — and `""` reads the one the trak was last seen at.
   */
  readonly list: (trak: TrakId | undefined, cwd: string) => Effect.Effect<readonly HostedRun[]>
  /**
   * `list`, with the declarations in the trak's checkout it leaves out and why — empty
   * for the project. One read of the checkout answers both, and under a runner that read
   * is a call to the sandbox.
   */
  readonly survey: (
    trak: TrakId | undefined,
    cwd: string,
  ) => Effect.Effect<{
    readonly runs: readonly HostedRun[]
    readonly unreadable: readonly UnreadableProcess[]
  }>
  /**
   * Start it in `cwd` unless it is starting or running already, and answer once it is
   * up or has failed to come up. A failure is a state, not an error.
   */
  readonly start: (
    trak: TrakId | undefined,
    cwd: string,
    name: string,
  ) => Effect.Effect<HostedRun, UnknownProcess>
  /** Stop it if it is running, then start it again. */
  readonly restart: (
    trak: TrakId | undefined,
    cwd: string,
    name: string,
  ) => Effect.Effect<HostedRun, UnknownProcess>
  /** Stop it, waiting for the group to die. A process not running is answered as it is. */
  readonly stop: (
    trak: TrakId | undefined,
    name: string,
  ) => Effect.Effect<HostedRun, UnknownProcess>
  /** Stop every process at this trak — the checkout is about to go. */
  readonly stopAll: (trak: TrakId) => Effect.Effect<void>
  /** What a turn at this trak is given over its own environment: each running process's URL. */
  readonly turnEnv: (trak: TrakId) => Effect.Effect<Readonly<Record<string, string>>>
  /**
   * Kill every process the record says a previous run of the engine left behind, where
   * the live pid is verifiably the one recorded, and show each as stopped by the restart.
   */
  readonly reap: Effect.Effect<readonly ProcessReaped[]>
}

export class HostedProcesses extends Context.Tag("workflow/HostedProcesses")<
  HostedProcesses,
  HostedProcessesShape
>() {}
