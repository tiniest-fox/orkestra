// port: how to RUN a command line. Separate from Provider, which knows WHAT to
// run and how to read it. That split is what keeps a PTY transport a later
// addition rather than a rewrite.

import { Context, type Effect, type Scope, type Stream } from "effect"
import type { ProcessFailed } from "../types/errors.js"
import type { Place } from "../types/place.js"
import type { SpawnStage } from "../types/spawn-stage.js"

export interface ProcessSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  /**
   * Merged over the parent environment, which an implementation hands on minus the
   * engine's own `ORKESTRA_*` and anything `withhold` names — a spawned process resolves its project and its engine
   * from where it stands, never from whoever spawned it. An entry here still wins, so
   * this is also how a caller sends one deliberately.
   */
  readonly env: Readonly<Record<string, string>>
  /**
   * Written to stdin. When undefined, stdin is 'ignore'. Prefer this over a
   * positional argument for anything large or user-supplied: it dodges ARG_MAX
   * and any variadic-flag ambiguity in the child's parser.
   */
  readonly stdin: string | undefined
  /**
   * Whether the pipe stays open after `stdin` is written. Held open, the caller
   * writes more with `Spawned.send` and `Spawned.endInput` is what closes it —
   * which for a CLI that tears down on stdin EOF is what decides when the
   * process may end. When false, the pipe closes as soon as `stdin` is written.
   */
  readonly holdStdin: boolean
  /**
   * Written to stdin verbatim before `stdin`, and makes stdin a pipe even where `stdin`
   * is undefined. How the runner layer hands a sandboxed command its environment ahead
   * of the command's own input.
   */
  readonly preamble?: string
  /**
   * Inherited variables this child is not handed, though the engine holds them. An
   * entry in `env` still wins, as it does over the rest of the inherited base.
   */
  readonly withhold?: readonly string[]
  /**
   * Values fetched for this spawn alone that stand where the engine's own environment
   * would: a spawn here inherits them over the engine's, and a sandboxed one is handed
   * only those its runner's `pass:` or its `credentials` name, as for any inherited value.
   * How a host's GitHub App token reaches a spawn without sitting in the engine's environment.
   */
  readonly inherits?: Readonly<Record<string, string>>
  /**
   * Inherited variables the child signs in with — the agent CLI's token. A spawn on
   * this machine inherits them anyway; a sandboxed one inherits nothing, and is handed
   * these and no other inherited value beyond the runner's `pass:`.
   */
  readonly credentials?: readonly string[]
  /**
   * Files the caller wrote on this machine for the command to read — the MCP
   * configuration a CLI is pointed at. A layer that runs the command on another machine
   * writes each there first, at the same path and readable by its owner alone, and
   * removes it once the command's scope has closed. A spawn here reads them where they are.
   */
  readonly carries?: readonly string[]
  /**
   * A read, which never starts a stopped sandbox: a command that would run in one runs
   * only where it is running, and otherwise exits `stopped` having run nothing. A spawn on
   * this machine ignores it.
   */
  readonly ifRunning?: boolean
  /**
   * `false` for a command that runs beside the work rather than as it — a declared
   * process. It starts a stopped sandbox as any work does, but while it runs it does not
   * keep the sandbox from its idle stop, which ends it. A spawn on this machine ignores it.
   */
  readonly keepsAwake?: boolean
  /**
   * Admitted on an engine that refuses project work on its own machine (`--runners-only`),
   * though it is neither git, gh nor the runner. Copied from `SessionRequest.allowedOnHost`;
   * every layer but that guard ignores it. A site that sets it adds an exception the host
   * names to the person, so it is listed beside the guard's variable.
   */
  readonly allowedOnHost?: true
  /**
   * The spawn names the project as its place rather than a checkout. Under an external store
   * with a runner, the runner layer runs it in the project's sandbox at the cache
   * checkout's path, after moving that checkout to `origin`'s default branch, whatever
   * `cwd` says; every other layer, and an engine with no external store, ignores it.
   */
  readonly inProject?: true
  /**
   * In a sandbox, handed of the engine's environment only the runner's `pass:` names and
   * the spec's `credentials` — never the host's named secrets (`carriedSecrets`). The
   * project's `deploy.sh`, which names in `pass:` every key it needs. A spawn on this
   * machine ignores it.
   */
  readonly passOnly?: true
  /**
   * An agent turn, which a layer running it in a sandbox starts so that it outlives the
   * connection to it — `Spawned.detached` says where that happened. A spawn on this
   * machine ignores it, and so does every check, effect and file copy: those stay attached.
   */
  readonly detached?: boolean
  /**
   * The exec id of a detached command an engine that has since died started, to rejoin
   * rather than start again: its output from its start, its stdin from now, and its exit.
   * `stdin` and `preamble` are not written — the command already has them. A layer that
   * cannot rejoin one, a spawn on this machine included, spawns the spec as if this were
   * absent.
   */
  readonly attach?: string
  /**
   * The id to run the command under in its sandbox, where the caller has to know it before
   * the spawn — a turn records it first, so a restart can stop it by that id. A layer that
   * runs it there mints one where this is absent; a spawn on this machine ignores it.
   */
  readonly execId?: string
  /**
   * Told each stage a layer that runs the command in a sandbox reaches before the command
   * starts — see `SpawnStage`. A spawn on this machine reports none.
   */
  readonly onStage?: (stage: SpawnStage) => Effect.Effect<void>
}

