// A message a person sends while the trak is being driven, and its four endings: the
// running turn hears it, the next turn that starts hears it, it becomes the chat at
// the gate the trak parks at, or a stop hands it back unsent.
//
// The scripted agent stands in for both kinds of turn. One that `hears` takes a
// steered message and reports it delivered, as Claude and Codex do down an open pipe;
// every other turn answers `false`, which is a turn with no pipe to write — and a
// check, which has no turn at all.

import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect, Function, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlow, runFlowWithAgentLog, step, stepHangs } from "../support/flow.js"
import {
  checkoutSurvived,
  create,
  expectAwaiting,
  human,
  idle,
  logTags,
  transcriptTags,
} from "../support/scenario.js"
import { workDeclaring } from "../support/library.js"
import { fail, heldBack, pass } from "../support/scripted-checks.js"
import { onResume, reply, type Turn } from "../support/scripted-agent.js"
import { Drives, holdMessage } from "../../src/app/drive.js"
import { FileStoreLayer } from "../../src/workflow/adapters/store-file.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import type { Trak, TrakId } from "../../src/workflow/domain/trak.js"
import { SessionId } from "../../src/agent/types/session.js"
import { Runs } from "../../src/workflow/ports/runs.js"
import { Store } from "../../src/workflow/ports/store.js"

const SAID = "Keep --json working as an alias."

const current = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return replayHistory(id, yield* store.events(id))
  })

/** Wait for the trak to stand in `tag` — a drive forked a moment ago has not got there yet. */
const standing = (id: TrakId, tag: Trak["state"]["_tag"]) =>
  current(id).pipe(
    Effect.repeat({ until: (t) => t.state._tag === tag, schedule: Schedule.spaced("1 millis") }),
    Effect.timeout("20 seconds"),
    Effect.orDie,
  )

const approvePlan = (): Event => Events.humanActed(0, human.approve())

/** The act route's door for a chat off a gate, with its answer's status. */
const say = (id: TrakId, message: string) =>
  holdMessage(id, message, undefined, ".").pipe(
    Effect.map((response) => response.status),
    Effect.orDie,
  )

/** The step's first turn, held until `release` and taking what is steered into it. */
const hearing = (release: Deferred.Deferred<void>, answer: string): Turn => ({
  ...step(1, "work", answer),
  until: Deferred.await(release),
  hears: true,
})

/** What is still waiting, as text. */
const waitingOn = (trak: Trak): readonly string[] => trak.messages.map((m) => m.message)

const tagged = (events: readonly Event[], tag: Event["_tag"]): number =>
  events.filter((e) => e._tag === tag).length

const tagsOf = (events: readonly Event[]): readonly string[] => events.map((e) => e._tag)

const aboutMessages = (tags: readonly string[]): readonly string[] =>
  tags.filter((t) => t.startsWith("Message"))

const restart = (): Event => Events.restarted(undefined)

const chatsIn = (events: readonly Event[]): readonly string[] =>
  events.flatMap((e) =>
    e._tag === "HumanActed" && e.action._tag === "Chat" ? [e.action.message] : [],
  )

const CHECKS = new Map([
  [
    "verify",
    {
      name: "verify",
      description: "Runs the project's own verification.",
      timeoutSeconds: 60,
      askedEverySeconds: undefined,
      exclusive: false,
      cache: true,
      ignoresLinguistGenerated: false,
      units: undefined,
      cacheAcross: "platform" as const,
      path: "/repo/.orkestra/checks/verify.sh",
    },
  ],
])

describe("a message sent while a turn runs", () => {
  it("is heard by that turn, which files one answer and opens no chat", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlow([composer("work"), hearing(release, reply.artifact("Added --format"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "Rename the flag")
        yield* (yield* Drives).start(id, approvePlan)
        yield* standing(id, "AgentWorking")

        expect(yield* say(id, SAID)).toBe(202)
        // Written down as waiting before anything hears it.
        expect(waitingOn(yield* current(id))).toStrictEqual([SAID])

        yield* Deferred.succeed(release, undefined)
        yield* idle(id)
        const filed = yield* current(id)
        expectAwaiting(filed, "approval")
        expect([filed.messages, filed.returned]).toStrictEqual([[], []])
        const events = yield* (yield* Store).events(id)
        expect(aboutMessages(tagsOf(events))).toStrictEqual(["MessageWaiting", "MessageDelivered"])
        expect(tagged(events, "AgentReturned")).toBe(1)
        expect(chatsIn(events)).toStrictEqual([])
        // And where in the turn it was read is on the transcript.
        expect(yield* transcriptTags(id)).toContain("Said")
      }),
    )
  })

  it("is heard by a turn whose provider announced a session of its own", async () => {
    // The run record names the announced session from then on, and the pipe is still
    // held by the id the turn was requested under — a steer by the record's
    // `sessionId` finds nothing, and the message would wait for the gate.
    const release = Effect.runSync(Deferred.make<void>())
    const announced = SessionId.make("01a12d57-0000-7000-8000-000000000001")
    const turn = { ...hearing(release, reply.artifact("Added --format")), announces: announced }
    await runFlow([composer("work"), turn], (id) =>
      Effect.gen(function* () {
        yield* create(id, "Rename the flag")
        yield* (yield* Drives).start(id, approvePlan)
        yield* (yield* Runs).inFlight(id).pipe(
          Effect.repeat({
            until: (t) => t?.sessionId === announced,
            schedule: Schedule.spaced("1 millis"),
          }),
          Effect.timeout("20 seconds"),
          Effect.orDie,
        )

        yield* say(id, SAID)
        yield* Deferred.succeed(release, undefined)
        yield* idle(id)
        const events = yield* (yield* Store).events(id)
        expect(aboutMessages(tagsOf(events))).toStrictEqual(["MessageWaiting", "MessageDelivered"])
        expect(chatsIn(events)).toStrictEqual([])
      }),
    )
  })

  it("becomes the chat at the gate when the turn cannot take it", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        composer("work"),
        { ...step(1, "work", reply.artifact("Added --format")), until: Deferred.await(release) },
        onResume(reply.artifact("Added --format, kept --json")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "Rename the flag")
          yield* (yield* Drives).start(id, approvePlan)
          yield* standing(id, "AgentWorking")
          yield* say(id, SAID)
          yield* say(id, "And skip the changelog.")

          yield* Deferred.succeed(release, undefined)
          yield* idle(id)
          // The step filed, the gate opened, and both messages went as one chat with
          // no press — which resumed the step's own session.
          const events = yield* (yield* Store).events(id)
          expect(chatsIn(events)).toStrictEqual([`${SAID}\n\nAnd skip the changelog.`])
          expect(tagged(events, "AgentReturned")).toBe(2)
          expect((yield* agentLog).requests.at(-1)?.prompt).toContain(SAID)
          const answered = yield* current(id)
          expectAwaiting(answered, "approval")
          expect(answered.messages).toStrictEqual([])
        }),
    )
  })
})

