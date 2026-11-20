// The shell adapter against the real `bash`. Slower than the rest of the suite
// and worth it: everything above this file takes an outcome as given.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import type { Check } from "../../src/library/types/check.js"
import { Lib } from "../../src/library/ports/library.js"
import { ShellChecksLayer } from "../../src/workflow/adapters/checks-shell.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { ShellEnvironmentLayer } from "../../src/workflow/adapters/environment-shell.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { type CheckOutcome, Checks } from "../../src/workflow/ports/checks.js"
import { library } from "../support/library.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { checksContract } from "./checks.js"

checksContract({
  label: "shell",
  // A real feed rather than a fake: `publish` is the one thing on it this adapter uses,
  // it cannot fail, and a run nobody subscribes to publishes into a ring and stops there.
  // The environment is real too, over a library with no env script — what every
  // project had before one existed.
  layer: ShellChecksLayer().pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeProcessLayer,
        PubSubFeedLayer,
        ShellEnvironmentLayer().pipe(
          Layer.provide(Layer.merge(NodeProcessLayer, Layer.succeed(Lib, library()))),
        ),
      ),
    ),
  ),
  timeoutMs: 15_000,
})

/**
 * Beyond the contract, which every implementation answers: this adapter is the one
 * that sources the project's env script before the spawn, and that is what a check
 * finding the repository's toolchain rests on.
 */
const withEnv = (
  env: Check | undefined,
  sandboxes?: SandboxesShape,
  stages?: string,
): Layer.Layer<Checks> => {
  const environment = ShellEnvironmentLayer().pipe(
    Layer.provide(Layer.merge(NodeProcessLayer, Layer.succeed(Lib, library({ env })))),
  )
  const held =
    sandboxes === undefined
      ? Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, environment)
      : Layer.mergeAll(
          NodeProcessLayer,
          PubSubFeedLayer,
          environment,
          Layer.succeed(Sandboxes, sandboxes),
        )
  return ShellChecksLayer(undefined, stages).pipe(Layer.provide(held))
}

const unused = Effect.die("not called in this test")

/** A runner that places every directory in one trak's sandbox, and is asked nothing else. */
const placing: SandboxesShape = {
  inUse: Effect.succeed(true),
  holds: () => Effect.succeed(true),
  create: () => unused,
  status: () => unused,
  idOf: () => Effect.succeed(undefined),
  list: unused,
  expose: () => unused,
  reach: () => unused,
  healthThrough: () => unused,
  release: () => unused,
  kill: () => unused,
  transfer: () => unused,
  retried: () => unused,
  placeOf: (path) => Effect.succeed({ trak: "t1", path }),
  project: Effect.succeed(undefined),
  place: () => unused,
  write: () => unused,
  collect: () => unused,
  moveOut: () => unused,
  readInside: () => unused,
  stats: () => unused,
  copyHomeBack: () => unused,
  copyHomeIn: () => unused,
  awake: () => unused,
  lost: () => Effect.void,
  resuming: () => Effect.succeed(false),
  remakeWith: () => Effect.void,
  stopIdleUnder: () => Effect.void,
  waitingBy: () => Effect.void,
  rebuild: () => unused,
  rebuildOf: () => unused,
  leftBehindTo: () => Effect.void,
  asWork: (work) => work,
  shell: () => unused,
}

const scratch = mkdtempSync(join(tmpdir(), "orkestra-checks-env-"))

const script = (name: string, body: string): Check => {
  const path = join(scratch, `${name}.sh`)
  writeFileSync(path, `#!/bin/bash\n# ---\n# description: ${name}\n# ---\n${body}\n`)
  return {
    name,
    description: name,
    timeoutSeconds: 10,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path,
  }
}

const run = (env: Check | undefined, check: Check, stages?: string): Promise<CheckOutcome> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(Checks, (checks) => checks.run(check, scratch)).pipe(
        Effect.timeout("15 seconds"),
        Effect.provide(withEnv(env, undefined, stages)),
      ),
    ),
  )

describe("the stage runner", () => {
  it("is handed to a check that declares no units, by the path the layer was given", async () => {
    const check = script("stages", `test "$ORKESTRA_STAGES" = /engine/check-stages.js || exit 1`)
    expect(await run(undefined, check, "/engine/check-stages.js")).toMatchObject({ passed: true })
  })
})

