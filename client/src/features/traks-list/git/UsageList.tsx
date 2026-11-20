/**
 * One CLI's section of what a usage cell opens — the desk's panel and the phone's sheet
 * alike: a header with the CLI's mark and the reading's age, and every window with its
 * meter and its line of pace, reset and run-out words. An unavailable reading gives its
 * reason instead, and one never taken says when the first comes. The line teaching the
 * tick is `UsageTick`, drawn once under every section.
 *
 * **The clock is read here rather than in the cell**, for `GitFetched`'s reason: it ticks
 * once a second while the panel is open, and nowhere else.
 */

import type { ReactNode } from "react"
import type { CliUsageDto } from "../../../api/types"
import { cliGlyph } from "../../../format/modelName"
import { useSecond } from "../../../hooks/useSecond"
import UsageMeter from "./UsageMeter"
import UsagePercent from "./UsagePercent"
import UsagePollDot from "./UsagePollDot"
import { ageWords, cliName, unavailableWords, windowLine, windowsOf } from "./usageView"

const UsageList = ({
  usage,
  tap,
}: {
  readonly usage: CliUsageDto
  /** The phone's sheet: larger type and more room between windows. */
  readonly tap: boolean
}): ReactNode => {
  const now = useSecond(true) * 1000
  const Mark = cliGlyph(`${usage.cli}/`)
  const state = usage.usage
  const text = tap ? "text-base" : "text-sm"
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-center justify-between gap-2 ${text}`}>
        <span className="flex items-center gap-1.5 font-semibold text-fg">
          <Mark size={tap ? 16 : 14} aria-hidden className="shrink-0 text-fg-muted" />
          {cliName(usage.cli)} usage
        </span>
        {state._tag === "Read" && (
          <span className="flex items-center gap-1.5 text-fg-subtle">
            {usage.polling && <UsagePollDot />}
            {`${usage.polling ? "polling · " : ""}read ${ageWords(state.at, now)}`}
          </span>
        )}
      </div>
      {state._tag === "NotRead" && (
        <p className="text-sm text-fg-muted">
          The first reading comes with the first {cliName(usage.cli)} turn.
        </p>
      )}
      {state._tag === "Unavailable" && (
        <div className="flex flex-col gap-1">
          <p className={`${text} text-fg`}>Usage unavailable</p>
          <p className="text-sm leading-snug text-fg-muted">
            {unavailableWords(usage.cli, state.why)}
          </p>
        </div>
      )}
      {state._tag === "Read" && (
        <ul className={`flex flex-col ${tap ? "gap-4" : "gap-3"}`}>
          {windowsOf(usage, now).map((w) => (
            <li key={w.key} className="flex flex-col gap-1.5">
              <div className={`flex items-baseline justify-between ${text}`}>
                <span className="text-fg">{w.label}</span>
                <UsagePercent window={w} />
              </div>
              <UsageMeter window={w} width="100%" height="panel" />
              <span className="text-xs text-fg-subtle">{windowLine(w, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default UsageList
