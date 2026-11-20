/**
 * The drafted file's settings on its gate card. Live at a desk, the three strips; live on
 * a phone, the summary line with an Edit press that opens them in the bottom sheet. A
 * draft the goal has moved past is read-only, as its summary line.
 *
 * Nothing here is sent: what the person sets rides Approve, which the card holds. A value
 * that differs from the composer's draft is marked — a dot on its strip's caption, the
 * accent color on the summary line.
 */

import { SlidersHorizontal } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import Button from "../../components/Button"
import GoalSettingsOpen from "./GoalSettingsOpen"
import GoalSettingsStrips from "./GoalSettingsStrips"
import GoalSettingsSummary from "./GoalSettingsSummary"
import { differs, type SettingKey, type Settings } from "./settings"

const DraftSettings = ({
  drafted,
  settings,
  onChange,
  phone,
}: {
  readonly drafted: Settings
  readonly settings: Settings
  /** Absent on a draft the goal has moved past, which is only read. */
  readonly onChange: ((next: Settings) => void) | undefined
  readonly phone: boolean
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const changed = (key: SettingKey): boolean => differs(drafted, settings, key)
  if (onChange === undefined) return <GoalSettingsSummary settings={settings} changed={changed} />
  if (!phone)
    return (
      <GoalSettingsStrips
        settings={settings}
        onChange={onChange}
        changed={changed}
        stacked={false}
      />
    )
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 pt-1">
        <GoalSettingsSummary settings={settings} changed={changed} />
      </div>
      <Button
        variant="quiet"
        size="sm"
        icon={SlidersHorizontal}
        aria-label="Edit limits and modes"
        onClick={() => {
          setOpen(true)
        }}
      >
        Edit
      </Button>
      {open && (
        <GoalSettingsOpen
          note="Written into the file when you approve it."
          onDone={() => {
            setOpen(false)
          }}
        >
          <GoalSettingsStrips settings={settings} onChange={onChange} changed={changed} stacked />
        </GoalSettingsOpen>
      )}
    </div>
  )
}

export default DraftSettings
