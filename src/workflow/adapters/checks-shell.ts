// The only Layer here: run a project's script by spawning it, over the Process
// port. Every script kind goes through here — a step's `checks:`, its `effects:`,
// `worktrees/setup.sh` and `worktrees/teardown.sh`.
//
// `bash <path>`, and arguments only where the caller has a fact the script cannot
// read off the directory it runs in — `deploy.sh` is handed the merge commit, and
// nothing else takes any. Everything else a script reads is already there: the
// repository a step just changed, and the trak's own paperwork under
// `.orkestra/.trak/`, which the caller rebuilds before running anything that needs
// it. What is always passed in is the environment: the project's env script,
// captured over `Environment` in that same directory just before the spawn, so a
// check finds the toolchain the repository pins rather than the one the engine was
// started under.
//
// Nothing here interprets the script's intent. The Process port's own docstring
// makes the point: one of these legitimately exits non-zero, so deciding what that
// means is the caller's job — and which caller it is decides which meaning.
//
// **It publishes, which no other adapter does.** A `verify` is minutes long, so the
// output has to reach a watcher while it is being produced rather than once at the end;
// the alternative — writing it down and letting the feed carry the append — is the one
// thing the capture backstop below exists to refuse. So this holds the run in memory,
// answers `live` off it, and puts the deltas on the `Feed` itself. See `Frame`.

import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Clock, Duration, Effect, HashMap, Layer, Option, Ref, Schedule, Stream } from "effect"
import { type Place, Places } from "../../agent/types/place.js"
import { Process, type ProcessShape, type ProcessSpec } from "../../agent/ports/process.js"
import type { Check } from "../../library/types/check.js"
import { loadedHook } from "../../recording/index.js"
import { Sandboxes, type SandboxesShape } from "../../vcs/ports/sandboxes.js"
import type { TrakId } from "../domain/trak.js"
import {
  type CheckAt,
  type CheckOutcome,
  type CheckRun,
  Checks,
  type ChecksShape,
  type CheckUnits,
} from "../ports/checks.js"
import { Environment, type EnvironmentShape } from "../ports/environment.js"
import { Feed, type FeedShape, Frame } from "../ports/feed.js"

/**
 * The most a check may write into the event log, kept from the END.
 *
 * **A backstop, not a budget.** How much of its output is worth reading is a
 * decision only the check script can make — it is the thing that knows which of
 * its lines is the failure and which is the 925 that passed — so the engine
 * stops making it. What is left here is the case a script cannot be trusted
 * with: a loop printing megabytes lands in an event the drawer refetches every
 * time it opens, and unlike a bad run that is permanent.
 *
 * Two orders of magnitude above anything a check written for a reader produces,
 * so a sane one never meets it.
 */
const CAPTURE_LIMIT_BYTES = 128 * 1024

/**
 * How much of a live run is held in memory, on the same argument one line up — this copy
 * is not permanent, but it is one per trak for as long as the daemon runs.
 *
 * A watcher that has been connected the whole time holds more than this, because it has
 * every chunk and nothing here tells it to drop any. They agree again at the end, when
 * `CheckEnded` replaces the output outright.
 */
const tail = (text: string): string =>
  text.length <= CAPTURE_LIMIT_BYTES ? text : `…\n${text.slice(-CAPTURE_LIMIT_BYTES)}`

/**
 * stderr first, then stdout, escapes and all.
 *
 * Diagnostics are what a check writes to stderr and they are what explains a
 * failure; stdout is usually the noise it made getting there. Putting stderr
 * first means the backstop keeps the explanation when a runaway check overruns.
 *
 * **Nothing here touches the bytes.** A check inherits `FORCE_COLOR`, so this
 * string carries colour whenever the failing tool colours into a pipe — which
 * some of `pnpm verify` does and most of it does not — and the readers disagree
 * about what to do with it: the drawer renders the colour, the agent's prompt
 * strips it, a terminal already understands it. So the log keeps the union and
 * each reader subtracts — stripping here would be the one subtraction nobody
 * could undo.
 */
const report = (stderr: string, stdout: readonly string[]): string =>
  tail([stderr.trim(), stdout.join("\n").trim()].filter((s) => s !== "").join("\n"))

