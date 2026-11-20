/**
 * Seconds until a moment, ticking — the one clock on the finished pane, and the proof
 * that the engine is still awake.
 *
 * It reads `useSecond`, which carries why the clock is a store rather than an interval in a
 * component. The number it counts down to came off the detail and moves only when the
 * detail does.
 *
 * `undefined` in is `undefined` out with nothing subscribed: a wait with no next ask on the
 * wire — the daemon restarted and has not swept, or the condition gave up — has no clock.
 */

import { useSecond } from "../../../hooks/useSecond"
import { secondsUntil } from "./waiting"

export const useCountdown = (until: number | undefined): number | undefined => {
  const now = useSecond(until !== undefined)
  return secondsUntil(until, now * 1000)
}
