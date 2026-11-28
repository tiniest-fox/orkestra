/**
 * One trak's problem report: the engine's preview of what would go, the person's words and
 * log choice, and the send.
 *
 * **Spends nothing and takes no `running`**, for `useProcessPress`'s reason: the route
 * claims no custody and appends nothing, so no drive under way refuses it, and a report is
 * most wanted while a turn is misbehaving. The two pending-guard halves still hold: the
 * send is disabled while one is in flight and after one went, and the callback refuses
 * when disabled.
 *
 * **The words are kept across a failed send**, so Try again sends them again, and dropped
 * with everything else when the trak changes — a report written about one trak must not
 * go out about another.
 *
 * The preview is the engine's and polls like everything it owns; a send rebuilds the
 * report from the log as it is then, so what was drawn and what went can differ by the
 * lines written in between.
 */

import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { reportPreview, sendReport } from "../../../api/report"
import type { ReportDto, ReportSendAnswerDto, ReportSendRequestDto } from "../../../api/types"
import { useScopedTo } from "../../../hooks/useScopedTo"
import { POLL_MS, queryKeys } from "../../../queryCache"
import { logLocked } from "./report"

export const reportQueryOptions = (
  id: string,
  enabled: boolean,
  queryFn: () => Promise<ReportDto> = () => reportPreview(id),
) => ({
  queryKey: queryKeys.report(id),
  queryFn,
  enabled,
  refetchInterval: POLL_MS,
})

/** What the last send came to. */
export type ReportOutcome = { readonly sent: string } | { readonly failed: string } | undefined

/** A send's answer, or the request failing, as the pane draws it. */
export const outcomeOf = (
  data: ReportSendAnswerDto | undefined,
  error: Error | null,
): ReportOutcome => {
  if (error !== null) return { failed: "The report did not reach the engine." }
  if (data === undefined) return undefined
  return data._tag === "Sent" ? { sent: data.reference } : { failed: data.reason }
}

export interface Reporting {
  readonly preview: ReportDto | undefined
  /** The preview could not be read and none is in hand. */
  readonly previewFailed: boolean
  readonly note: string
  readonly setNote: (note: string) => void
  /** The switch as the person left it. */
  readonly includeLog: boolean
  readonly toggleLog: () => void
  /** Why the log cannot go, where the engine said it cannot — the switch is locked off. */
  readonly locked: string | undefined
  readonly send: () => void
  readonly sending: boolean
  readonly disabled: boolean
  readonly outcome: ReportOutcome
}

export const useReport = (
  id: string,
  open: boolean,
  sendFn: (request: ReportSendRequestDto) => Promise<ReportSendAnswerDto> = (request) =>
    sendReport(id, request),
): Reporting => {
  const query = useQuery(reportQueryOptions(id, open))
  const mutation = useMutation({ mutationFn: sendFn })
  const [draft, setDraft] = useState({ id, note: "", includeLog: true })
  useScopedTo(id, mutation.reset)
  // Dropped during the render where the trak changed, as `useScopedTo` drops the send.
  const held = draft.id === id ? draft : { id, note: "", includeLog: true }
  if (held !== draft) setDraft(held)

  const outcome = outcomeOf(mutation.data, mutation.error)
  const locked = logLocked(query.data)
  const disabled = mutation.isPending || (outcome !== undefined && "sent" in outcome)

  return {
    preview: query.data,
    previewFailed: query.data === undefined && query.isError,
    note: held.note,
    setNote: (note) => {
      setDraft({ ...held, note })
    },
    includeLog: held.includeLog,
    toggleLog: () => {
      if (locked === undefined && !mutation.isPending)
        setDraft({ ...held, includeLog: !held.includeLog })
    },
    locked,
    send: () => {
      if (disabled) return
      const note = held.note.trim()
      // A locked log is asked for anyway, so the report says why it is absent rather than
      // that the person turned it off.
      mutation.mutate({
        ...(note === "" ? {} : { note: held.note }),
        includeLog: locked !== undefined || held.includeLog,
      })
    },
    sending: mutation.isPending,
    disabled,
    outcome,
  }
}

/** Which trak the report pane is open for, its report, and the presses that open and shut it. */
export interface ReportPaneState {
  /** The trak it is open for, or `undefined` where it is shut. */
  readonly trak: string | undefined
  readonly reporting: Reporting
  readonly open: (trak: string) => void
  readonly close: () => void
}

/**
 * The page's report pane. Held against the page it was opened on, so stepping to another
 * trak's page shuts it; a piece's band may open it for the piece, which shares the page.
 */
export const useReportPane = (page: string): ReportPaneState => {
  const [opened, setOpened] = useState<
    { readonly page: string; readonly trak: string } | undefined
  >(undefined)
  const trak = opened?.page === page ? opened.trak : undefined
  return {
    trak,
    reporting: useReport(trak ?? page, trak !== undefined),
    open: (id) => {
      setOpened({ page, trak: id })
    },
    close: () => {
      setOpened(undefined)
    },
  }
}
