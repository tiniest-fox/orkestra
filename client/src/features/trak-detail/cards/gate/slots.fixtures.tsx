/**
 * What goes in an `actions` slot — the real controls, not a stand-in.
 *
 * `CardShell` takes `actions` as a `ReactNode` and puts it in a row of buttons; its own
 * comment says what goes there is the gate's business. A props type cannot tell that slot
 * apart from a `ReactNode` that is a label, so the catalogue offers a text field unless
 * something better is assignable — and a typed sentence draws a card the app never renders.
 *
 * These are elements rather than components, which is what makes them fixtures at all: a
 * knob needs a value it can name. `.tsx` for the same reason the values are JSX.
 *
 * **They use the real `GatePresses` and its real states.** A pair of invented buttons
 * would look right and would not be the thing — the refusal line, the busy spinner and the
 * disabled press are the states this slot exists to show, and they already exist in
 * `actions.fixtures.ts`.
 */

import GatePresses from "./GatePresses"
import { approval, approvalRefused, approving } from "../../actions.fixtures"

export const approve = <GatePresses approval={approval} />
export const approvePending = <GatePresses approval={approving} />
/** The press that did not land, with its sentence beside it. */
export const approveRefused = <GatePresses approval={approvalRefused} />
