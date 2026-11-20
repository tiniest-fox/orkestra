/**
 * The passphrase, asked for where the list would be.
 *
 * **The login is a state of the list, not a place of its own.** The bar above it is the
 * gate's, drawn with its slot empty; this is the region the list would fill, as the
 * system's own `EmptyState`: ghost rows, a band saying why there is nothing here, and the
 * form in the band's action slot. A 401 is drawn the way an empty list or an unreachable
 * engine is drawn — the same `<main>` the list page puts its own `EmptyState` in — so the
 * page a person logs in on is the page they get.
 *
 * **A refusal hangs off the field.** A wash of the failure tone attached to the field's
 * bottom edge — the field squares its corners into it — carrying an arrow tile pointing
 * back at the field and the one sentence. It drops out from behind the field, which is
 * the reason it is attached rather than under: a thing hanging off an edge has somewhere
 * to come out from. The field's own edge turns with it. This is the one shape here the
 * system had not drawn before; it is drawn once, here, until a second control wants it.
 *
 * **The engine being unreachable is the band's, not the field's.** It is not about what
 * was typed, so the band takes the failure tone and the list's own *Could not reach the
 * engine* title, exactly as the list draws it, and the field says nothing.
 *
 * **The field is an `<input type="password">`, the one control here the system has no
 * primitive for.** `Field` is a `textarea` that grows with what is in it and shows it,
 * which is the opposite of what a passphrase wants. It borrows `Field`'s treatment whole
 * — an edge, the control radius, the same inset and focus ring.
 *
 * Presentational: what was typed is its own, everything else arrives as props.
 */

import type { FormEvent, ReactNode } from "react"
import { useState } from "react"
import { ArrowUp, Lock, Unplug } from "lucide-react"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"
import Plate from "../../components/Plate"
import type { LoginProblem } from "./useLogin"

const REFUSED = "That is not the passphrase."

const INPUT = [
  "block w-full cursor-text rounded-control border bg-surface",
  // The touch floor, as `Button` takes it: a minimum, not a size, and 0 change at desk.
  "max-sm:min-h-11",
  "px-4 py-2 text-base text-fg placeholder:text-fg-subtle",
  "focus-visible:outline-2 focus-visible:outline-offset-0",
  "disabled:cursor-not-allowed disabled:opacity-45",
].join(" ")

/**
 * The strip, hung off the field. `z-0` under the field's `z-10`, so the drop starts
 * hidden behind it; `motion-safe`, because the whole point of the motion is that the
 * strip *arrives*, and a person who asked for no motion should simply find it there.
 */
const Refused = (): ReactNode => (
  <div
    role="alert"
    className="relative z-0 flex items-center gap-2 rounded-b-control bg-tone-bad-bg px-3 py-1.5 text-tone-bad motion-safe:animate-drop"
  >
    <Plate tone="bad" size="tile">
      <ArrowUp size={8} aria-hidden />
    </Plate>
    <span className="text-sm font-medium">{REFUSED}</span>
  </div>
)

const LoginView = ({
  onSubmit,
  busy,
  disabled,
  problem,
}: {
  readonly onSubmit: (passphrase: string) => void
  readonly busy: boolean
  readonly disabled: boolean
  /** What the last attempt met, or nothing. */
  readonly problem: LoginProblem | undefined
}): ReactNode => {
  const [passphrase, setPassphrase] = useState("")
  const ready = !disabled && passphrase !== ""
  const refused = problem?.kind === "refused"
  const unreachable = problem?.kind === "unreachable"

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (ready) onSubmit(passphrase)
  }

  return (
    <main className="flex flex-col">
      <EmptyState
        shape="rows"
        tone={unreachable ? "bad" : undefined}
        icon={unreachable ? Unplug : Lock}
        title={unreachable ? "Could not reach the engine" : "Behind a passphrase"}
        action={
          <form
            onSubmit={submit}
            className="flex flex-col gap-3"
            // `EmptyState`'s action slot is `items-start` in a column, so a percentage
            // width resolves against nothing — the form says its width outright, and
            // gives it up to the band on a phone. 400 is the value the round settled on.
            style={{ width: 400, maxWidth: "calc(100vw - 7rem)" }}
          >
            <span className="relative block w-full">
              <span className="relative z-10 block">
                <input
                  id="passphrase"
                  type="password"
                  aria-label="Passphrase"
                  aria-invalid={refused}
                  autoComplete="current-password"
                  autoFocus
                  value={passphrase}
                  disabled={disabled}
                  onChange={(event) => {
                    setPassphrase(event.target.value)
                  }}
                  className={[
                    INPUT,
                    refused
                      ? "rounded-b-none border-tone-bad focus-visible:outline-tone-bad"
                      : "border-border focus-visible:outline-accent",
                  ].join(" ")}
                />
              </span>
              {refused && <Refused />}
            </span>
            <Button type="submit" variant="primary" size="md" block busy={busy} disabled={!ready}>
              Sign in
            </Button>
          </form>
        }
      >
        {unreachable ? problem.message : "Enter the passphrase the engine was started with."}
      </EmptyState>
    </main>
  )
}

export default LoginView
