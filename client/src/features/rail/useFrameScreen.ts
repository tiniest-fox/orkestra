/**
 * The press that asks the open project's frame to open search — `api/frame.ts` says why
 * the page listens.
 *
 * Each frame is told whether this page draws its phone header over it, which is what the
 * frame's bar stands down on. Every frame's report is held, keyed by its prefix. A frame
 * that has said nothing has no search to ask for: one still loading, or a client from
 * before the frame spoke. Nor does a pane with no frame at all.
 *
 * **Each frame is also told whether it is shown**, so the frames together hold at most one
 * entry over home on the back stack they share with this page — `api/frame.ts` says how.
 * The shown frame is told only once no other frame holds an entry, and a frame giving its
 * entry up says so in its next report, which is what lets it be told.
 */

import { useEffect, useState } from "react"
import { askSearch, frameBase, tellHeader, tellShown, watchScreens } from "../../api/frame"
import type { FrameScreen } from "../../api/frame"
import type { RailProjectDto } from "../../api/types"

export const useFrameScreen = (
  selected: RailProjectDto | undefined,
  /** This page draws its phone header over every frame. */
  drawn: boolean,
): (() => void) | undefined => {
  const [screens, setScreens] = useState<ReadonlyMap<string, FrameScreen>>(new Map())
  useEffect(
    () =>
      watchScreens((screen) => {
        setScreens((held) => new Map(held).set(screen.base, screen))
      }),
    [],
  )
  // Every frame that has spoken is told again whenever the page crosses its breakpoint,
  // and a frame is told on its first report — so none waits on a later change to learn it.
  useEffect(() => {
    for (const screen of screens.values()) tellHeader(screen.frame, drawn)
  }, [screens, drawn])
  const base =
    selected?.engine === "started" && selected.href !== undefined
      ? frameBase(selected.href)
      : undefined
  // Every report re-sends both answers; a frame acts only on a change.
  useEffect(() => {
    let held = false
    for (const screen of screens.values())
      if (screen.base !== base) {
        tellShown(screen.frame, false)
        held ||= screen.held
      }
    const open = base === undefined ? undefined : screens.get(base)
    if (open !== undefined && !held) tellShown(open.frame, true)
  }, [screens, base])
  const screen = base === undefined ? undefined : screens.get(base)
  return screen === undefined ? undefined : () => askSearch(screen.frame)
}
