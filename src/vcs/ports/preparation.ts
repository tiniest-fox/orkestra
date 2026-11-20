// port: which preparation each trak is in now — engine memory, never on a log.
//
// Preparations nest and overlap: a rebuild makes a sandbox, then seeds it, then runs the
// setup script, and a setup running in the background goes on while a turn's files are
// copied. So each is entered for the length of the work it names, and the trak is in the
// newest one still running. A restart forgets them all, and the work that resumes enters
// its own again.

import { Context, Effect, Option, Scope } from "effect"
import type { PreparingPhase } from "../types/preparing.js"

/** Moves a preparation `enter` entered on — a copy's count. */
export type MovePhase = (phase: PreparingPhase) => Effect.Effect<void>

export interface PreparationShape {
  /** `trak` at `phase` until the scope closes, however it closes. */
  readonly enter: (
    trak: string,
    phase: PreparingPhase,
  ) => Effect.Effect<MovePhase, never, Scope.Scope>
  /** The newest preparation of `trak` still running, or `undefined` where none is. */
  readonly of: (trak: string) => Effect.Effect<PreparingPhase | undefined>
}

export class Preparation extends Context.Tag("vcs/Preparation")<Preparation, PreparationShape>() {}

/** `work` with the trak at a preparation for its length, handed a way to move it on. */
export type During = <A, E, R>(
  trak: string,
  phase: PreparingPhase,
  work: (move: MovePhase) => Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R>

/**
 * `During` through the service where one is held, and the work as it is where none is — a
 * layer set that shows a person nothing, such as a test's or an offline demo's. A scope of
 * its own, so `work` keeps whatever scope it is run in.
 */
export const duringWith =
  (held: Option.Option<PreparationShape>): During =>
  (trak, phase, work) =>
    Option.isNone(held)
      ? work(() => Effect.void)
      : Effect.acquireUseRelease(
          Scope.make(),
          (scope) => Effect.flatMap(Scope.extend(held.value.enter(trak, phase), scope), work),
          (scope, exit) => Scope.close(scope, exit),
        )
