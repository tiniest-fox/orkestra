/**
 * The three presses the footer band can carry, as one value — the stop, the filing and
 * the recompose. An aggregator, as `useFinishing` is: three mutations with three refusals,
 * and no discriminator of its own.
 *
 * **None of the three takes custody, which is the whole reason they are named together.**
 * `useStop`, `useFile` and `useRecompose` each interrupt or re-enter rather than starting a
 * second drive — the route takes a drive over where one is under way, or `startDrive`
 * refuses it — so custody decides whether each press *exists*, in `controls.ts`, and none
 * holds a second opinion about it. Reading the three from one place is what keeps a caller
 * from handing `running` to a hook that must not have it.
 *
 * Which of the three a state offers is not decided here. `footerFor` on the page asks
 * `controls.ts`, and the recompose is also welded into a document card where one is the
 * newest thing.
 */

import { type Filing, useFile } from "../useFile"
import { type Recomposing, useRecompose } from "./useRecompose"
import { type Stopping, useStop } from "../useStop"

export interface BreakOutPresses {
  readonly stopping: Stopping
  readonly filing: Filing
  readonly recomposing: Recomposing
}

export const useBreakOut = (id: string): BreakOutPresses => ({
  stopping: useStop(id),
  filing: useFile(id),
  recomposing: useRecompose(id),
})
