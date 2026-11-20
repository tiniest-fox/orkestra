/**
 * An on/off state, made visible. **Not a press.**
 *
 * **26×16 with a 12px knob, which is under the 44px touch floor on its own** — so the row
 * around it is the control and this is the state that row holds, drawn where a reader
 * expects to find it. A switch a person has to hit exactly is a different control and a
 * worse one, which is why this takes no `onClick` and no `role`: the `menuitemcheckbox`
 * or the row that carries `aria-checked` is what a screen reader names, and this is
 * `aria-hidden` inside it.
 *
 * A switch and not a check, because what it stands for is independent of everything
 * beside it. Three modes are a radio group — exactly one is true, and a check says *this is
 * the one* — where a one-shot can be on beside any of them, and a check borrowed from the
 * group above would say the wrong thing about it.
 */

import type { ReactNode } from "react"

const Switch = ({ on }: { readonly on: boolean }): ReactNode => (
  <span
    aria-hidden
    className={`relative inline-flex h-4 w-[26px] shrink-0 rounded-pill transition-colors ${
      on ? "bg-accent" : "bg-fg-muted/25"
    }`}
  >
    <span
      className={`absolute top-0.5 size-3 rounded-pill bg-surface transition-[left] ${
        on ? "left-3" : "left-0.5"
      }`}
    />
  </span>
)

export default Switch
