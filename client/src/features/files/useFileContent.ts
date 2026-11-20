/**
 * One file as the viewer draws it, polled while it is open so an edit made on disk
 * reaches the screen. `undefined` asks for nothing.
 *
 * **No `keepPreviousData`**, though the path is in the key: a viewer still drawing the last
 * file under the next one's name is worse than a moment of loading.
 */

import { useQuery } from "@tanstack/react-query"
import { fileContent } from "../../api/files"
import { ApiError } from "../../api/http"
import type { FileContentDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

export const fileContentQueryOptions = (
  path: string | undefined,
  queryFn: (path: string) => Promise<FileContentDto> = fileContent,
) => ({
  queryKey: queryKeys.fileContent(path ?? ""),
  queryFn: () => queryFn(path ?? ""),
  enabled: path !== undefined,
  refetchInterval: POLL_MS,
  // A 404 is a path the tree no longer names — asking again cannot change that.
  retry: false,
})

/**
 * What the viewer has to draw. `Gone` is the engine's 404 — a path git no longer lists,
 * deleted or ignored since the tree was read — told apart from a read that failed, which
 * is worth a retry.
 */
export type FileShown =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Gone" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Shown"; readonly file: FileContentDto }

export interface FileReading {
  readonly shown: FileShown
  readonly retry: () => void
}

export const useFileContent = (path: string | undefined): FileReading => {
  const { data, error, refetch } = useQuery(fileContentQueryOptions(path))
  const retry = (): void => {
    void refetch()
  }
  // Data first: a poll that failed behind a file on screen leaves the file drawn.
  if (data !== undefined) return { shown: { _tag: "Shown", file: data }, retry }
  if (error === null) return { shown: { _tag: "Loading" }, retry }
  if (error instanceof ApiError && error.status === 404) return { shown: { _tag: "Gone" }, retry }
  return { shown: { _tag: "Failed", message: error.message }, retry }
}