/**
 * How often what the check has printed goes out as a frame.
 *
 * **A frame per line is what this exists to avoid.** The feed's replay ring holds 256
 * frames across every trak, so one chatty check would tell a reconnecting watcher of
 * some *other* trak that it had missed everything. A fifth of a second is invisible to
 * somebody reading a five-minute console and is two orders of magnitude fewer frames.
 *
 * **A fiber on a schedule, and not `Stream.groupedWithin`, which is the obvious way.**
 * That operator costs a timer race per element: at forty thousand lines — the runaway a
 * check is allowed to be — it took longer than the check's own timeout, so a script that
 * printed too much was killed for being slow at printing. Reading stays one `Ref`
 * append per line and the clock is somewhere else entirely.
 */
const CHUNK_WINDOW = Duration.millis(200)

/**
 * Where the output goes while the check runs, and nothing at all for a run nobody
 * is watching.
 *
 * An object of effects rather than an optional `at` threaded through every step: the
 * run itself is the same either way, and a branch per publish would put the setup
 * script's case in the middle of the reading loop.
 */
interface Watch {
  /** `queued` is a run opened to say it is waiting for the exclusive turn. */
  readonly started: (queued: boolean) => Effect.Effect<void>
  /** The script was spawned: the run says where, before anything it printed goes out. */
  readonly placed: (place: Place) => Effect.Effect<void>
  /** Buffers a line. Cheap on purpose — this one runs per line of a runaway. */
  readonly printed: (line: string) => Effect.Effect<void>
  /** Puts whatever is buffered on the feed. Nothing buffered, nothing published. */
  readonly flush: Effect.Effect<void>
  readonly ended: (outcome: CheckOutcome) => Effect.Effect<void>
  /** Settles a run a person ended, on what it had printed — there is no report to replace it. */
  readonly cancelled: Effect.Effect<void>
}

const silent: Watch = {
  started: () => Effect.void,
  placed: () => Effect.void,
  printed: () => Effect.void,
  flush: Effect.void,
  ended: () => Effect.void,
  cancelled: Effect.void,
}

/** The runs this process has seen, newest per trak. */
type Runs = Ref.Ref<HashMap.HashMap<TrakId, CheckRun>>

const watching = (
  runs: Runs,
  pending: Ref.Ref<string>,
  feed: FeedShape,
  check: Check,
  command: string,
  at: CheckAt,
): Watch => {
  const started = (queued: boolean) =>
    Effect.gen(function* () {
      const run: CheckRun = {
        step: at.step,
        name: check.name,
        command,
        limit: check.timeoutSeconds,
        startedAt: yield* Clock.currentTimeMillis,
        output: "",
        chunks: 0,
        ...(at.call === undefined ? {} : { call: at.call }),
        ...(queued ? { queued } : {}),
      }
      yield* Ref.update(runs, (held) => HashMap.set(held, at.trak, run))
      yield* feed.publish(Frame.CheckStarted({ id: at.trak, run }))
    })

  // Sent as the run starting again, which a watcher takes in place of the one it holds: the
  // flush that would carry the first output has not been forked yet, so nothing is lost.
  const placed = (place: Place): Effect.Effect<void> =>
    Effect.flatMap(
      Ref.modify(runs, (held) => {
        const run = HashMap.get(held, at.trak)
        if (run._tag === "None" || run.value.step !== at.step) return [undefined, held]
        const next: CheckRun = { ...run.value, place }
        return [next, HashMap.set(held, at.trak, next)]
      }),
      (run) =>
        run === undefined ? Effect.void : feed.publish(Frame.CheckStarted({ id: at.trak, run })),
    )

  const printed = (line: string): Effect.Effect<void> =>
    Ref.update(pending, (held) => `${held}${line}\n`)

  /**
   * The record and the frame are produced from one `Ref.modify`, so the `seq` a watcher
   * compares against `chunks` is the one this run actually reached. Read-then-write
   * would let two flushes take the same number, which reads as a gap that never closes.
   */
  const flush = Effect.flatMap(Ref.getAndSet(pending, ""), (chunk) =>
    chunk === ""
      ? Effect.void
      : Ref.modify(runs, (held) => {
          const run = HashMap.get(held, at.trak)
          if (run._tag === "None" || run.value.step !== at.step) return [undefined, held]
          const next: CheckRun = {
            ...run.value,
            output: tail(run.value.output + chunk),
            chunks: run.value.chunks + 1,
          }
          return [next.chunks, HashMap.set(held, at.trak, next)]
        }).pipe(
          Effect.flatMap((seq) =>
            seq === undefined
              ? Effect.void
              : feed.publish(Frame.CheckOutput({ id: at.trak, step: at.step, seq, chunk })),
          ),
        ),
  )

  /** The run finished, one way or another: what it becomes, and the frame that says so. */
  const settle = (finish: (run: CheckRun, now: number) => CheckRun): Effect.Effect<void> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const settled = yield* Ref.modify(runs, (held) => {
        const run = HashMap.get(held, at.trak)
        if (run._tag === "None" || run.value.step !== at.step) return [undefined, held]
        const next = finish(run.value, now)
        return [next, HashMap.set(held, at.trak, next)]
      })
      if (settled !== undefined)
        yield* feed.publish(Frame.CheckEnded({ id: at.trak, run: settled }))
    })

  const ended = (outcome: CheckOutcome): Effect.Effect<void> =>
    settle((run, now) => ({
      ...run,
      // Replaced rather than appended to: what was watched is stdout in arrival
      // order, and what is settled is the report the agent is handed.
      output: outcome.output,
      finished: {
        verdict: outcome.passed ? "passed" : "failed",
        at: now,
        ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
      },
    }))

  // What was watched stays: nothing exited, so there is no report to put in its place.
  // Flushed first, so the last lines the script printed reach the console before the
  // frame that settles it.
  const cancelled: Effect.Effect<void> = Effect.andThen(
    flush,
    settle((run, now) => ({ ...run, finished: { verdict: "cancelled", at: now } })),
  )

  return { started, placed, printed, flush, ended, cancelled }
}

