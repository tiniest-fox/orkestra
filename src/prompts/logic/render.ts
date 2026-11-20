// logic: fill a template's holes. Pure — no Effect, no filesystem.

import Mustache from "mustache"
import type { TemplateName, Templates } from "../types/template.js"

/**
 * Mustache HTML-escapes `{{x}}` by default, which would turn a quote in a trak
 * description into `&quot;` and a generic in a code sample into `&lt;T&gt;`. We
 * are rendering prompts, not web pages, so escaping is disabled per-call rather
 * than by mutating `Mustache.escape` globally — and templates can then use plain
 * `{{name}}` instead of `{{{name}}}` everywhere.
 */
const NO_ESCAPE = { escape: (value: unknown): string => String(value) }

/**
 * A missing template is a programmer error, not a runtime condition: the name
 * set is a closed union and the loader validates every name at startup, so by
 * the time anything renders, absence is unreachable. Returning an obvious marker
 * beats throwing from a pure function or widening every caller to an error type.
 */
export const render = (
  templates: Templates,
  name: TemplateName,
  data: Readonly<Record<string, unknown>>,
): string => {
  const template = templates.get(name)
  if (template === undefined) return `[missing template: ${name}]`
  // Every template is available to every other as a partial, so shared text —
  // the output contract above all — is written down once and included by name.
  const partials = Object.fromEntries(templates)
  return Mustache.render(template, data, partials, NO_ESCAPE).trim()
}

/**
 * Fill a template that is text rather than a name — an agent's brief, which arrives
 * from the library rather than from `templates/`. No partials: a brief may use none,
 * and the library refuses one that tries.
 */
export const renderText = (template: string, data: Readonly<Record<string, unknown>>): string =>
  Mustache.render(template, data, {}, NO_ESCAPE).trim()
