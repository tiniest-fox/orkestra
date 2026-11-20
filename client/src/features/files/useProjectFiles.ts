/**
 * The project checkout's files as git sees them — the tree, and what the palette matches
 * a path against. Polled while anything draws them, so a file written a moment ago
 * appears; `enabled` is false while neither the panel nor the palette is open, and then
 * nothing is asked.
 */

import { useQuery } from "@tanstack/react-query"
import { projectFiles } from "../../api/files"
import type { ProjectFilesDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

export const projectFilesQueryOptions = (
  enabled: boolean,
  queryFn: () => Promise<ProjectFilesDto> = projectFiles,
) => ({
  queryKey: queryKeys.files,
  queryFn,
  enabled,
  refetchInterval: POLL_MS,
})

/** What the tree's query has said, as much of it as a view draws. */
export interface FilesRead {
  readonly data: ProjectFilesDto | undefined
  /** Why the read failed, where it did and nothing earlier is held. */
  readonly failed: string | undefined
  readonly retry: () => void
}

export const useProjectFiles = (enabled: boolean): FilesRead => {
  const { data, error, refetch } = useQuery(projectFilesQueryOptions(enabled))
  return {
    data,
    failed: data === undefined && error !== null ? error.message : undefined,
    retry: () => {
      void refetch()
    },
  }
}
