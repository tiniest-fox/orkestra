/**
 * A rail item's numeral — an overview's part, a walkthrough's step: a 16px circle, filled
 * in the accent when its item is the picked one.
 */

import type { ReactNode } from "react"

const RailNumber = ({ n, on }: { readonly n: number; readonly on: boolean }): ReactNode => (
  <span
    className={`flex size-4 items-center justify-center rounded-pill font-mono text-xs leading-none tabular-nums ${on ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg-subtle"}`}
  >
    {n}
  </span>
)

export default RailNumber
