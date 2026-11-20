/**
 * The goal's third tab: what the goal is, its settings, and where it came from — in the
 * Trak tab's section style.
 * The goal's line and the trak that opened it are here rather than in the head.
 *
 * **The settings are edited where they are drawn**, with no Edit press: the same strips as
 * the gate card, each change saved as it is made, which is what a running goal's settings
 * always did. They are editable wherever the goal has a file and is not at rest — before
 * the file is approved its settings are the gate card's, and at rest nothing moves them,
 * so both draw the read-only line.
 */

import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import Markdown from "../../components/Markdown"
import Section from "../../components/Section"
import { goalAtRest } from "../../format/goal"
import GoalSettingsStrips from "./GoalSettingsStrips"
import GoalSettingsSummary from "./GoalSettingsSummary"
import { settingsOf } from "./settings"
import type { GoalSettingsChange } from "./useGoalSettings"

/** The goal's facts, keyed as the Trak tab's own `Where` keys a trak's. */
const facts = (goal: GoalDto): readonly (readonly [string, ReactNode])[] => [
  ["goal", goal.id],
  ["file", goal.file],
  [
    "opened by",
    goal.from === undefined ? undefined : (
      <Link
        key="opened-by"
        to="/traks/$id"
        params={{ id: goal.from }}
        className="text-fg-muted underline decoration-border underline-offset-2 hover:decoration-fg-subtle"
      >
        {goal.from}
      </Link>
    ),
  ],
  ["paused", goal.paused ? "yes" : "no"],
]

/** Mono both sides, and a fact the goal does not have is left out rather than blank. */
const Where = ({ goal }: { readonly goal: GoalDto }): ReactNode => (
  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
    {facts(goal)
      .filter(([, value]) => value !== undefined)
      .map(([k, value]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-2xs font-medium text-fg-subtle">{k}</dt>
          <dd className="min-w-0 truncate font-mono text-2xs text-fg-muted">{value}</dd>
        </div>
      ))}
  </dl>
)

const GoalTab = ({
  goal,
  phone,
  settings,
}: {
  readonly goal: GoalDto
  readonly phone: boolean
  readonly settings: GoalSettingsChange
}): ReactNode => {
  // A sub-goal has no file: its spec is its parent's plan entry.
  const editable = (goal.file !== undefined || goal.parent !== undefined) && !goalAtRest(goal)
  // The file's line and finished state once there is one, as the agent wrote them; the
  // sentence the person asked in before that, drawn as a person's words are.
  const said = goal.line === undefined ? [goal.asked] : [goal.line, goal.finished]
  return (
    <div className="flex flex-col gap-6">
      <Section label="The goal">
        {said
          .filter((line) => line !== undefined)
          .map((line) => (
            <div key={line} className="min-w-0 text-base text-fg">
              <Markdown said={goal.line === undefined}>{line}</Markdown>
            </div>
          ))}
      </Section>
      <Section label="Settings">
        {editable ? (
          <>
            <GoalSettingsStrips
              settings={settings.pending ?? settingsOf(goal.limits)}
              onChange={settings.send}
              changed={undefined}
              stacked={phone}
            />
            {settings.said === undefined ? undefined : (
              <span role="alert" className="text-sm text-tone-bad">
                {settings.said}
              </span>
            )}
          </>
        ) : (
          <GoalSettingsSummary settings={settingsOf(goal.limits)} changed={undefined} />
        )}
      </Section>
      <Section label="Where">
        <Where goal={goal} />
      </Section>
    </div>
  )
}

export default GoalTab