describe("a check under the project's env script", () => {
  it("sees what the script left exported", async () => {
    const env = script("env", "export ORK_TEST_TOOL=from-env")
    const check = script("uses-tool", `test "$ORK_TEST_TOOL" = from-env || exit 1`)
    expect(await run(env, check)).toMatchObject({ passed: true })
  })

  it("fails, with the script's stderr, when the script does — and never runs", async () => {
    // No fallback to the inherited environment: a check passing on the wrong ruby
    // is the bug being fixed, and the stderr is the only account of why.
    const env = script("env-broken", `echo "mise: ruby 3.3.0 is not installed" >&2; exit 3`)
    const check = script("never", "echo RAN; exit 0")
    const outcome = await run(env, check)
    expect(outcome).toMatchObject({ passed: false })
    expect(outcome.output).toContain("mise: ruby 3.3.0 is not installed")
    expect(outcome.output).not.toContain("RAN")
  })
})

describe("exclusive checks", () => {
  const log = join(scratch, "exclusive.log")

  /** Writes when it starts and ends, so two runs can be read for overlap. */
  const marked = (
    name: string,
    exclusive: boolean,
    seconds: number,
    timeoutSeconds = 10,
  ): Check => ({
    ...script(
      name,
      `echo "start ${name}" >> ${log}; sleep ${String(seconds)}; echo "end ${name}" >> ${log}`,
    ),
    exclusive,
    timeoutSeconds,
  })

  /** Both at once, on one adapter — the queue is the adapter's, so two layers would hold two. */
  const together = (
    a: Check,
    b: Check,
    sandboxes?: SandboxesShape,
  ): Promise<readonly CheckOutcome[]> => {
    writeFileSync(log, "")
    return Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(Checks, (checks) =>
          Effect.all([checks.run(a, scratch), checks.run(b, scratch)], { concurrency: 2 }),
        ).pipe(Effect.timeout("15 seconds"), Effect.provide(withEnv(undefined, sandboxes))),
      ),
    )
  }

  const lines = (): readonly string[] =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split(" ")[0] ?? "")

  it("run one after the other", async () => {
    await together(marked("first", true, 0.3), marked("second", true, 0.3))
    expect(lines()).toEqual(["start", "end", "start", "end"])
  })

  it("run beside each other in a trak's sandbox, which no other trak's check shares", async () => {
    await together(marked("first", true, 0.3), marked("second", true, 0.3), placing)
    expect(lines()).toEqual(["start", "start", "end", "end"])
  })

  it("leave an ordinary check to run beside them", async () => {
    await together(marked("held", true, 0.3), marked("ordinary", false, 0.3))
    expect(lines()).toEqual(["start", "start", "end", "end"])
  })

  it("hold an agent's run queued behind another trak's, saying so under its call, then run it", async () => {
    writeFileSync(log, "")
    const [queued, settled] = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(Checks, (checks) =>
          Effect.gen(function* () {
            const other = { trak: TrakId.make("other"), step: 1 }
            const mine = { trak: TrakId.make("mine"), step: 1, call: "toolu_1" }
            const first = yield* Effect.fork(
              checks.run(marked("theirs", true, 0.6), scratch, other),
            )
            yield* Effect.sleep("150 millis")
            const second = yield* Effect.fork(checks.run(marked("mine", true, 0.1), scratch, mine))
            yield* Effect.sleep("150 millis")
            const waiting = yield* checks.live(mine.trak)
            yield* Fiber.join(first)
            yield* Fiber.join(second)
            return [waiting, yield* checks.live(mine.trak)] as const
          }),
        ).pipe(Effect.timeout("15 seconds"), Effect.provide(withEnv(undefined))),
      ),
    )
    expect(queued).toMatchObject({ call: "toolu_1", queued: true })
    expect(queued?.output).toContain("Waiting for another trak's check to finish")
    expect(settled).toMatchObject({ call: "toolu_1", finished: { verdict: "passed" } })
    expect(settled).not.toHaveProperty("queued")
    expect(lines()).toEqual(["start", "end", "start", "end"])
  })

  it("count their timeout from their turn, not from the queue", async () => {
    // The second waits about 1s for the first and then runs for 0.1s — inside a
    // 0.6s limit only if the wait is not charged to it.
    const outcomes = await together(marked("long", true, 1), marked("short", true, 0.1, 0.6))
    expect(outcomes.map((o) => o.passed)).toEqual([true, true])
  })
})

/**
 * The two files a check with `units:` is handed, and what comes back however the run ends.
 * The adapter's own, because the variables are how a script reaches them.
 */