/**
 * What a queued exclusive check's console holds until its turn comes. Shown to a person
 * at the gate and replaced when the run starts, so it never reaches an agent.
 */
const QUEUED = "Waiting for another trak's check to finish — this one runs alone."

/** The one place the line is spelled. Reported on every outcome, so no caller rebuilds it. */
const commandFor = (check: Check, args: readonly string[]): string =>
  ["bash", check.path, ...args].join(" ")

/**
 * The two outcomes this file writes rather than captures, named after the script
 * rather than after its list: the same file is a check for one agent and an effect
 * for another, and *Check timed out* over a step's pull request would be this layer
 * asserting something it cannot know.
 *
 * No `exitCode`, because neither of these is an exit — see the port.
 */
const ranAground = (check: Check, args: readonly string[], said: string): CheckOutcome => ({
  passed: false,
  output: `${check.name} ${said}`,
  command: commandFor(check, args),
})

/**
 * The two variables a check with `units:` reads: a file to append each unit it proved
 * to, and a file of the units already proven under its label.
 */
const UNITS_OUT = "ORKESTRA_UNITS_OUT"
const UNITS_PROVEN = "ORKESTRA_UNITS_PROVEN"

/** The stage runner a check script runs its stages through, by path. */
const STAGES = "ORKESTRA_STAGES"

/**
 * The two files that record a run of a check with `fingerprint:`: `hook`, loaded into every
 * Node process the check starts, and `vitest`, the setup file the project's runner lists.
 * Both are Orkestra's, so the layer is handed where this build keeps them.
 */
export interface RecordingHook {
  readonly hook: string
  readonly vitest: string
}

/**
 * What the hook reads: where to write, which tools are sealed, and — for the project's
 * runner config — where the setup file is. `NODE_OPTIONS` is laid over the captured
 * environment's own rather than replacing it, and names `loaded`, the file Node imports.
 */
const recordingEnv = (
  hook: RecordingHook,
  loaded: string,
  dir: string,
  sealed: readonly string[],
): Readonly<Record<string, string>> => ({
  ORKESTRA_RECORDING_DIR: join(dir, "recording"),
  ORKESTRA_RECORDING_SEALED: sealed.join(","),
  ORKESTRA_RECORDING_VITEST: hook.vitest,
  ORKESTRA_RECORDING_SOURCE: hook.hook,
  NODE_OPTIONS: `--import=${pathToFileURL(loaded).href}`,
})

/**
 * The hook as Node is to import it: the checkout's `.ts` stripped of its types, and the
 * bundle's `.js` as it is. A `.ts` imported ahead of `tsx` makes every module `tsx` then
 * loads cost several times the messages between threads — a `node --import tsx` child of a
 * test took 1.3s rather than 0.6s — and a test file starting eight of them timed out.
 *
 * The copy is named for its bytes and kept, not made per run: a check a recorded test runs
 * hands its children the same hook again, and two paths would load it into one process
 * twice, each patching what the other patched.
 */
