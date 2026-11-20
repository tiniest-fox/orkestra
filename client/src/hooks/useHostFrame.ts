/**
 * This page's half of the header a host's page draws over it on a phone — `api/frame.ts`
 * says why the header spans two documents, and why the bar stands down on the page's word.
 *
 * Inside a host's frame it tells the page it is there, again whenever it takes or gives up
 * an entry over the list, and opens the palette when
 * the page's search press asks. Answers whether the page has said it draws the header over
 * this one, which is what the app bar reads to stand down — `false` until it says so, so
 * a page that never speaks leaves the bar drawn.
 *
 * It also keeps this frame's share of the back stack the frames have in common: it says
 * whether it holds an entry over the list, and gives that entry up when the page hides it
 * and takes one back when the page shows it again — `api/frame.ts` says why.
 *
 * Kind `hook`: no JSX, and nothing fetched.
 */

import { useEffect, useState } from "react"
import { useRouter, useRouterState } from "@tanstack/react-router"
import { framed, tellScreen, watchHost } from "../api/frame"
import { reclaim, release } from "../backStack"
import { setPaletteOpen } from "./usePalette"

/** Read once: a page does not move between being framed and not. */
const inFrame = framed()

export const useHostFrame = (): boolean => {
  const router = useRouter()
  const held = useRouterState({ select: (s) => s.location.state.overList === true })
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    if (inFrame) tellScreen(held)
  }, [held])
  // Listened for whether framed or not: only a parent's message is believed, and a page
  // with no parent is its own, which never sends one.
  useEffect(
    () =>
      watchHost(
        () => setPaletteOpen(true),
        setCovered,
        (shown) => {
          if (shown) reclaim(router.history, router.basepath)
          else release(router.history, router.basepath)
        },
      ),
    [router],
  )
  return covered
}
