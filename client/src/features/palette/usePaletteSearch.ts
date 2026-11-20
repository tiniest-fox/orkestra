/**
 * The palette's typed query, and the two answers only the engine can give for it: the
 * lines in files that hold it, and the put-away traks named by it. The live traks and the
 * paths are matched in the page, over what it already holds — `matches.ts`.
 *
 * **Asked once the typing settles, and not under two characters.** A request per
 * keystroke would be a `git grep` per keystroke, and a one-letter grep is most lines of
 * the repository for an answer nobody reads. The settled query is the key, so each has
 * `keepPreviousData`: the last answer stays drawn while the next is out, rather than the
 * section vanishing between keystrokes.
 *
 * Polled while open, as every read of the engine is — a line edited on disk moves.
 */

import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { searchFiles } from "../../api/files"
import { archivedTraks } from "../../api/trak"
import type { ArchivedTrakListDto, FileSearchDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

/** How long the typing has to stop before the engine is asked. */
const SETTLE_MS = 200

/** The fewest characters the engine is asked about. */
export const LEAST = 2

export const fileSearchQueryOptions = (
  q: string,
  enabled: boolean,
  queryFn: (q: string) => Promise<FileSearchDto> = searchFiles,
) => ({
  queryKey: queryKeys.fileSearch(q),
  queryFn: () => queryFn(q),
  enabled: enabled && q.length >= LEAST,
  placeholderData: keepPreviousData,
  refetchInterval: POLL_MS,
})

export const archivedQueryOptions = (
  q: string,
  enabled: boolean,
  queryFn: (q: string) => Promise<ArchivedTrakListDto> = archivedTraks,
) => ({
  queryKey: queryKeys.archived(q),
  queryFn: () => queryFn(q),
  enabled: enabled && q.length >= LEAST,
  placeholderData: keepPreviousData,
  refetchInterval: POLL_MS,
})

/** `value`, once it has stopped changing for `ms`. */
const useSettled = (value: string, ms: number): string => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, ms)
    return () => {
      clearTimeout(timer)
    }
  }, [value, ms])
  return settled
}

export interface PaletteSearch {
  readonly query: string
  readonly setQuery: (query: string) => void
  /** The query the answers below are for — the typed one, once it settled. */
  readonly settled: string
  /** `undefined` while nothing has answered for a query long enough to ask about. */
  readonly lines: FileSearchDto | undefined
  readonly archived: ArchivedTrakListDto | undefined
  /** Both answers are in for `settled`, so an empty section is a fact, not a wait. */
  readonly answered: boolean
}

export const usePaletteSearch = (open: boolean): PaletteSearch => {
  const [query, setQuery] = useState("")
  const settled = useSettled(query.trim(), SETTLE_MS)
  const lines = useQuery(fileSearchQueryOptions(settled, open))
  const archived = useQuery(archivedQueryOptions(settled, open))
  const asked = settled.length >= LEAST
  return {
    query,
    setQuery,
    settled,
    lines: asked ? lines.data : undefined,
    archived: asked ? archived.data : undefined,
    answered:
      settled === query.trim() &&
      (!asked ||
        (!lines.isPlaceholderData &&
          !archived.isPlaceholderData &&
          lines.isSuccess &&
          archived.isSuccess)),
  }
}
