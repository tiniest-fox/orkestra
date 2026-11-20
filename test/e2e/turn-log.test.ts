// What the engine says about a turn on its own output, which is what `pnpm host` keeps in
// `logs/<id>.log`: one INFO line when a goal composer turn starts, ends, fails or is
// interrupted, and when a trak step's turn starts and ends — each naming the goal or the
// trak, the session, and, at the end, how long the turn took. Without them the log cannot
// say why a goal showed "composing".

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Logger, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { GoalDrives } from "../../src/app/goal-drives.js"
import {
  type GoalEvent,
  GoalEvents,
  type GoalSpec,
  replayGoal,
} from "../../src/workflow/domain/goal.js"
import type { GoalId, TrakId } from "../../src/workflow/domain/trak.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import type { Library } from "../../src/library/types/library.js"
import type { RuntimeError } from "../../src/workflow/runtime.js"
import { composer, type FlowDeps, runFlowWithAgentLog, step } from "../support/flow.js"
import { mount } from "../support/http.js"
import { goalRoutes, startGoal } from "../../src/app/goals.js"
import { createAndStart } from "../support/scenario.js"
import { library } from "../support/library.js"
import {
  type AgentLog,
  crashesOn,
  hangsOn,
  onPrompt,
  reply,
  type Turn,
} from "../support/scripted-agent.js"

const { call } = mount(goalRoutes)

/** Every line logged while `body` runs and in every fiber it forks, as `LEVEL: message`. */
const capturing = <A, E, R>(
  body: (lines: readonly string[]) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const lines: string[] = []
  const logger = Logger.make(({ logLevel, message }) => {
    const parts: readonly unknown[] = Array.isArray(message) ? message : [message]
    lines.push(`${logLevel.label}: ${parts.map(String).join(" ")}`)
  })
  return body(lines).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger)))
}

/** The INFO lines naming every one of `words`. */
const infoNaming = (lines: readonly string[], ...words: readonly string[]): readonly string[] =>
  lines.filter((line) => line.startsWith("INFO: ") && words.every((w) => line.includes(w)))

/** A duration as a person reads one: `12ms`, `3.4s`, `2m 5s`. */
const DURATION = /\b\d+(\.\d+)?\s?(ms|s|m)\b/u

const SHIP: GoalSpec = {
  file: "ship",
  title: "Ship goals",
  line: "The engine side",
  finished: "Every goal runs end to end.",
  limits: {},
}

const post = (path: string, body: unknown) =>
  call(
    new Request(`http://localhost/api/goals${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

/** A goal whose spec is already approved, so its first turn opens traks. */
const shipGoal = startGoal("ship", GoalEvents.started(SHIP)).pipe(Effect.orDie)

/** Wait until the goal's log holds `tag`: a turn runs on the worker, not this fiber. */
const untilLogged = (id: GoalId, tag: GoalEvent["_tag"]) =>
  Effect.flatMap(GoalStore, (store) => store.events(id)).pipe(
    Effect.repeat({
      until: (log) => log.some((e) => e._tag === tag),
      schedule: Schedule.spaced("1 millis"),
    }),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

const untilRunning = (id: GoalId) =>
  Effect.flatMap(GoalDrives, (drives) => drives.running(id)).pipe(
    Effect.repeat({ until: (running) => running, schedule: Schedule.spaced("1 millis") }),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

/** The goal's session, read from its log once a turn has recorded it. */
const sessionOf = (id: GoalId) =>
  Effect.flatMap(GoalStore, (store) =>
    Effect.map(store.events(id), (log) => String(replayGoal(id, log)?.session)),
  )

const PROPOSE = /Open the traks you are confident in/

/** What a run saw: every line logged, and the goal or trak and the session it ran. */
interface Seen {
  readonly lines: readonly string[]
  readonly id: string
  readonly session: string
}

type Body = (
  trak: TrakId,
  agentLog: Effect.Effect<AgentLog>,
) => Effect.Effect<Omit<Seen, "lines">, RuntimeError, FlowDeps>

/** Run `body` as a flow with every line it logs captured, and hand back what it saw. */
const seenIn = async (turns: readonly Turn[], body: Body, lib?: Library): Promise<Seen> => {
  const kept: Seen[] = []
  await runFlowWithAgentLog(
    turns,
    (trak, agentLog) =>
      capturing((lines) =>
        Effect.map(body(trak, agentLog), (seen) => {
          kept.push({ ...seen, lines })
        }),
      ),
    lib,
  )
  const [seen] = kept
  if (seen === undefined) throw new Error("the flow ended without its body")
  return seen
}

// Each body is hoisted, because inline it is one callback too many for the nesting limit.

const goalTurnEnds: Body = () =>
  Effect.gen(function* () {
    const id = yield* shipGoal
    yield* untilLogged(id, "GoalTurnEnded")
    return { id, session: yield* sessionOf(id) }
  })

const goalTurnFails: Body = () =>
  Effect.gen(function* () {
    const id = yield* shipGoal
    yield* untilLogged(id, "GoalTurnFailed")
    return { id, session: yield* sessionOf(id) }
  })

const goalTurnDropped: Body = () =>
  Effect.gen(function* () {
    const id = yield* shipGoal
    yield* untilRunning(id)
    const dropped = yield* post(`/${id}/drop`, { reason: "not now" })
    if (dropped.status !== 202) return yield* Effect.die(`drop answered ${String(dropped.status)}`)
    return { id, session: yield* sessionOf(id) }
  })

const stepTurnEnds: Body = (trak, agentLog) =>
  Effect.gen(function* () {
    yield* createAndStart(trak, "Add a --json flag")
    // The composer's turn is the first request; the step's is the second.
    return { id: trak, session: String((yield* agentLog).requests[1]?.sessionId) }
  })

describe("a goal composer turn", () => {
  const lib = library({ root: mkdtempSync(join(tmpdir(), "orkestra-turn-log-")) })

  it("says when it starts and when it ends, with the goal, the session and the duration", async () => {
    const { lines, id, session } = await seenIn(
      [onPrompt(PROPOSE, "Nothing to propose yet.")],
      goalTurnEnds,
      lib,
    )
    expect(infoNaming(lines, id, "started")).toHaveLength(1)
    const ended = infoNaming(lines, id, session, "ended")
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatch(DURATION)
  })

  it("says when it fails, with the goal and the duration", async () => {
    const { lines, id } = await seenIn([crashesOn(PROPOSE, "the CLI died")], goalTurnFails, lib)
    const failed = infoNaming(lines, id, "failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatch(DURATION)
  })

  it("says when it is interrupted, with the goal and the duration", async () => {
    const { lines, id } = await seenIn([hangsOn(PROPOSE)], goalTurnDropped, lib)
    const interrupted = infoNaming(lines, id, "interrupted")
    expect(interrupted).toHaveLength(1)
    expect(interrupted[0]).toMatch(DURATION)
  })
})

describe("a trak step's turn", () => {
  it("says when it starts and when it ends, with the trak, the session and the duration", async () => {
    const { lines, id, session } = await seenIn(
      [composer("work"), step(1, "work", reply.artifact("Added --json"))],
      stepTurnEnds,
    )
    expect(infoNaming(lines, id, "1-work", "started")).toHaveLength(1)
    const ended = infoNaming(lines, id, "1-work", session, "ended")
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatch(DURATION)
  })
})