const loadedHookAt = async (hook: RecordingHook, dir: string): Promise<string> => {
  if (!hook.hook.endsWith(".ts")) return hook.hook
  const { text, file } = loadedHook(await readFile(hook.hook, "utf8"))
  const at = join(tmpdir(), file)
  // Written in the run's own directory and moved into place, so a run reads it whole.
  const part = join(dir, file)
  await writeFile(part, text)
  await rename(part, at)
  return at
}

/**
 * Every line a script finished writing. The text after the last newline is a line it was
 * still writing when it ended, and a half-written unit is not one it proved.
 */
const completeLines = (text: string): readonly string[] =>
  text
    .split("\n")
    .slice(0, -1)
    .filter((u) => u !== "")

/**
 * Where the check runs, when that is a trak's sandbox: the side files are made there, at
 * the same path as this machine's, before the check and copied back after it.
 */
interface SandboxedRun {
  readonly sandboxes: SandboxesShape
  readonly trak: string
}

/** The unit files as the check starts with them, by their names in the run's directory. */
const startingFiles = (units: CheckUnits): ReadonlyMap<string, string> =>
  new Map([
    ["proven", units.proven.map((u) => `${u}\n`).join("")],
    ["out", ""],
  ])

/**
 * What the check left in its directory in the sandbox, written into the same directory
 * here — `out` and the recording — and the sandbox's copy removed. A sandbox that stopped
 * under the check has lost its `/tmp`, so there is nothing to copy and the units are none.
 */
const copiedBack = (run: SandboxedRun, dir: string): Effect.Effect<void, unknown> =>
  Effect.asVoid(run.sandboxes.moveOut({ trak: run.trak, path: dir }, dir))

/**
 * Run `use` with the two unit files in a directory of their own, then hand the units back
 * however the run ends — the release runs on a failure and on an interruption as well.
 *
 * Files the engine cannot make are a run with neither variable set: the check runs whole,
 * which is the direction to be wrong in. A check with `fingerprint:` is recorded where
 * the layer was handed the hook, and runs unrecorded where it was not.
 *
 * **In a sandbox the directory is on both machines at one path**, so the variables name
 * the same file on either side: made here, placed there before the check, and copied back
 * here after it, where the units are read as they always are.
 */
const withUnitFiles = (
  units: CheckUnits,
  hook: RecordingHook | undefined,
  sandboxed: SandboxedRun | undefined,
  use: (env: Readonly<Record<string, string>>) => Effect.Effect<CheckOutcome>,
): Effect.Effect<CheckOutcome> =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const made = yield* Effect.tryPromise(async () => {
        const dir = await mkdtemp(join(tmpdir(), "orkestra-units-"))
        for (const [name, text] of startingFiles(units)) {
          // oxlint-disable-next-line no-await-in-loop -- two files
          await writeFile(join(dir, name), text)
        }
        const recording =
          hook === undefined || units.sealed === undefined
            ? {}
            : recordingEnv(hook, await loadedHookAt(hook, dir), dir, units.sealed)
        return { dir, recording }
      })
      if (sandboxed !== undefined) {
        yield* sandboxed.sandboxes.place(
          { trak: sandboxed.trak, path: made.dir },
          startingFiles(units),
          true,
        )
      }
      return made
    }).pipe(Effect.orElseSucceed(() => undefined)),
    (made) =>
      use(
        made === undefined
          ? {}
          : {
              [UNITS_OUT]: join(made.dir, "out"),
              [UNITS_PROVEN]: join(made.dir, "proven"),
              ...made.recording,
            },
      ),
    (made) =>
      made === undefined
        ? Effect.void
        : (sandboxed === undefined ? Effect.void : copiedBack(sandboxed, made.dir)).pipe(
            Effect.zipRight(Effect.tryPromise(() => readFile(join(made.dir, "out"), "utf8"))),
            Effect.flatMap((text) =>
              units.finished(
                completeLines(text),
                hook === undefined || units.sealed === undefined
                  ? undefined
                  : join(made.dir, "recording"),
              ),
            ),
            Effect.ignore,
            Effect.ensuring(
              Effect.promise(() =>
                rm(made.dir, { recursive: true, force: true }).catch(() => undefined),
              ),
            ),
          ),
  )

/** The captured `NODE_OPTIONS` with the recording hook's import after it, where there is one. */
const nodeOptions = (
  captured: Readonly<Record<string, string>>,
  unitFiles: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  const added = unitFiles["NODE_OPTIONS"]
  if (added === undefined) return {}
  const before = captured["NODE_OPTIONS"]
  return { NODE_OPTIONS: before === undefined || before === "" ? added : `${before} ${added}` }
}

