import { Context, type Effect } from "effect"
import type { SessionId } from "../../agent/types/session.js"
import type { GitFailed } from "../../vcs/types/errors.js"
import type { TrakId } from "../domain/trak.js"
import type { StoreFailed } from "./store-errors.js"

/** Randomness as a dependency, so the engine stays deterministic under test. */
export interface IdsShape {
  /**
   * A session's id, and it must be a v4 UUID: `claude --session-id` rejects
   * anything else outright. Nothing else here is constrained that way. A CLI that
   * mints its own session ignores it, and the log keeps the one it announced.
   */
  readonly newSessionId: Effect.Effect<SessionId>
  /**
   * A trak's id — minted where a spawn creates its children, and where a person
   * asks for a trak.
   *
   * Here rather than in the runtime for the reason the session id is: a spawn of
   * four is four ids in one command, and a flow test that could not predict them
   * could assert nothing about which trak did what.
   *
   * **It can fail, because a name has to be free before it can be given.** The id
   * is a phrase drawn from a wordlist rather than something unique by
   * construction, and it names a directory, a git branch and a base ref that all
   * outlive the trak — so the implementation draws again until nothing holds the
   * name, and asking that costs a store read and a git read. A lookup that could
   * not answer must not be spent as *the name is free*: the cost of getting that
   * wrong is a new trak committing on top of a closed one's work.
   *
   * A value rather than a function, so the redraw is written once behind the
   * layer instead of at every call site.
   */
  readonly newTrakId: Effect.Effect<TrakId, StoreFailed | GitFailed>
  /**
   * The id a turn's command runs under in its sandbox, minted before the spawn so the run
   * record names it first. Unique, and nothing else: the runner takes it as a word.
   */
  readonly newExecId: Effect.Effect<string>
}

export class Ids extends Context.Tag("workflow/Ids")<Ids, IdsShape>() {}
