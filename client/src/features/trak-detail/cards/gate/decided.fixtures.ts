/**
 * The decisions a card lists under its document.
 *
 * A second file rather than more exports in `document.fixtures.ts`, to keep each named
 * after the type it supplies — the stem never reaches the panel and matching ignores it
 * entirely, so this is for the reader and nothing else.
 *
 * `DecidedDto` is a small struct the checker can see through, but `readonly DecidedDto[]`
 * is not something it can invent a value for, so the prop blocks without one of these. The
 * catalogue offers each of these singly and all of them together, since an array prop's
 * interesting question is usually how a list of them stacks.
 */

import type { DecidedDto } from "../../../../api/types"
import { makeDecided } from "../../../../fixtures"

export const stated: DecidedDto = makeDecided({
  text: "Branch names are cut to a measure rather than setting one",
  source: "stated",
  kind: "constraint",
})

export const assumed: DecidedDto = makeDecided({
  text: "A union props type is one component with variants, not two components",
  source: "assumed",
  kind: "ruled_out",
})

/** No `kind` at all, which is every entry filed before the four existed. */
export const longAssumption: DecidedDto = makeDecided({
  text: "Props declared in node_modules are inherited rather than authored, so they are left out of the panel entirely — a component spreading ComponentProps<'button'> would otherwise bring roughly 280 of them",
  source: "assumed",
})

/**
 * The one kind the card marks, because it is the one that sends the plan back to the
 * composer. Beside `longAssumption`, which carries none, so the catalogue shows the
 * marker against the case it must not claim as well as the case it must.
 */
export const unplanned: DecidedDto = makeDecided({
  text: "Nothing draws a prop whose value is itself a component, and the panel has no shape for one",
  source: "assumed",
  kind: "unplanned_work",
})

/**
 * One that replaces something already filed — a document by its key and a requirement
 * by its id — so the catalogue shows the trail drawn after the text.
 */
export const superseding: DecidedDto = makeDecided({
  text: "The panel draws a component-valued prop as its display name, folded",
  source: "assumed",
  kind: "constraint",
  supersedes: ["2-build", "1-scope.3"],
})
