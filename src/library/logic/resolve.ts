// logic: a name -> the agent that runs, over a whole library.
//
// **The one place the engine's own agent is added back.** `Library.generic` sits
// beside the fleet rather than in it, so the composer's index and the set that
// validates a proposed plan cannot reach it; everything that has to resolve a name a
// step actually names comes here instead of reading `lib.agents` directly.
//
// Getting the split backwards is the expensive mistake because it is silent:
// `index-summary.ts` and `composer-output.ts` must keep reading `lib.agents`, or the
// composer can put a role-less write agent on any plan with nothing refusing it. The
// create route's `startable` is on this side: a person may open a trak with the
// engine's own agent, and only the composer may not name it.

import type { Agent } from "../types/agent.js"
import type { Library } from "../types/library.js"

/**
 * The agent a plan entry names, or `undefined` for a name nothing holds.
 *
 * The project's fleet first, and the two can never disagree: `assembleLibrary`
 * refuses a project file called `generic`, so this is one lookup written as two.
 */
export const agentNamed = (lib: Library, name: string): Agent | undefined =>
  lib.agents.get(name) ?? (name === lib.generic.name ? lib.generic : undefined)

/**
 * Every agent a name here can resolve to, for the one caller that wants the list
 * rather than a lookup: `GET /api/agents`, which serves the ones a person cannot open
 * a trak with too, so that a surface drawing a plan row can resolve its `icon:`.
 *
 * The engine's own goes last rather than in name order — the fleet's order is what
 * the project's files say, and this one is not one of them.
 */
export const fleet = (lib: Library): readonly Agent[] => [...lib.agents.values(), lib.generic]
