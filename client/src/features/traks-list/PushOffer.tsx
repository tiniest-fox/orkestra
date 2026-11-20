import type { ReactNode } from "react"
import { Bell } from "lucide-react"
import Button from "../../components/Button"
import { usePushOffer } from "./usePushOffer"

/**
 * The band over the list that asks for notification permission — a bell, one sentence,
 * Turn on and Not now, the same shape on a phone and a desk.
 * It is asked once: Turn on subscribes this browser with the engine, Not now is
 * remembered, and a browser that cannot push never draws it. `usePushOffer` holds all
 * of that; this only draws the answer.
 */
const PushOffer = (): ReactNode => {
  const offer = usePushOffer()
  if (!offer.open) return null
  return (
    <div className="flex items-center gap-3 border-b border-border px-gutter py-2">
      <Bell size={12} aria-hidden className="shrink-0 text-fg-muted" />
      <span className="text-sm text-fg-muted">
        {offer.failed
          ? "Turning notifications on failed — is the engine reachable? Try again."
          : "Get a notification when a trak needs you or finishes."}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={offer.dismiss}>
          Not now
        </Button>
        <Button variant="quiet" size="sm" onClick={offer.turnOn}>
          Turn on
        </Button>
      </span>
    </div>
  )
}

export default PushOffer
