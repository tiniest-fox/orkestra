/**
 * What the hooks on one call said, as the hook mark's popover and phone sheet draw it: per
 * hook its event, how it ended, how long it took, the file that configured it and each
 * line it printed. Hooks are parted by a dashed rule.
 *
 * **The source truncates from the left**: the file name at the end is what tells two
 * hooks apart, and the home directory in front of it is the same on every one.
 */

import type { ReactNode } from "react"
import type { HookEntryDto } from "../../../../api/types"
import { hookDuration, hookInk, hookWord, outputInk } from "../../../../format/hooks"

const OneHook = ({ hook }: { readonly hook: HookEntryDto }): ReactNode => (
  <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
    <div className="flex min-w-0 items-baseline gap-2 font-mono text-xs">
      <span className="text-fg">{hook.event}</span>
      <span className={hook.status === "completed" ? "text-fg-subtle" : hookInk[hook.status]}>
        {hookWord[hook.status]}
        {hook.message === undefined ? "" : ` · ${hook.message}`}
      </span>
      {hook.durationMs === undefined ? undefined : (
        <span className="ml-auto shrink-0 text-2xs text-fg-subtle">
          {hookDuration(hook.durationMs)}
        </span>
      )}
    </div>
    {hook.source === undefined ? undefined : (
      <div className="min-w-0 truncate text-left font-mono text-2xs text-fg-subtle" dir="rtl">
        <bdi>{hook.source}</bdi>
      </div>
    )}
    {hook.output.length === 0 ? (
      <div className="font-mono text-2xs text-fg-subtle italic">no output</div>
    ) : (
      <ul className="mt-0.5 flex max-h-28 flex-col gap-0.5 overflow-y-auto rounded-control bg-surface-2 px-1.5 py-1">
        {hook.output.map((line, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- the lines a hook printed, in order, with no id
          <li key={i} className="flex gap-1.5 font-mono text-2xs">
            <span className={`w-12 shrink-0 ${outputInk(line.kind)}`}>{line.kind}</span>
            <span className="min-w-0 break-words text-fg-muted">{line.text}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
)

const HookCard = ({ hooks }: { readonly hooks: readonly HookEntryDto[] }): ReactNode =>
  hooks.map((hook, i) => (
    // oxlint-disable-next-line react/no-array-index-key -- a call's hooks in the order they ran, with no id
    <div key={i} className={i === 0 ? "" : "border-t border-dashed border-border"}>
      <OneHook hook={hook} />
    </div>
  ))

export default HookCard
