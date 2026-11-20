// A turn that answered while its sandbox stayed out of reach for the branch fetch: the
// answer is dropped as a failure, since nothing moves on without the turn's commits, and a
// Resume fetches before it starts anything — another failure while the sandbox is still
// out of reach, with no turn spent, and the turn again once the fetch lands.

import { Effect, Ref } from "effect"
import { describe, expect, it } from "vitest"
import { Vcs } from "../../src/vcs/ports/vcs.js"
import { GitFailed } from "../../src/vcs/types/errors.js"
import { Events } from "../../src/workflow/domain/event.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { advance } from "../../src/workflow/runtime.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composer, runFlowWithAgentLog, step } from "../support/flow.js"
import { act, create, human } from "../support/scenario.js"
import { type AgentLog, reply, type Turn } from "../support/scripted-agent.js"

/** The step picked up again in its own session, once its commits are in. */
const resumedTurn: Turn = {
  label: "resumed",
  when: (r) => r.resumeFrom !== undefined,
  reply: reply.artifact("filed again"),
}

/** What the patient fetch fails with once the outage has outlasted the window. */
const UNREACHED = new GitFailed({
  op: "fetch trak branch",
  reason: "the sandbox provider could not be reached: the API did not answer (runner.sh exec)",
  runner: {
    kind: "unreachable",
    said: "the API did not answer",
    file: "runner.sh",
    verb: "exec",
    stderr: "",
  },
})

/** The flow's own `Vcs`, its fetch failing while `down` holds and counted in `fetches`. */
const withFetch =
  (down: Ref.Ref<boolean>, fetches: Ref.Ref<number>) =>
  <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.flatMap(Vcs, (vcs) =>
      Effect.provideService(work, Vcs, {
        ...vcs,
        fetchWork: (id) =>
          Effect.zipRight(
            Ref.update(fetches, (n) => n + 1),
            Effect.flatMap(Ref.get(down), (out) =>
              out ? Effect.fail(UNREACHED) : vcs.fetchWork(id),
            ),
          ),
      }),
    )

const lastFailure = (id: TrakId) =>
  Effect.map(
    Effect.flatMap(Store, (store) => store.events(id)),
    (events) => events.findLast((e) => e._tag === "TurnFailed"),
  )

const unfetchedThenResumed = (id: TrakId, agentLog: Effect.Effect<AgentLog>) =>
  Effect.gen(function* () {
    const down = yield* Ref.make(false)
    const fetches = yield* Ref.make(0)
    const fetching = withFetch(down, fetches)
    yield* create(id, "x")
    yield* Ref.set(down, true)
    const failed = yield* fetching(act(id, 0, human.approve()))
    expect(failed.state._tag).toBe("Failed")
    expect(yield* lastFailure(id)).toMatchObject({
      step: 1,
      unfetched: true,
      runner: { kind: "unreachable" },
    })
    const turnsBefore = (yield* agentLog).requests.length

    // Still out of reach: the Resume fetches first, fails again, and spends no turn.
    const before = yield* Ref.get(fetches)
    const still = yield* fetching(advance(id, Events.restarted(undefined)))
    expect(still.state._tag).toBe("Failed")
    expect((yield* Ref.get(fetches)) - before).toBe(1)
    expect((yield* agentLog).requests.length).toBe(turnsBefore)

    // Back: the fetch lands, then the turn runs and files.
    yield* Ref.set(down, false)
    const again = yield* fetching(advance(id, Events.restarted(undefined)))
    expect(again.state._tag).toBe("AwaitingHuman")
    expect((yield* agentLog).matched.at(-1)).toBe("resumed")
  })

describe("a turn whose commits could not be fetched", () => {
  it("fails rather than moving on, and its Resume fetches before it starts anything", async () => {
    expect.hasAssertions()
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("filed, unfetched")), resumedTurn],
      unfetchedThenResumed,
    )
  })
})