describe("a check handed units", () => {
  const handed = async (
    check: Check,
    proven: readonly string[],
    interruptAfter?: number,
  ): Promise<{ outcome: CheckOutcome | undefined; units: readonly string[] | undefined }> => {
    let units: readonly string[] | undefined
    const finished = (u: readonly string[]) => Effect.sync(() => void (units = u))
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const checks = yield* Checks
          const fiber = yield* Effect.fork(
            checks.run(check, scratch, undefined, [], { proven, finished }),
          )
          if (interruptAfter === undefined) return yield* Fiber.join(fiber)
          yield* Effect.sleep(`${interruptAfter} millis`)
          yield* Fiber.interrupt(fiber)
          return undefined
        }).pipe(Effect.timeout("15 seconds"), Effect.provide(withEnv(undefined))),
      ),
    )
    return { outcome, units }
  }

  it("reads what is proven and appends what it proves; an unhanded check sees neither file", async () => {
    const reads = script(
      "reads-units",
      'cat "$ORKESTRA_UNITS_PROVEN"; printf "c.test.ts\\n" >> "$ORKESTRA_UNITS_OUT"',
    )
    const { outcome, units } = await handed(reads, ["a.test.ts", "b.test.ts"])
    expect(outcome?.output).toBe("a.test.ts\nb.test.ts")
    expect(units).toEqual(["c.test.ts"])
    const unhanded = script(
      "no-units",
      'echo "${ORKESTRA_UNITS_OUT-none} ${ORKESTRA_UNITS_PROVEN-none}"',
    )
    expect((await run(undefined, unhanded)).output).toBe("none none")
  })

  it("hands back what a failing run finished, leaving out a line it was still writing", async () => {
    const fails = script(
      "fails-midway",
      'printf "a.test.ts\\nb.te" >> "$ORKESTRA_UNITS_OUT"; exit 1',
    )
    const { outcome, units } = await handed(fails, [])
    expect(outcome?.passed).toBe(false)
    expect(units).toEqual(["a.test.ts"])
  })

  it("hands back what a run finished before its timeout", async () => {
    const slow = {
      ...script("times-out", 'printf "a.test.ts\\n" >> "$ORKESTRA_UNITS_OUT"; sleep 30'),
      timeoutSeconds: 0.3,
    }
    const { outcome, units } = await handed(slow, [])
    expect(outcome?.output).toContain("timed out")
    expect(units).toEqual(["a.test.ts"])
  })

  it("hands back what a run finished before it was interrupted", async () => {
    const ended = script("interrupted", 'printf "a.test.ts\\n" >> "$ORKESTRA_UNITS_OUT"; sleep 30')
    const { units } = await handed(ended, [], 300)
    expect(units).toEqual(["a.test.ts"])
  })
})

/**
 * The project's own `verify.sh`'s full tier, over a stage runner that prints the arguments
 * it was handed, one a line: which part and slice hand the runner which commands. What the
 * runner does with them is `test/check-stages.test.ts`'s.
 */
describe("verify.sh's full tier", () => {
  const handedBy = async (part: string, shard = "", durations = ""): Promise<string[]> => {
    const dir = join(scratch, "verify-full")
    mkdirSync(dir, { recursive: true })
    copyFileSync(join(process.cwd(), ".orkestra", "checks", "verify.sh"), join(dir, "verify.sh"))
    const stages = join(dir, "stages.cjs")
    writeFileSync(stages, `console.log(process.argv.slice(2).join("\\n"))\n`)
    const env = `ORKESTRA_STAGES=${JSON.stringify(stages)} VERIFY_PART=${part} VERIFY_SHARD=${shard} TEST_DURATIONS_OUT=${durations}`
    const check = script(
      `verify-${part}-${shard.replace("/", "-")}`,
      `cd ${JSON.stringify(dir)} && ${env} bash verify.sh`,
    )
    const outcome = await run(undefined, check)
    expect(outcome.passed).toBe(true)
    return outcome.output.trim().split("\n")
  }

  it("hands the runner the whole chain where no part is named", async () => {
    expect(await handedBy("all")).toEqual(["--parallel", "pnpm verify"])
  })

  it("runs the static stages in the first slice of the engine's suite and not the others", async () => {
    const statics = ["pnpm fmt:check", "pnpm check", "pnpm lint", "pnpm knip", "pnpm docs:check"]
    expect(await handedBy("engine")).toEqual(["--parallel", ...statics, "pnpm test"])
    expect(await handedBy("engine", "1/2")).toEqual([
      "--parallel",
      ...statics,
      "pnpm test --shard=1/2",
    ])
    expect(await handedBy("engine", "2/2")).toEqual(["pnpm test --shard=2/2"])
  })

  it("adds the durations reporter to the engine's suite where CI asks for durations", async () => {
    const handed = await handedBy("engine", "2/2", "/tmp/durations.jsonl")
    expect(handed).toEqual([
      `pnpm test --shard=2/2 --reporter=${join(scratch, "verify-full")}/test/support/durations-reporter.ts`,
    ])
  })

  it("hands the apps part each app's own chain", async () => {
    expect(await handedBy("apps")).toEqual([
      "pnpm --filter @orkestra/client verify",
      "pnpm --filter @orkestra/desktop verify",
    ])
  })
})
