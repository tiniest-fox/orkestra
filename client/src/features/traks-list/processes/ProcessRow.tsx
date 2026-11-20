/**
 * One of the project checkout's processes as a row in the git bar's list: its state's
 * glyph, its name, a short line, the link to its page while it is up, and its presses —
 * Start (or Start again) where it is down, Restart and Stop where it is up, then its log.
 *
 * **A page opens in a browser tab**: the project checkout has no
 * side panel to draw one in. Behind a page domain the link is the page's own hostname. A
 * press in flight and a refused one are the side panel's treatment — the press's spinner,
 * and the list's sentence under the rows.
 */

import type { ReactNode } from "react"
import { ExternalLink, Play, RotateCw, ScrollText, Square } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import Button from "../../../components/Button"
import ProcessGlyph from "../../../components/ProcessGlyph"
import { hostedLive } from "../../../format/hosted"
import type { ProcessPresses } from "../../../hooks/useProcessPress"
import { useSecond } from "../../../hooks/useSecond"
import type { PageOrigins } from "../../../format/hosted"
import { pageAddress, rowLine } from "./projectProcesses"

/** The address as a person reads it: no scheme, no trailing slash. */
const shortUrl = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "")

const ProcessRow = ({
  process,
  presses,
  origins,
  tap,
  logOpen,
  onLog,
}: {
  readonly process: HostedProcessDto
  readonly presses: ProcessPresses
  readonly origins: PageOrigins | undefined
  readonly tap: boolean
  /** Whether this row's log is the one shown — its press is lit and goes back. */
  readonly logOpen: boolean
  readonly onLog: () => void
}): ReactNode => {
  const { name, state } = process
  const tag = state._tag
  const live = hostedLive(tag)
  const now = useSecond(live) * 1000
  const url = pageAddress(process, origins)
  const starting = presses.starting?.name === name ? presses.starting.verb : undefined
  const bad = tag === "Exited" || tag === "DidNotComeUp"
  return (
    <li className={`flex items-center gap-2.5 py-1 ${tap ? "min-h-14" : "min-h-10"}`}>
      <ProcessGlyph tag={tag} size={tap ? 16 : 13} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-mono text-fg ${tap ? "text-base" : "text-sm"}`}>
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-muted">
          <span className={`shrink-0 ${bad ? "text-tone-bad" : ""}`}>{rowLine(process, now)}</span>
          {url !== undefined && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-0.5 font-mono text-accent hover:underline"
            >
              <span className="truncate">{shortUrl(url)}</span>
              <ExternalLink size={10} aria-hidden className="shrink-0" />
            </a>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {live ? (
          <>
            {tag === "Running" && (
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCw}
                aria-label={`Restart ${name}`}
                busy={starting === "restart"}
                onClick={() => presses.press(name, "restart")}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={Square}
              aria-label={`Stop ${name}`}
              busy={presses.stopping === name}
              onClick={() => presses.press(name, "stop")}
            />
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={Play}
            aria-label={`Start ${name}`}
            busy={starting === "start"}
            disabled={presses.starting !== undefined}
            onClick={() => presses.press(name, "start")}
          >
            {tag === "NotStarted" ? "Start" : "Start again"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={ScrollText}
          aria-label={`Show ${name}'s log`}
          aria-pressed={logOpen}
          onClick={onLog}
        />
      </span>
    </li>
  )
}

export default ProcessRow