/** What a run's spawns are handed beyond the script: what is laid over the capture, and where. */
interface Spawning {
  readonly unitFiles: Readonly<Record<string, string>>
  readonly placed: Pick<ProcessSpec, "inProject" | "passOnly">
}

const runCheck = (
  proc: ProcessShape,
  environment: EnvironmentShape,
  check: Check,
  cwd: string,
  args: readonly string[],
  watch: Watch,
  { unitFiles, placed }: Spawning,
): Effect.Effect<CheckOutcome> =>
  Effect.gen(function* () {
    // Inside the check's own timeout and its own catch: an env script that fails is
    // this check failing, with the script's stderr as the report, and the run a
    // watcher holds is settled the same way. Placed as the script is: a capture here
    // would hand a script in the project's sandbox this machine's whole environment.
    const captured = yield* environment.capture(cwd, undefined, placed)
    const spawned = yield* proc.spawn({
      command: "bash",
      args: [check.path, ...args],
      cwd,
      // Merged over the parent environment, so a check still has PATH and can
      // find the tools a developer would run by hand — but not the engine's own
      // `ORKESTRA_*`, which the Process port strips from the base and `Environment`
      // strips from what the script exported. A check that boots anything
      // (the browser tier's Playwright spawns `pnpm ui:both`) therefore
      // derives its own ports and its own project instead of the daemon's. The unit
      // files and the caller's `env` are laid over the capture, so neither strip
      // reaches them.
      env: { ...captured, ...unitFiles, ...nodeOptions(captured, unitFiles) },
      stdin: undefined,
      holdStdin: false,
      ...placed,
    })
    const place = spawned.place ?? Places.local()
    yield* watch.placed(place)
    // Into the scope the spawn is in, so it is interrupted with the check however the
    // check ends — including the timeout, which closes this scope from outside.
    yield* Effect.forkScoped(Effect.repeat(watch.flush, Schedule.spaced(CHUNK_WINDOW)))
    // Drained before awaiting exit: a full stdout pipe would otherwise block
    // the child forever, which would look exactly like a hang and burn the
    // whole timeout. stderr is already buffered by the Process adapter — which
    // is also why a live console carries stdout alone, and why the report a
    // failure settles on is the first time the two are seen together.
    const stdout = yield* Stream.runCollect(Stream.tap(spawned.lines, watch.printed))
    const exited = yield* spawned.exited
    return {
      passed: exited.code === 0,
      output: report(exited.stderr, [...stdout]),
      command: commandFor(check, args),
      ...(exited.code === undefined ? {} : { exitCode: exited.code }),
      place,
    }
  }).pipe(
    // Scoped INSIDE the timeout, so timing out closes the scope and the
    // finalizer kills the whole process group. The other way round, the check
    // keeps running after we stop waiting for it.
    Effect.scoped,
    Effect.timeoutTo({
      duration: Duration.seconds(check.timeoutSeconds),
      onTimeout: (): CheckOutcome =>
        ranAground(check, args, `timed out after ${check.timeoutSeconds}s.`),
      onSuccess: (outcome) => outcome,
    }),
    // A script that cannot be spawned is a script that failed — see the port, and
    // so is one whose environment could not be produced. The alternative strands
    // the trak in the state that was waiting on it, with nothing to move it.
    Effect.catchAll((e) =>
      Effect.succeed({
        ...ranAground(check, args, `could not be run: ${e.reason}`),
        ...(e.runnersOnly === undefined ? {} : { runnersOnly: e.runnersOnly }),
        ...(e.carried === undefined ? {} : { carried: e.carried }),
      }),
    ),
    // After the three ways out, so a timeout and a spawn that never happened both
    // settle the run a watcher is holding. Nothing above this line can fail.
    Effect.tap((outcome) => watch.ended(outcome)),
    // **Interruption is the fourth way out, and it takes none of the three.** A person
    // ending the run interrupts the fiber from outside; the unwinding closes the scope,
    // which kills the process group, and skips every tap above — so without this the
    // adapter holds the run unfinished and hands it to every reload as still going.
    // Outermost, so the scope has closed and the process is dead before the run settles.
    // A timeout is not this: it interrupts the inner effect and this pipe succeeds.
    Effect.onInterrupt(() => watch.cancelled),
  )

