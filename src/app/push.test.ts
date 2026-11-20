import { Deferred, Effect, Fiber, Ref } from "effect"
import { describe, expect, it } from "vitest"
import { GoalState } from "../workflow/domain/goal.js"
import { goalNotificationFor, keepDraining } from "./push.js"

describe("a goal's push", () => {
  it("tells the person when the composer needs them to do something by hand", () => {
    expect(goalNotificationFor("g-1", GoalState.AtGate({ gate: "action" }), "Search")).toEqual({
      title: "Orkestra",
      body: "Search needs you to do something",
      url: "/goals/g-1",
      tag: "goal:g-1",
    })
  })

  it("says nothing while the goal watches its traks", () => {
    expect(goalNotificationFor("g-1", GoalState.Watching(), "Search")).toBeUndefined()
  })
})

describe("the drain's supervisor", () => {
  it("restarts a drain that died, and stops when it is interrupted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const runs = yield* Ref.make(0)
        const third = yield* Deferred.make<void>()
        const again = Effect.flatMap(
          Ref.updateAndGet(runs, (n) => n + 1),
          (n) =>
            n < 2
              ? Effect.die("a bug in the drain")
              : Effect.andThen(Deferred.succeed(third, undefined), Effect.never),
        )
        const fiber = yield* Effect.fork(keepDraining(Effect.die("the first drain"), again, 0))
        yield* Deferred.await(third)
        expect(yield* Ref.get(runs)).toBe(2)
        yield* Fiber.interrupt(fiber)
        expect(yield* Ref.get(runs)).toBe(2)
      }),
    )
  })
})
