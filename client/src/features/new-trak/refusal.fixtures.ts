/**
 * Why the engine would not take a request, for the atelier catalogue.
 *
 * `RefusalDto` is a tagged union and `RefusalNotice` draws a sentence per member, so one
 * value would show one member's worth of the component. Every tag is here for that
 * reason and not for completeness — the sentences live in `format/refusal.ts` and this is
 * what makes each of them visible.
 */

import type { RefusalDto } from "../../api/types"

export const notParked: RefusalDto = { _tag: "NotParked" }
export const notFinished: RefusalDto = { _tag: "NotFinished" }
export const driving: RefusalDto = { _tag: "Driving" }
export const atRest: RefusalDto = { _tag: "AtRest" }
export const notAtRest: RefusalDto = { _tag: "NotAtRest" }
export const notWaiting: RefusalDto = { _tag: "NotWaiting" }
