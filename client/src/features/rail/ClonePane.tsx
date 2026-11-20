import type { ReactNode } from "react"
import { Download } from "lucide-react"
import EmptyState from "../../components/EmptyState"

/**
 * The pane for a project the host is still cloning: the band the app draws while the
 * engine works, naming the clone, with how far it has come under it. Once the clone lands the
 * project is starting like any other, and the pane draws `StartPane` or the list's loading
 * frame.
 */
const ClonePane = ({
  name,
  progress,
}: {
  readonly name: string
  /** 0–100. */
  readonly progress: number
}): ReactNode => {
  const percent = Math.round(progress)
  return (
    <EmptyState
      tone="working"
      icon={Download}
      title={`Cloning ${name}`}
      under={
        <span className="flex w-full max-w-[320px] items-center gap-3">
          <span
            role="progressbar"
            aria-label={`Cloning ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1 flex-1 overflow-hidden rounded-pill bg-tone-working-track"
          >
            <span
              className="block h-full bg-tone-working"
              style={{ width: `${String(percent)}%` }}
            />
          </span>
          <span className="font-mono text-xs text-fg-muted">{`${String(percent)}%`}</span>
        </span>
      }
    >
      Its engine starts once the clone lands.
    </EmptyState>
  )
}

export default ClonePane
