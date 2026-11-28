/**
 * The foot of the report form: where it goes, Cancel, and the one primary press — Send
 * report, Sending… while one is out, and Try again after a send the host could not make,
 * with the host's reason above the row and the person's words still in the box.
 */

import type { ReactNode } from "react"
import Button from "../../../components/Button"
import type { Reporting } from "./useReport"

const ReportSendRow = ({
  reporting,
  destination,
  phone,
  onCancel,
}: {
  readonly reporting: Reporting
  readonly destination: string | undefined
  readonly phone: boolean
  readonly onCancel: () => void
}): ReactNode => {
  const { outcome, sending } = reporting
  // A send that went draws the receipt in place of the form, so only a failure reaches here.
  const failed = outcome !== undefined && "failed" in outcome ? outcome.failed : undefined
  return (
    <div
      className={`flex shrink-0 flex-col gap-2 border-t border-border ${phone ? "px-4" : "px-6"} pt-3 pb-foot`}
    >
      {failed !== undefined && (
        <div
          role="alert"
          className="flex flex-col gap-0.5 rounded-control border border-tone-bad/40 bg-tone-bad-bg px-3 py-2"
        >
          <span className="text-sm font-medium text-tone-bad">The report did not go through</span>
          <span className="text-xs leading-4 text-fg-muted">
            {failed} Your text is kept here, so you can send it again.
          </span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 max-sm:[&_button]:min-h-11">
        {destination !== undefined && (
          <span className="mr-auto min-w-0 truncate text-xs text-fg-muted">
            Sent to {destination}
          </span>
        )}
        {!sending && (
          <Button variant="ghost" size={phone ? "lg" : "md"} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          size={phone ? "lg" : "md"}
          busy={sending}
          disabled={reporting.disabled}
          onClick={reporting.send}
        >
          {sending ? "Sending…" : failed === undefined ? "Send report" : "Try again"}
        </Button>
      </div>
    </div>
  )
}

export default ReportSendRow
