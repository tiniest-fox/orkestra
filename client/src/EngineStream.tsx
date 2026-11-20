/**
 * The stream, mounted.
 *
 * A component that draws nothing and exists so that a hook has a place to live for as
 * long as this browser is in. `AppChrome`, which mounts it, cannot call the hook itself
 * — it is kind `chrome` and may not touch the query cache — and no page can, because a
 * subscription per screen is a subscription that ends when you navigate.
 *
 * **Being a component is also what puts it inside `SessionGate`'s children**, which is
 * what unmounts it on a refusal: an `EventSource` answered 401 closes for good, so the
 * stream must not outlive the session or open before one.
 *
 * A new row for `client-style`'s admission table: kind `mount` — a component whose
 * whole body is one hook and whose render is nothing.
 */

import type { ReactNode } from "react"
import { useEngineStream } from "./hooks/useEngineStream"

const EngineStream = (): ReactNode => {
  useEngineStream()
  return undefined
}

export default EngineStream
