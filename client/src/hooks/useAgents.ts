/**
 * The agent library — every agent the engine holds, with its icon and whether a trak can
 * be started with it.
 *
 * **In `hooks/` because three screens ask.** New Trak's grid filters it to `start`; the
 * plan a trak draws and the traks list resolve an entry's agent name against it for the
 * mark that agent wears. What each of them does with it differs; the query does not.
 *
 * **The one query in this client with no `refetchInterval`, and that is the decision.**
 * Everything else here polls because the engine changes it underneath us; this moves
 * only when a person reloads the project's files from the project menu, which is
 * another page's press — a poll would ask fifteen times a minute for an answer that
 * almost never changes. The default `staleTime` of zero is what reaches a reload: a
 * screen that mounts this asks again, so New Trak opened after one lists the new agent.
 *
 * **A failure here is not a failure of the screen.** Compose a plan is client copy and
 * is the default, so the primary way to start a trak stands whether or not this
 * answers — `NewTrakPage` draws the grid's absence as a line, never as an empty pane.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { listAgents } from "../api/fleet"
import type { AgentDto } from "../api/types"
import { queryKeys } from "../queryCache"

type Agents = readonly AgentDto[]

/**
 * `queryFn` is injectable for the reason `traksQueryOptions` gives: the decisions —
 * the key, and the absent interval — are then reachable without React or a network,
 * and the hook below has nothing left to test.
 */
export const agentsQueryOptions = (queryFn: () => Promise<Agents> = listAgents) => ({
  queryKey: queryKeys.agents,
  queryFn,
})

export const useAgents = (): UseQueryResult<Agents> => useQuery(agentsQueryOptions())
