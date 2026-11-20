/**
 * `models.yaml` as the engine loaded it — what a chat may run on, and what it runs on
 * when nobody picks.
 *
 * **In `hooks/` because two screens ask**: New Chat's picker, and the plan gate's, where a
 * proposed step's model can be swapped.
 *
 * **No `refetchInterval`, for `useAgents`' reason exactly.** The file is read at boot and
 * on a reload pressed in the project menu, and nothing that happens to a trak changes it;
 * a screen that mounts this after a reload asks again.
 *
 * **A failure here is not a failure of the screen.** Sending nothing about a model is
 * what every chat did before the picker existed, and the engine then runs the default —
 * so the field stays live and `NewChatPage` draws the list's absence as a line.
 */

import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { listModels } from "../api/fleet"
import type { ModelsDto } from "../api/types"
import { queryKeys } from "../queryCache"

/** Injectable for `agentsQueryOptions`' reason: the key and the absent interval are then reachable without React. */
export const modelsQueryOptions = (queryFn: () => Promise<ModelsDto> = listModels) => ({
  queryKey: queryKeys.models,
  queryFn,
})

export const useModels = (): UseQueryResult<ModelsDto> => useQuery(modelsQueryOptions())
