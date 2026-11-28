/**
 * Report a problem with a trak: a pane of its own, because a report is a document the
 * person writes and the preview of what goes out needs the room.
 *
 * **On a desk it replaces the step pane**, under the trak's header and step bar, with the
 * form on the left and what gets sent on the right. **On a phone it is the whole screen**,
 * the trak's chrome given way, with a back press at the top, the preview under the form and
 * the send row pinned at the foot. The page decides which; this draws either.
 *
 * **A failed send keeps everything in place** — the words, the switch and the preview — and
 * says the receiver's reason above the send row, whose press then reads Try again. A send
 * that went becomes the receipt.
 */

import { ChevronLeft } from "lucide-react"
import type { ReactNode } from "react"
import Button from "../../../components/Button"
import ReportForm from "./ReportForm"
import ReportPreview from "./ReportPreview"
import ReportReceipt from "./ReportReceipt"
import ReportSendRow from "./ReportSendRow"
import type { Reporting } from "./useReport"

const PREVIEW_HEAD = "font-mono text-2xs tracking-wider text-fg-subtle uppercase"

const ReportPane = ({
  reporting,
  destination,
  phone,
  onBack,
}: {
  readonly reporting: Reporting
  /** The name the host gives its destination, where it gives one. */
  readonly destination: string | undefined
  readonly phone: boolean
  readonly onBack: () => void
}): ReactNode => {
  const { outcome, preview } = reporting
  const position = preview?.trak.position
  const head = (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      {phone ? (
        <span className="-ml-2 flex size-11 items-center justify-center">
          <Button
            aria-label="Back to the trak"
            variant="ghost"
            size="md"
            icon={ChevronLeft}
            onClick={onBack}
          />
        </span>
      ) : (
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={onBack}>
          {position === undefined ? "Back to the trak" : `Back to ${position}`}
        </Button>
      )}
      <h2 className="text-base font-medium text-fg">Report a problem</h2>
    </div>
  )

  if (outcome !== undefined && "sent" in outcome)
    return (
      <section aria-label="Report a problem" className="flex min-h-0 flex-1 flex-col bg-surface">
        {head}
        <ReportReceipt
          reference={outcome.sent}
          destination={destination}
          phone={phone}
          onBack={onBack}
        />
      </section>
    )

  const what =
    preview === undefined ? (
      <p className="text-xs text-fg-muted">
        {reporting.previewFailed
          ? "Could not read what would be sent. Send still builds the report from the log."
          : "Reading what would be sent…"}
      </p>
    ) : (
      <ReportPreview preview={preview} includeLog={reporting.includeLog} />
    )

  return (
    <section aria-label="Report a problem" className="flex min-h-0 flex-1 flex-col bg-surface">
      {head}
      <div
        className={
          phone
            ? "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
            : "grid min-h-0 flex-1 grid-cols-2 gap-6 overflow-hidden px-6 py-5"
        }
      >
        <ReportForm reporting={reporting} rows={phone ? 5 : 8} phone={phone} />
        <div
          className={`flex min-h-0 min-w-0 flex-col gap-2 ${phone ? "" : "border-l border-border pl-6"}`}
        >
          <span className={PREVIEW_HEAD}>What gets sent</span>
          {what}
        </div>
      </div>
      <ReportSendRow
        reporting={reporting}
        destination={destination}
        phone={phone}
        onCancel={onBack}
      />
    </section>
  )
}

export default ReportPane
