// A plan entry that is not a turn: N child traks, run at the same time, joined
// when all of them land.
//
// The engine does not drive children — the daemon does, through the two functions
// in `runtime.ts`: `driveChild` to start one or pick it up, `landOnParent` to bring
// it back. These tests own what a child *is* — what it is born with, where it
// branches from, what folds back, what a conflict does to it — and call both by
// hand, which is the point rather than a shortcut: it is the same pair
// `app/drive.ts` calls, exercised with no router in the way. That the daemon forks
// one drive per outstanding child is the surface's promise, and is pinned in
// `http-api.test.ts`.
//
// What a child is born with and hands back is `spawn-inherits.test.ts`; how one lands
// on its parent is `spawn-landing.test.ts`. One theme split three ways, because every
// flow here is on real git and the three run on separate workers.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { child, childStep, composer, onGit, piece, spawn, step } from "../support/flow.js"
import { artifactOf, createAndStart, human, logTags, act } from "../support/scenario.js"
import { reply } from "../support/scripted-agent.js"
import { UserId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { driveChild } from "../../src/workflow/runtime.js"
import { lenses, runChildren } from "../support/spawn.js"

// The subject here is git, so every flow runs on it.
const { runFlow, runFlowWithAgentLog } = onGit

/**
 * A piece that does its work and then reviews it, beside one that does not.
 *
 * The case a piece carrying a plan exists for: *this needs reviewing* asked for by
 * whoever planned the split, rather than by the agent that did the work. The second
 * piece is written the bare old way on purpose — a fan-out of mixed depth is what
 * the keys have to survive.
 */
const mixed = spawn(piece("the handler", "work", "review"), child("review", "the client"))

const mixedFlow = [
  composer("work", mixed, "plan"),
  step(1, "work", reply.artifact("the change")),
  childStep("work", "the handler", reply.artifact("handler built")),
  childStep("review", "the handler", reply.artifact("handler reviewed")),
  childStep("review", "the client", reply.artifact("client done")),
  step(3, "plan", reply.artifact("both in")),
]

describe("a spawn of two", () => {
  it("runs both children and advances the parent once, all on the parent's log", () =>
    runFlow(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const parked = yield* act(id, 1, human.approve())
          expect(parked.state).toEqual({ _tag: "AwaitingChildren", step: 2 })

          const joined = yield* runChildren(parked, 2)
          expect(joined.state).toEqual({ _tag: "AwaitingHuman", step: 3, kind: "approval" })

          // Two landings and one join, in that order, on the parent — not one
          // event per child per gate. The children's own gates are on their own
          // logs, which is what makes a spawn N traks rather than one wide turn.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
            "HumanActed",
            "WorkCommitted", // step 0's own work kept
            "EffectsRan", // and its effects run, of which this agent declares none
            "ChildrenSpawned",
            "ChildLanded",
            "ChildLanded",
            "ChildrenJoined",
            "WorkCommitted", // the spawn position's own work kept
            "EffectsRan", // a spawn names no agent, so there is nothing to run
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
    ))

  it("files each child's document under its own directory, and the step after is shown both", () =>
    runFlowWithAgentLog(
      [
        composer("work", lenses, "plan"),
        step(1, "work", reply.artifact("the change")),
        childStep("review", "security", reply.artifact("no injection")),
        childStep("review", "performance", reply.artifact("one N+1")),
        step(3, "plan", reply.artifact("both addressed")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Rate-limit the public API")
          const joined = yield* runChildren(yield* act(id, 1, human.approve()), 2)

          // Position, then child, then agent names the piece; inside it, the child's
          // own key. Both children are `review`, so a name of position-plus-agent
          // would have the second overwrite the first.
          expect(artifactOf(joined, "2.0-review/0-review")).toContain("no injection")
          expect(artifactOf(joined, "2.1-review/0-review")).toContain("one N+1")

          const last = (yield* agentLog).requests.at(-1)
          expect(last?.prompt).toContain(".orkestra/.trak/2.0-review/0-review.md")
          expect(last?.prompt).toContain(".orkestra/.trak/2.1-review/0-review.md")
        }),
    ))
})

describe("a piece that reviews its own work", () => {
  it("is born holding both steps, in the order the spawn entry named them", () =>
    runFlow(mixedFlow, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())

        const born = yield* driveChild(parked, 2, 0)
        // A piece is a trak with a plan, and this is the whole of what changes: it
        // is born with the plan the composer wrote for it rather than one entry.
        expect(born.plan?.steps).toMatchObject([{ agent: "work" }, { agent: "review" }])
        // Its title is the first step's instruction — the later steps are what it
        // does with that, and a piece named *review it* says nothing about what.
        expect(born.plan?.title).toBe("Produce the work for the handler.")
      }),
    ))

  it("is born its parent's owner, and its parent's nobody where the parent has none", () =>
    runFlow(mixedFlow, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        expect(parked.owner).toBeUndefined()
        const owned = { ...parked, owner: UserId.make("gh:583231") }

        const born = yield* driveChild(owned, 2, 0)
        expect(born.owner).toBe("gh:583231")
        expect((yield* (yield* Store).events(born.id))[0]).toMatchObject({
          _tag: "TrakCreated",
          owner: "gh:583231",
        })
        const second = yield* driveChild(parked, 2, 1)
        expect((yield* (yield* Store).events(second.id))[0]).not.toHaveProperty("owner")
      }),
    ))

  it("stops for a person at every step, and its review opens what its build filed", () =>
    runFlowWithAgentLog(mixedFlow, (id, agentLog) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())

        const born = yield* driveChild(parked, 2, 0)
        // No clearance, one level down: the first step files and waits, and the
        // second has not been spent on.
        expect(born.state).toEqual({ _tag: "AwaitingHuman", step: 0, kind: "approval" })
        expect(artifactOf(born, "0-work")).toContain("handler built")
        expect(artifactOf(born, "1-review")).toBeUndefined()

        const reviewed = yield* act(born.id, 0, human.approve())
        expect(reviewed.state).toEqual({ _tag: "AwaitingHuman", step: 1, kind: "approval" })
        expect(artifactOf(reviewed, "1-review")).toContain("handler reviewed")

        // The reviewing step reads the building step's document out of the piece's
        // own projection — the parent never sees `0-work` at all.
        const turn = (yield* agentLog).requests.at(-1)
        expect(turn?.prompt).toContain(".orkestra/.trak/0-work.md")
      }),
    ))

  it("sends back every document it filed, in a directory named for its last step", () =>
    runFlow(mixedFlow, (id) =>
      Effect.gen(function* () {
        yield* createAndStart(id, "Rate-limit the public API")
        const parked = yield* act(id, 1, human.approve())
        const joined = yield* runChildren(parked, 2)

        // `2.0-review/` holds both: the piece is named for the step it ends on, and
        // the parent's next step can read how the review was reached. A piece of
        // one step is laid out the same way rather than flat.
        expect(artifactOf(joined, "2.0-review/0-work")).toContain("handler built")
        expect(artifactOf(joined, "2.0-review/1-review")).toContain("handler reviewed")
        expect(artifactOf(joined, "2.0-review")).toBeUndefined()
        expect(artifactOf(joined, "2.1-review/0-review")).toContain("client done")
        // And the keep-or-drop decision is still last: the parent moved on only
        // once both pieces were answered for.
        expect(joined.state).toEqual({ _tag: "AwaitingHuman", step: 3, kind: "approval" })
      }),
    ))
})
