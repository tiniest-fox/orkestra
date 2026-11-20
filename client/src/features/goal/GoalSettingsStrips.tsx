/**
 * A goal's settings as three strips, in New Trak's segment grammar: the modes it may open
 * traks on (several may be on), auto-merge (one of three), and its three limits in one
 * strip. Every option is visible and one tap changes it.
 *
 * The same strips on a desk and in the phone's sheet, where `stacked` lays the limits one
 * above another; a phrase that does not fit is cut off with an ellipsis.
 *
 * `changed` marks a caption with a dot where the value differs from the composer's draft.
 * Only the gate card passes one: a running goal's changes are saved as they are made, so
 * there is nothing pending to mark.
 */

import { GitMerge } from "lucide-react"
import type { ReactNode } from "react"
import { MODE_WORDS, MODES } from "../../format/runMode"
import GoalLimitControl from "./GoalLimitControl"
import {
  LIMIT_WORDS,
  LIMITS,
  MERGE_WORDS,
  MERGES,
  modeLocked,
  type SettingKey,
  type Settings,
  toggledMode,
} from "./settings"

const segment = (on: boolean): string =>
  `flex min-w-0 flex-1 basis-0 flex-col gap-0.5 px-3 py-1.5 text-left transition-colors max-sm:min-h-11 ${on ? "bg-accent text-accent-ink" : "text-fg-muted hover:bg-hover-row"}`
const STRIP =
  "flex overflow-hidden rounded-control border border-border bg-surface [&>*+*]:border-l [&>*+*]:border-border"
const COLUMN =
  "flex flex-col overflow-hidden rounded-control border border-border bg-surface [&>*+*]:border-t [&>*+*]:border-border"
/**
 * A limit's row: a third of the strip at a desk, and in the phone's column at least the
 * 44px its presses are there — sized from a zero basis it would stay 36px tall, and the
 * column's `overflow-hidden` would clip the presses that overflow it.
 */
const STRIP_ROW = "min-h-9 flex-1 basis-0"
const STACKED_ROW = "min-h-11"

const Caption = ({
  label,
  changed,
  children,
}: {
  readonly label: string
  readonly changed: boolean
  readonly children: ReactNode
}): ReactNode => (
  <div className="flex flex-col gap-1.5">
    <span className="flex items-center gap-1.5 font-mono text-2xs tracking-wider text-fg-subtle uppercase">
      {label}
      {changed && (
        <span
          role="img"
          aria-label="changed from the draft"
          className="size-1.5 rounded-pill bg-accent"
        />
      )}
    </span>
    {children}
  </div>
)

const Segment = ({
  on,
  name,
  phrase,
  glyph,
}: {
  readonly on: boolean
  readonly name: string
  readonly phrase: string
  readonly glyph: ReactNode
}): ReactNode => (
  <>
    <span className="flex min-w-0 items-center gap-1.5">
      {glyph}
      <span className="truncate text-base font-medium">{name}</span>
    </span>
    <span className={`truncate text-sm ${on ? "" : "text-fg-subtle"}`}>{phrase}</span>
  </>
)

const GoalSettingsStrips = ({
  settings,
  onChange,
  changed,
  stacked,
}: {
  readonly settings: Settings
  readonly onChange: (next: Settings) => void
  readonly changed: ((key: SettingKey) => boolean) | undefined
  readonly stacked: boolean
}): ReactNode => {
  const marked = (key: SettingKey): boolean => changed?.(key) ?? false
  return (
    <div className="flex flex-col gap-3">
      <Caption label="Traks it may open" changed={marked("modes")}>
        <div role="group" aria-label="Modes" className={STRIP}>
          {MODES.map((m) => {
            const { name, phrase, mark: Mark } = MODE_WORDS[m]
            const on = settings.modes.includes(m)
            const locked = modeLocked(settings, m)
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                aria-disabled={locked}
                title={locked ? "A goal needs at least one mode" : undefined}
                onClick={() => {
                  if (!locked) onChange(toggledMode(settings, m))
                }}
                className={`${segment(on)} aria-disabled:cursor-not-allowed`}
              >
                <Segment
                  on={on}
                  name={name}
                  phrase={phrase}
                  glyph={<Mark size={13} className="shrink-0" aria-hidden />}
                />
              </button>
            )
          })}
        </div>
      </Caption>
      <Caption label="Auto-merge" changed={marked("merge")}>
        <div role="radiogroup" aria-label="Auto-merge" className={STRIP}>
          {MERGES.map((m) => {
            const on = settings.merge === m
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ ...settings, merge: m })}
                className={segment(on)}
              >
                <Segment
                  on={on}
                  name={MERGE_WORDS[m].name}
                  phrase={MERGE_WORDS[m].phrase}
                  glyph={
                    m === "always" ? (
                      <GitMerge size={13} className="shrink-0" aria-hidden />
                    ) : undefined
                  }
                />
              </button>
            )
          })}
        </div>
      </Caption>
      <Caption label="Limits" changed={LIMITS.some(marked)}>
        <div className={stacked ? COLUMN : STRIP}>
          {LIMITS.map((k) => (
            <div
              key={k}
              className={`flex min-w-0 items-center justify-between gap-2 py-1 pr-1.5 pl-3 ${stacked ? STACKED_ROW : STRIP_ROW}`}
            >
              <span
                className={`text-sm whitespace-nowrap ${settings[k] === undefined ? "text-fg-subtle" : "text-fg-muted"}`}
              >
                {LIMIT_WORDS[k].label}
              </span>
              <GoalLimitControl
                limit={k}
                value={settings[k]}
                onChange={(value) => onChange({ ...settings, [k]: value })}
              />
            </div>
          ))}
        </div>
      </Caption>
    </div>
  )
}

export default GoalSettingsStrips
