/**
 * What gets sent: the trak's details as the receiver gets them, then the cleaned log as
 * the engine cut it, each redaction drawn where the engine took something out. Where the
 * log does not go — turned off, or impossible to clean — the log's place says so, so the
 * person reads it before they press Send rather than after.
 */

import type { ReactNode } from "react"
import type { ReportDto } from "../../../api/types"
import { detailRows, keyedLines, lockedWords, piecesOf } from "./report"

const NoLog = ({ said }: { readonly said: string }): ReactNode => (
  <p className="rounded-control border border-dashed border-border px-3 py-2 text-xs leading-4 text-tone-waiting">
    {said}
  </p>
)

const Line = ({ line }: { readonly line: string }): ReactNode => (
  <span className="block">
    {piecesOf(line).map((piece) =>
      piece.removed ? (
        <span key={piece.key} className="rounded-tile bg-tone-waiting-bg px-1 text-tone-waiting">
          removed
        </span>
      ) : (
        <span key={piece.key}>{piece.text}</span>
      ),
    )}
  </span>
)

const ReportPreview = ({
  preview,
  includeLog,
}: {
  readonly preview: ReportDto
  readonly includeLog: boolean
}): ReactNode => {
  const { log } = preview
  const locked = log._tag === "LeftOut" ? lockedWords(log.reason) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
        {detailRows(preview).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg-subtle">{key}</dt>
            <dd className="truncate text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {locked !== undefined ? (
        <NoLog said={`No log. ${locked}`} />
      ) : !includeLog || log._tag === "LeftOut" ? (
        <NoLog said="No log. You turned it off, and the report says so." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-control bg-canvas font-mono text-xs leading-5">
          {log.leftOut.lines > 0 && (
            <span className="shrink-0 border-b border-dashed border-border px-3 py-1 text-fg-subtle">
              ⋯ {log.leftOut.lines.toLocaleString("en-US")} earlier lines left out
            </span>
          )}
          <pre
            aria-label="The log that goes"
            className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5 break-all whitespace-pre-wrap text-fg-muted"
          >
            {keyedLines(log.lines, log.leftOut.lines).map(({ key, line }) => (
              <Line key={key} line={line} />
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

export default ReportPreview
