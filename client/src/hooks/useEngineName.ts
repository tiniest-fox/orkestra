/**
 * The project's name, as a phone's header names it on an engine reached with no host —
 * a host's page names the project from its own list instead. `undefined` until it is
 * read, where it is not asked for, and where the read failed: the header then names
 * nothing rather than a guess.
 *
 * Kind `hook`.
 */

import { useQuery } from "@tanstack/react-query"
import { engineName } from "../api/engine"
import { queryKeys } from "../queryCache"

export const useEngineName = (enabled: boolean): string | undefined =>
  useQuery({
    queryKey: queryKeys.engine,
    queryFn: () => engineName(),
    enabled,
    staleTime: Infinity,
    retry: false,
  }).data
