/**
 * Which position the drawer is standing at, held in the URL rather than in the page.
 *
 * **It is in the URL because a piece has nowhere else to be named.** A spawn's piece is read
 * and acted on inside its parent's drawer, so *which piece* is the difference between two
 * screens that are otherwise the same trak — and a link, a reload or a paste has to land on
 * the same one. That is the whole reason `routes.ts` grew its only search param.
 *
 * **A bare child id is normalised to the position key on arrival, with `replace`.** The list
 * can only name a piece by its trak id; the parent is what turns that into a position. Once
 * it has, the URL is rewritten to the position — so a link somebody copies afterwards points
 * at the step that was interesting rather than at wherever that piece has got to since.
 * `replace`, because the resolution is not somewhere a person navigated to.
 *
 * **Every move `replace`s too.** Stepping through a plan with the arrows is reading, not
 * navigating, and a history entry per position would make Back mean *one step up the
 * transcript* for as long as somebody had been reading.
 *
 * `undefined` in the URL means *wherever the trak is* — the drawer opens there and follows
 * it until a person steps somewhere else, which is what keeps a poll from yanking the pane.
 *
 * **The trak standing there has been opened**, so this device's notifications for it are
 * closed — at a spawn's piece that is the piece, which the page's own id never names. Here
 * because whichever form the URL took, a bare id or a position key, this is where it
 * resolves to a trak.
 */

import { useEffect } from "react"
import { getRouteApi } from "@tanstack/react-router"
import type { TrakStateDto } from "../../../api/types"
import { useClearNotifications } from "../../../hooks/useClearNotifications"
import { type Band, familyFocus, resolveSpot, type Spot } from "./family"

/** The same route `TrakDetailPage` reads its param from, and it carries why the id is this. */
const route = getRouteApi("/shell/traks/$id")

export interface Standing {
  readonly spot: Spot | undefined
  /** The keys the arrows move to, or `undefined` at the ends of the walk. */
  readonly prev: string | undefined
  readonly next: string | undefined
  /**
   * Where the trak itself is, whatever the URL names — `familyFocus`' own, passed straight
   * through. What asks is the failure notice, which belongs at the position the trak
   * stopped at and nowhere else. `undefined` before the detail has answered, which is the
   * frame where nothing is picked either.
   */
  readonly resting: string | undefined
  /** Stand somewhere else. Takes a position key, which is what every surface hands back. */
  readonly pick: (key: string) => void
}

/**
 * `bands` and `state` come from the page, which has already read the detail — `state` is
 * `undefined` while it is still loading, and this then stands nowhere rather than holding a
 * second opinion about a trak nobody has answered for yet.
 */
export const useSpot = (bands: readonly Band[], state: TrakStateDto | undefined): Standing => {
  const { spot: picked } = route.useSearch()
  const navigate = route.useNavigate()
  // The key the family answers to, which is the picked value itself unless the list handed
  // over a bare child id. `undefined` while nothing matches, including the frames before
  // `useFamily` has answered for that piece — so the normalisation below cannot fire early
  // and overwrite the id with the parent's fallback position.
  const at = picked === undefined ? undefined : resolveSpot(bands, picked)

  useEffect(() => {
    if (at !== undefined && at !== picked) void navigate({ search: { spot: at }, replace: true })
  }, [at, picked, navigate])

  const focus =
    state === undefined
      ? { spot: undefined, prev: undefined, next: undefined, resting: undefined }
      : familyFocus(bands, state, at)
  useClearNotifications(focus.spot === undefined ? undefined : `trak:${focus.spot.trak.id}`)

  return {
    ...focus,
    pick: (key: string) => {
      void navigate({ search: { spot: key }, replace: true })
    },
  }
}