/**
 * `hook` is where this build keeps the recording hook; without it nothing is recorded.
 * `stages` is where it keeps the stage runner, handed to every check as `ORKESTRA_STAGES`
 * whether or not it declares `units:`, since a script may call the runner for a test stage
 * whatever it declares.
 */
export const ShellChecksLayer = (
  hook?: RecordingHook,
  stages?: string,
): Layer.Layer<Checks, never, Process | Environment | Feed> =>
  Layer.effect(
    Checks,
    Effect.gen(function* () {
      const proc = yield* Process
      const environment = yield* Environment
      const feed = yield* Feed
      const sandboxes = yield* Effect.serviceOption(Sandboxes)
      /** The trak's sandbox a check in `cwd` runs in, or nothing for one on this machine. */
      const sandboxedAt = (cwd: string): Effect.Effect<SandboxedRun | undefined> =>
        Option.match(sandboxes, {
          onNone: () => Effect.succeed(undefined),
          onSome: (held) =>
            Effect.map(held.placeOf(cwd), (place) =>
              place === undefined ? undefined : { sandboxes: held, trak: place.trak },
            ),
        })
      /** The project's own place, under an external store; nothing where it has none. */
      const projectPlace = Option.match(sandboxes, {
        onNone: () => Effect.succeed(undefined),
        onSome: (held) =>
          Effect.map(held.project, (place) =>
            place === undefined ? undefined : { sandboxes: held, place },
          ),
      })
      /**
       * Kept rather than cleared when a run finishes, because the run is what somebody
       * standing at the gate is reading — a passing check whose console emptied the
       * moment it passed would be a console nobody could ever look at. It only grows by
       * one entry per trak this process has checked, each capped at the backstop above.
       */
      const runs: Runs = yield* Ref.make(HashMap.empty<TrakId, CheckRun>())
      /** The one turn every `exclusive:` check on this machine queues for, across every trak. */
      const exclusive = yield* Effect.makeSemaphore(1)

      const shape: ChecksShape = {
        run: (check, cwd, at, args = [], units, given = {}, inProject) =>
          Effect.gen(function* () {
            const env = stages === undefined ? given : { [STAGES]: stages, ...given }
            // Per run rather than per adapter: checks are sequential within a trak but not
            // across them, and one buffer shared between two would interleave their lines.
            const pending = yield* Ref.make("")
            const watch =
              at === undefined
                ? silent
                : watching(runs, pending, feed, check, commandFor(check, args), at)
            const project = inProject === true ? yield* projectPlace : undefined
            const placed =
              project === undefined ? {} : { inProject: true as const, passOnly: true as const }
            const sandboxed =
              project !== undefined
                ? { sandboxes: project.sandboxes, trak: project.place.trak }
                : units === undefined && !check.exclusive
                  ? undefined
                  : yield* sandboxedAt(cwd)
            const dir = project?.place.path ?? cwd
            const go = Effect.andThen(
              watch.started(false),
              units === undefined
                ? runCheck(proc, environment, check, dir, args, watch, { unitFiles: env, placed })
                : withUnitFiles(units, hook, sandboxed, (unitFiles) =>
                    runCheck(proc, environment, check, dir, args, watch, {
                      unitFiles: { ...env, ...unitFiles },
                      placed,
                    }),
                  ),
            )
            // A check in a trak's sandbox has that machine to itself: the queue is for
            // cores this machine shares, and holding it would only serialize machines
            // that never contend.
            if (!check.exclusive || sandboxed !== undefined) return yield* go
            const now = yield* exclusive.withPermitsIfAvailable(1)(go)
            if (now._tag === "Some") return now.value
            // A run opened while it queues, so the gate's console says why nothing is
            // happening. Opened again once it has the turn — the clock a watcher draws
            // starts there, and the waiting line goes with the replaced output.
            yield* watch.started(true)
            yield* watch.printed(QUEUED)
            yield* watch.flush
            // Settled here only if it is stopped while still queued: once `go` has
            // begun, its own `onInterrupt` settles it.
            const begun = yield* Ref.make(false)
            return yield* exclusive
              .withPermits(1)(Effect.andThen(Ref.set(begun, true), go))
              .pipe(
                Effect.onInterrupt(() =>
                  Effect.flatMap(Ref.get(begun), (b) => (b ? Effect.void : watch.cancelled)),
                ),
              )
          }),
        live: (id) =>
          Effect.map(Ref.get(runs), (held) => {
            const run = HashMap.get(held, id)
            return run._tag === "None" ? undefined : run.value
          }),
      }
      return shape
    }),
  )