export interface Exited {
  readonly code: number | undefined
  readonly signal: string | undefined
  readonly stderr: string
  /**
   * The command never ran: it was an `ifRunning` read, and its sandbox is stopped. The
   * code and the output then say nothing about the command, and what it would have read
   * is not readable now.
   */
  readonly stopped?: true
}

export interface Spawned {
  /** Also the process-group id, so the group can be signalled at once. */
  readonly pid: number
  readonly lines: Stream.Stream<string, ProcessFailed>
  readonly exited: Effect.Effect<Exited, ProcessFailed>
  /**
   * Write one line down a held-open stdin. Fails when the pipe is not open —
   * a spawn without `holdStdin`, one whose input has already ended, or one the
   * child stopped reading (an EPIPE on this or an earlier write) — because a
   * control line that went nowhere must not read as a control line sent. Never
   * an unhandled stream error: the implementation owns the pipe's `'error'`.
   */
  readonly send: (line: string) => Effect.Effect<void, ProcessFailed>
  /**
   * Close a held-open stdin. Idempotent — a pipe already ended is the outcome
   * asked for — and a no-op where nothing was held. Fails only where the pipe
   * has already failed under a write, for `send`'s reason; a caller for whom
   * the close was best-effort catches that tag and says so.
   */
  readonly endInput: Effect.Effect<void, ProcessFailed>
  /**
   * The id the runner knows the command by, on a spawn that runs in a sandbox. `pid` is
   * then the local `runner.sh`, and killing its group ends the remote command only while
   * that script is alive to forward the signal — so this is recorded beside the pid for
   * `killExec`. Absent on a spawn that runs on this machine.
   */
  readonly execId?: string
  /**
   * Where the command runs: its sandbox, the runner that made it and `execId`. Absent on a
   * spawn that runs on this machine, which a caller recording the place writes as `Local`.
   */
  readonly place?: Place
  /**
   * The command runs detached in its sandbox: killing `pid`'s group leaves it running, so
   * the layer stops it by `execId` when the scope closes — unless the engine is leaving,
   * when it is left for the next boot to rejoin. Absent on every attached spawn.
   */
  readonly detached?: true
}

export interface ProcessShape {
  /**
   * Spawns inside the current Scope. When the scope closes — normally, on
   * failure, or on interruption — the process group is killed, and with it any
   * group a descendant made for itself.
   *
   * Deliberately neutral about exit codes: a check script legitimately exits
   * non-zero, so interpreting the code is the caller's job.
   */
  readonly spawn: (spec: ProcessSpec) => Effect.Effect<Spawned, ProcessFailed, Scope.Scope>
  /** For crash recovery: is a pid from a previous run still alive? */
  readonly isAlive: (pid: number) => Effect.Effect<boolean>
  /**
   * Kill the process group led by `pid`, the same sequence a scope release uses
   * (`SIGCONT` → `SIGTERM` → grace → `SIGKILL`), and with it any group a
   * descendant made for itself. For a stray a scope no longer owns: the process
   * that would have released it is gone, along with the finalizer.
   */
  readonly kill: (pid: number) => Effect.Effect<void>
  /**
   * When a running process started, as `ps` prints it, or `undefined` if it cannot
   * be read (already gone, or the platform refuses). For crash recovery: whether a
   * live pid is genuinely the agent turn a trak recorded, or an unrelated process
   * that happens to reuse the number. Opaque text compared for equality — it is
   * read once when the agent is spawned and again when a stray is found, from the
   * same source, so a resolution or a format is never a question here.
   */
  readonly startTime: (pid: number) => Effect.Effect<string | undefined>
  /**
   * Stop one sandboxed command by its `execId`, wherever its local half went. For a stray
   * whose local `runner.sh` is already dead — after a reboot — so nothing is left to
   * forward a signal. Best effort and idempotent: a command already gone, or a project
   * with no runner, is nothing to do.
   */
  readonly killExec: (sandbox: string, execId: string) => Effect.Effect<void>
}

export class Process extends Context.Tag("agent/Process")<Process, ProcessShape>() {}
