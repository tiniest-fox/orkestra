// A host user's own Claude credential, from the engine's side: before every agent spawn the
// engine asks the host what the turn's owner signs in with, hands the spawn that alone, parks
// the turn where the host refuses it, and tells the host when the CLI refuses the credential.
// The host is the scripted environment; what a real host answers is that host's to test.

import { Effect, Either, Ref } from "effect"
import { describe, expect, it } from "vitest"
import type { SessionRequest } from "../../src/agent/types/session.js"
import { Events } from "../../src/workflow/domain/event.js"
import { UserId } from "../../src/workflow/domain/trak.js"
import type { TurnCredential } from "../../src/workflow/ports/environment.js"
import { advance } from "../../src/workflow/runtime.js"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { act, expectState, human, logTags } from "../support/scenario.js"
import { refusesSignInOn, reply } from "../support/scripted-agent.js"
import { type HostHeard, hostCredentials } from "../support/scripted-environment.js"

const OWNER = UserId.make("gh:583231")
const TAKER = UserId.make("gh:2")

const GIVEN: TurnCredential = {
  signIn: {
    env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-octocat" },
    withhold: ["ANTHROPIC_API_KEY"],
  },
  given: { user: OWNER, name: "CLAUDE_CODE_OAUTH_TOKEN", setAt: 1 },
}

type Answer = Parameters<typeof hostCredentials>[0] extends Ref.Ref<infer A> ? A : never

/** The host handing the owner's token over. */
const handsOver: Answer = () => Either.right(GIVEN)

const REFUSAL = "@octocat has no Claude credential stored on this host"

const host = (first: Answer) => {
  const answer = Effect.runSync(Ref.make(first))
  const heard = Effect.runSync(Ref.make<HostHeard>({ asked: [], refused: [] }))
  return { answer, heard, layer: hostCredentials(answer, heard) }
}

const owned = (id: Parameters<typeof advance>[0], description: string) =>
  advance(id, Events.trakCreated(description, undefined, "manual", false, OWNER))

const signInsOf = (runs: readonly SessionRequest[]) => runs.map((r) => r.signIn)

/** Whom the host was asked about, spawn by spawn. */
const askedFor = (heard: HostHeard) => heard.asked.map((a) => a.owner)

/** Whether each spawn was said to run on the server. */
const serverOf = (heard: HostHeard) => heard.asked.map((a) => a.server)

describe("a turn whose owner the host hands a credential", () => {
  it("runs the composer and every step on that credential alone, asked for the trak's owner", async () => {
    const { heard, layer } = host(handsOver)
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("Added --json"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* owned(id, "Add a --json flag")
          // The step is started by the engine past the plan gate; it still runs as the owner.
          yield* act(id, 0, human.approve())
          const log = yield* agentLog
          expect(signInsOf(composerRuns(log))).toEqual([GIVEN.signIn])
          expect(signInsOf(stepRuns(log))).toEqual([GIVEN.signIn])
          expect(askedFor(yield* Ref.get(heard))).toEqual([OWNER, OWNER])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      layer,
    )
  })

  it("leaves the spawn on what the engine inherited where the host hands nothing", async () => {
    const { layer } = host(() => Either.right({}))
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* owned(id, "x")
          expect(signInsOf(composerRuns(yield* agentLog))).toEqual([undefined])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      layer,
    )
  })
})

describe("a trak whose log carries an OwnerChanged", () => {
  it("asks for the new owner at every spawn after it, and for the old one before it", async () => {
    const { heard, layer } = host(handsOver)
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("Added --json"))],
      (id) =>
        Effect.gen(function* () {
          // The composer's turn ran, and ended, on the owner's credential.
          yield* owned(id, "Add a --json flag")
          yield* advance(id, Events.ownerChanged(OWNER, TAKER))
          // The step the engine starts past the gate is the taker's, though nothing they
          // pressed started it.
          yield* act(id, 0, human.approve())
          const said = yield* Ref.get(heard)
          expect(askedFor(said)).toEqual([OWNER, TAKER])
          // No runner in a flow, so every turn here runs on the server, and says so.
          expect(serverOf(said)).toEqual([true, true])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      layer,
    )
  })
})

describe("a turn the host will not run", () => {
  it("parks with the host's reason before anything is spawned, and runs on Resume once it would", async () => {
    const { answer, heard, layer } = host(() =>
      Either.left(`the host would not run this turn: ${REFUSAL}`),
    )
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog) =>
        Effect.gen(function* () {
          const parked = yield* owned(id, "x")
          expectState(parked, "Failed")
          expect(parked.state._tag === "Failed" ? parked.state.error : "").toContain(REFUSAL)
          expect(yield* logTags(id)).toEqual(["TrakCreated", "WorktreeReady", "TurnFailed"])
          expect(parked.composerSession).toBeUndefined()
          expect(composerRuns(yield* agentLog)).toEqual([])

          // The owner stores a credential; the resume asks again, for the same owner.
          yield* Ref.set(answer, handsOver)
          const resumed = yield* advance(id, Events.restarted(undefined))
          expectState(resumed, "AwaitingProposal")
          expect(signInsOf(composerRuns(yield* agentLog))).toEqual([GIVEN.signIn])
          expect(askedFor(yield* Ref.get(heard))).toEqual([OWNER, OWNER])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      layer,
    )
  })
})

describe("a credential the CLI refuses", () => {
  it("fails the turn as the provider's, and tells the host which credential it was", async () => {
    const { heard, layer } = host(handsOver)
    await runFlowWithAgentLog(
      [refusesSignInOn(/Compose a pipeline/)],
      (id) =>
        Effect.gen(function* () {
          const parked = yield* owned(id, "x")
          expectState(parked, "Failed")
          expect((yield* Ref.get(heard)).refused).toEqual([GIVEN.given])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      layer,
    )
  })
})
