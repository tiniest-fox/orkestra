/**
 * A report that went: the receiver's reference, and the way back to the trak. A URL is a
 * link that opens in a new tab and anything else is text; both keep a copy press, because
 * a reference is pasted more than it is opened. Nothing on the trak keeps the reference,
 * so this is the one place it is shown.
 */

import { Check, Copy, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import Button from "../../../components/Button"
import { isLink } from "./report"

const ReportReceipt = ({
  reference,
  destination,
  phone,
  onBack,
}: {
  readonly reference: string
  readonly destination: string | undefined
  readonly phone: boolean
  readonly onBack: () => void
}): ReactNode => {
  const [copied, setCopied] = useState(false)
  return (
    <div className={`flex max-w-[560px] flex-col gap-3 ${phone ? "px-4 py-6" : "px-6 py-6"}`}>
      <h3 className="flex items-center gap-1.5 text-base font-medium text-fg">
        <span className="flex size-5 items-center justify-center rounded-pill bg-tone-good-bg text-tone-good">
          <Check size={12} aria-hidden />
        </span>
        Report sent
      </h3>
      <p className="text-sm leading-5 text-fg-muted">
        {destination === undefined ? "" : `Sent to ${destination}. `}The receiver filed it under
        this reference.
      </p>
      <div className="flex min-w-0 items-center gap-1">
        {isLink(reference) ? (
          <a
            href={reference}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
          >
            <span className="min-w-0 truncate font-mono text-xs">{reference}</span>
            <ExternalLink size={12} className="shrink-0" aria-hidden />
          </a>
        ) : (
          <code className="min-w-0 truncate font-mono text-sm text-fg select-all">{reference}</code>
        )}
        <span className={phone ? "flex size-11 shrink-0 items-center justify-center" : "shrink-0"}>
          <Button
            aria-label={copied ? "Reference copied" : "Copy the reference"}
            variant="ghost"
            size="sm"
            icon={copied ? Check : Copy}
            onClick={() => {
              void navigator.clipboard.writeText(reference).then(() => setCopied(true))
            }}
          />
        </span>
      </div>
      <div className="pt-2">
        <Button variant="quiet" size={phone ? "lg" : "md"} block={phone} onClick={onBack}>
          Back to the trak
        </Button>
      </div>
    </div>
  )
}

export default ReportReceipt
