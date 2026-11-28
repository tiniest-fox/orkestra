/**
 * What the person adds: one optional box, and whether the log goes. The box is optional
 * because the trak's details and log are the evidence — a report with nothing typed is
 * still a report.
 *
 * **The log choice is one row, and the row is the press**: `Switch` only shows the state
 * and is under the touch floor on its own. Where the engine says the log cannot be cleaned
 * the row is locked off and its note says why, before anything is sent.
 */

import type { ReactNode } from "react"
import Field from "../../../components/Field"
import Switch from "../../../components/Switch"
import { logNote } from "./report"
import type { Reporting } from "./useReport"

const ReportForm = ({
  reporting,
  rows,
  phone,
}: {
  readonly reporting: Reporting
  readonly rows: number
  readonly phone: boolean
}): ReactNode => {
  const { locked, sending } = reporting
  const on = locked === undefined && reporting.includeLog
  // Where the engine cannot clean typed text, a note would be dropped, so none is taken.
  const withheld = reporting.preview?.withheld !== undefined
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium text-fg">What went wrong</span>
          <span className="text-xs text-fg-subtle">optional</span>
        </span>
        <Field
          id="report-note"
          label="What went wrong (optional)"
          value={reporting.note}
          onChange={reporting.setNote}
          placeholder={
            withheld
              ? "No note can go: the engine could not read its list of secrets to clean it with."
              : "What you saw, and what you expected instead. The trak's details and log go either way."
          }
          rows={rows}
          disabled={sending || withheld}
          unzoomed={phone}
        />
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={locked !== undefined || sending}
          onClick={reporting.toggleLog}
          className="flex min-h-9 items-center justify-between gap-3 text-left disabled:opacity-45 max-sm:min-h-11"
        >
          <span className="text-sm text-fg">Include the log</span>
          <Switch on={on} />
        </button>
        <p
          className={`text-xs leading-4 ${locked === undefined ? "text-fg-muted" : "text-tone-waiting"}`}
        >
          {locked ?? logNote(reporting.preview?.log)}
        </p>
      </div>
    </div>
  )
}

export default ReportForm
