/**
 * The line under the pull request panel's address bar that says why GitHub's page is not
 * signed in. A band of the panel's own, never
 * drawn over GitHub's page: the native view sits below it, so the person reads Orkestra's
 * line and GitHub's sign-in form at once.
 */

import type { ReactNode } from "react"
import { ExternalLink, RotateCw, X } from "lucide-react"
import Button from "../../../components/Button"
import { toneInk } from "../../../format/tone"
import type { LoginLine } from "./loginLine"

const PullRequestLogin = ({
  line,
  onAct,
  onClose,
}: {
  readonly line: LoginLine
  readonly onAct: (does: "copy" | "sign-in") => void
  readonly onClose: () => void
}): ReactNode => {
  const Icon = line.icon
  const { action } = line
  return (
    <div
      role="status"
      className={`flex shrink-0 items-center gap-2.5 border-b px-3 py-2 ${line.failure ? "border-tone-waiting/30 bg-tone-waiting-bg" : "border-border bg-surface-2"}`}
    >
      <Icon
        size={13}
        aria-hidden
        className={`shrink-0 ${line.spin ? "animate-spin" : ""} ${line.failure ? toneInk.waiting : "text-fg-subtle"}`}
      />
      <p className={`min-w-0 flex-1 text-sm ${line.failure ? "text-fg" : "text-fg-muted"}`}>
        {line.text}
      </p>
      {action !== undefined && (
        <Button
          variant="quiet"
          size="sm"
          icon={action.does === "copy" ? RotateCw : ExternalLink}
          onClick={() => onAct(action.does)}
        >
          {action.label}
        </Button>
      )}
      {line.closable && (
        <Button variant="ghost" size="sm" icon={X} aria-label="Close this note" onClick={onClose} />
      )}
    </div>
  )
}

export default PullRequestLogin
