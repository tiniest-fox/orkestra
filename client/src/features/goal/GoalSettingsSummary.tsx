/**
 * What a goal's settings are, on one mono line: traks at once, the hourly and daily
 * limits where set, the modes, and auto-merge. Read-only — the Goal tab draws it where the
 * settings cannot be changed, and the gate card on a phone draws it beside its Edit press.
 *
 * `changed`, given only at the gate card, draws a value that differs from the composer's
 * draft in the accent color.
 */

import { GitMerge } from "lucide-react"
import type { ReactNode } from "react"
import { MODE_WORDS } from "../../format/runMode"
import ModeMark from "./moves/ModeMark"
import { LIMITS, limitText, MERGE_WORDS, type SettingKey, type Settings } from "./settings"

const GoalSettingsSummary = ({
  settings,
  changed,
}: {
  readonly settings: Settings
  readonly changed: ((key: SettingKey) => boolean) | undefined
}): ReactNode => {
  const ink = (key: SettingKey): string => ((changed?.(key) ?? false) ? "text-accent" : "")
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-fg-muted">
      {LIMITS.filter((k) => k === "parallel" || settings[k] !== undefined).map((k) => (
        <span key={k} className={ink(k)}>
          {limitText(k, settings[k])}
        </span>
      ))}
      <span className={`inline-flex items-center gap-1.5 ${ink("modes")}`}>
        {settings.modes.map((m) => (
          <span key={m} className="inline-flex items-center gap-1">
            <ModeMark mode={m} />
            {MODE_WORDS[m].name}
          </span>
        ))}
      </span>
      <span className={`inline-flex items-center gap-1 ${ink("merge")}`}>
        <GitMerge size={11} aria-hidden className="opacity-70" />
        auto-merge {MERGE_WORDS[settings.merge].short}
      </span>
    </span>
  )
}

export default GoalSettingsSummary