describe("a message sent while a check runs", () => {
  it("opens a chat turn when the trak parks at the failing-check gate", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.artifact("Added --format")),
        // The first failure is the agent's to fix; the same failure again is the gate.
        onResume(reply.artifact("Added --format, again")),
        onResume(reply.artifact("Added --format, kept --json")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "Rename the flag")
          yield* (yield* Drives).start(id, approvePlan)
          yield* standing(id, "CheckRunning")
          yield* say(id, SAID)

          yield* Deferred.succeed(release, undefined)
          yield* idle(id)
          const events = yield* (yield* Store).events(id)
          const tags = tagsOf(events)
          // Held through the turn that fixed the first failure, which could not take
          // it, and said at the gate the second failure opened.
          expect(tags.slice(tags.indexOf("MessageWaiting"))).toStrictEqual([
            "MessageWaiting",
            "CheckFailed",
            "AgentReturned",
            "CheckFailed",
            "HumanActed",
            "AgentReturned",
            "ChecksPassed",
          ])
          expect(chatsIn(events)).toStrictEqual([SAID])
          expect((yield* agentLog).requests.at(-1)?.prompt).toContain(SAID)
          expectAwaiting(yield* current(id), "approval")
        }),
      workDeclaring(["verify"], { checks: CHECKS }),
      { verify: [heldBack(Deferred.await(release), fail("boom")), fail("boom"), pass] },
    )
  })
})

describe("a stop with a message waiting", () => {
  it("sends nothing, and hands the text back", async () => {
    await runFlow([composer("work"), stepHangs(1, "work")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "Rename the flag")
        const drives = yield* Drives
        yield* drives.start(id, approvePlan)
        yield* standing(id, "AgentWorking")
        yield* say(id, SAID)

        // As the stop route does it: the turn's record read before the kill.
        const runs = yield* Runs
        // Read again after the wait: with a schedule, `repeat` hands back its count.
        yield* runs
          .inFlight(id)
          .pipe(
            Effect.repeat({ until: (t) => t !== undefined, schedule: Schedule.spaced("1 millis") }),
          )
        const turn = yield* runs.inFlight(id)
        const stop = Events.stopped(turn?.sessionId, turn?.step, turn?.usage)
        yield* drives.takeOver(id, Function.constant(stop))
        yield* idle(id)

        const stopped = yield* current(id)
        // The gate a stop opens takes a chat, and none was sent.
        expectAwaiting(stopped, "conversation")
        expect([stopped.messages, stopped.returned]).toStrictEqual([[], [SAID]])
        expect(chatsIn(yield* (yield* Store).events(id))).toStrictEqual([])
      }),
    )
  })
})

describe("a waiting message across an engine restart", () => {
  it("is still on the log, and the turn the restart starts hears it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orkestra-steering-"))
    mkdirSync(join(dir, ".orkestra"), { recursive: true })
    // The first process: a turn that never answers, a message waiting under it, and
    // then the process goes — taking the turn and every pipe with it.
    await runFlowWithAgentLog(
      [composer("work"), stepHangs(1, "work")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "Rename the flag")
          yield* (yield* Drives).start(id, approvePlan)
          yield* standing(id, "AgentWorking")
          yield* say(id, SAID)
        }),
      undefined,
      undefined,
      FileStoreLayer(dir),
    )
    // The second: the same log and nothing else. The restart re-issues the step, and
    // the turn it starts is handed what the log says is still waiting.
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [{ ...hearing(release, reply.artifact("Added --format")), when: () => true }],
      (id) =>
        Effect.gen(function* () {
          yield* checkoutSurvived(id)
          expect(waitingOn(yield* current(id))).toStrictEqual([SAID])
          yield* Deferred.succeed(release, undefined)
          yield* (yield* Drives).start(id, restart)
          yield* standing(id, "AwaitingHuman")
          yield* idle(id)

          const filed = yield* current(id)
          expectAwaiting(filed, "approval")
          expect(filed.messages).toStrictEqual([])
          expect(yield* logTags(id)).toContain("MessageDelivered")
          expect(chatsIn(yield* (yield* Store).events(id))).toStrictEqual([])
        }),
      undefined,
      undefined,
      FileStoreLayer(dir),
    )
  })
})
