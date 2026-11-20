// The preparation a trak is in, as a surface sees it: on its row and its detail, and on the
// stream as it moves — engine memory, which no log holds. The phases themselves are named
// by the layers that prepare: `vcs-git.test.ts`, `sandbox-lifecycle.test.ts` and
// `setup-gate.test.ts` read which each names.

import { Effect, Exit, Fiber, Option, Schema, Scope, Stream } from "effect"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { describe, expect, it } from "vitest"
import { TrakDetailDto, TrakListDto } from "@orkestra/shared/dto/trak"
import type { Runner } from "../../src/library/types/runner.js"
import { Preparation } from "../../src/vcs/ports/preparation.js"
import { PreparingPhase } from "../../src/vcs/types/preparing.js"
import { Feed, type Framed } from "../../src/workflow/ports/feed.js"
import { composer, runFlow } from "../support/flow.js"
import { mount } from "../support/http.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import { create } from "../support/scenario.js"
import { runners } from "../support/library.js"

const { get } = mount(trakRoutes)

const runner: Runner = {
  description: "Runs each trak in a sandbox of the fixture's.",
  secret: undefined,
  pass: [],
  idleMinutes: undefined,
  settings: {},
  path: "/nowhere/runner.sh",
}

const bodyOf = (response: HttpServerResponse) =>
  Effect.promise((): Promise<unknown> => toWeb(response).json())

/** The detail's `preparing`, and the list row's, as the routes send them now. */
const sent = (id: string) =>
  Effect.gen(function* () {
    const detail = Schema.decodeUnknownSync(TrakDetailDto)(yield* bodyOf(yield* get(`/${id}`)))
    const list = Schema.decodeUnknownSync(TrakListDto)(yield* bodyOf(yield* get("")))
    return {
      detail: detail.preparing,
      row: list.traks.find((t) => t.id === id)?.preparing,
    }
  })

/** The first `count` preparations the stream says, by tag — `undefined` for none running. */
const preparingIn = (frames: Stream.Stream<Framed>, count: number) =>
  frames.pipe(
    Stream.filterMap(({ frame }) =>
      frame._tag === "Preparing" ? Option.some(frame.phase?._tag) : Option.none(),
    ),
    Stream.take(count),
  )

describe("the preparation a trak is in", () => {
  it("is on its row, its detail and the stream, newest first, and gone once it ends", async () => {
    await runFlow([composer("work")], (id) =>
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            yield* create(id, "Add a --json flag")
            const preparation = yield* Preparation
            const { frames } = yield* (yield* Feed).since(Number.MAX_SAFE_INTEGER)
            const heard = yield* Effect.fork(Stream.runCollect(preparingIn(frames, 5)))

            const outer = yield* Scope.make()
            yield* Scope.extend(preparation.enter(id, PreparingPhase.Rebuilding()), outer)
            // A sandbox's phase carries the runner file's own words.
            expect(yield* sent(id)).toEqual({
              detail: { _tag: "Rebuilding", runner: runner.description },
              row: { _tag: "Rebuilding", runner: runner.description },
            })
            const inner = yield* Scope.make()
            const move = yield* Scope.extend(preparation.enter(id, PreparingPhase.Seeding()), inner)
            yield* move(PreparingPhase.Copying({ sent: 1, total: 3 }))
            expect((yield* sent(id)).detail).toEqual({ _tag: "Copying", sent: 1, total: 3 })
            yield* Scope.close(inner, Exit.void)
            expect((yield* sent(id)).detail).toMatchObject({ _tag: "Rebuilding" })
            yield* Scope.close(outer, Exit.void)
            expect(yield* sent(id)).toEqual({ detail: undefined, row: undefined })

            const said = [...(yield* Fiber.join(heard))]
            // Each move once, and the last saying none is running.
            expect(said).toEqual(["Rebuilding", "Seeding", "Copying", "Rebuilding", undefined])
          }),
        ),
        // The runner file whose own words a sandbox's phase carries.
        runners({ runner }),
      ),
    )
  })
})
