/**
 * The card an MCP tool's call is drawn as in the column of the agent's words: a tinted
 * header naming the server and the tool, which is the press that opens and folds it, and
 * whatever the call shows under it.
 *
 * **One shell for every tool that draws.** A server's own view and the engine's check are
 * both this card, so a reader meets one treatment for *a tool showed something here*.
 *
 * `detail` is quiet text after the name, and `trailing` sits at the header's right end:
 * the header itself never takes a tone.
 */

import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import McpMark from "../activity/McpMark"

const McpCard = ({
  server,
  tool,
  detail,
  trailing,
  open,
  onToggle,
  children,
}: {
  readonly server: string
  readonly tool: string
  readonly detail: string | undefined
  readonly trailing: ReactNode
  readonly open: boolean
  /** `undefined` where there is nothing to open, which draws the header unpressable. */
  readonly onToggle: (() => void) | undefined
  readonly children: ReactNode
}): ReactNode => (
  <section
    aria-label={`View ${server}/${tool}`}
    className="min-w-0 overflow-hidden rounded-surface bg-surface ring-1 ring-border"
  >
    <button
      type="button"
      aria-expanded={open}
      disabled={onToggle === undefined}
      onClick={onToggle}
      className="flex h-7 w-full min-w-0 items-center gap-1.5 bg-surface-2 px-3 text-left max-sm:h-11"
    >
      <ChevronRight
        size={12}
        aria-hidden
        className={`shrink-0 text-fg-subtle ${open ? "rotate-90" : ""} ${onToggle === undefined ? "opacity-0" : ""}`}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono text-xs text-fg">
        <McpMark />
        <span className="min-w-0 truncate [direction:rtl] [text-align:left]">
          <bdi>{`${server}/${tool}`}</bdi>
        </span>
        {detail === undefined ? undefined : (
          <span className="shrink-0 text-fg-subtle max-sm:hidden">{detail}</span>
        )}
      </span>
      {trailing}
    </button>
    {children}
  </section>
)

export default McpCard
