// What an engine tool's answer may not carry: every secret value the engine holds. The
// answer reaches an agent, whose transcript is kept and read, and a transcript, a check's
// output or an engine log line can quote a credential another program printed.
//
// Pure: the caller reads the environment and the library, and this decides which of their
// values are secrets and takes them out of a text.

import { PASSPHRASE_ENV } from "./guard.js"

/**
 * Variables every engine holds as secrets, whoever started it. What only a hosted engine
 * holds, its key to the host among them, arrives in `hosted`.
 */
const ENGINE_SECRETS = [PASSPHRASE_ENV, "GH_TOKEN"] as const

/**
 * The shortest value redacted, as the host's own log keeps it. Shorter ones also match
 * ordinary words, and a value that short is not a credential.
 */
const SHORTEST_SECRET = 8

export const REDACTED = "[redacted]"

/** Where the names of the secret variables come from, beside the engine's own. */
export interface SecretSources {
  /** The engine's environment. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** The variables whoever started the engine handed it as secrets — `Environment.secretNames`. */
  readonly hosted: readonly string[]
  /** The CLIs' sign-in variables. */
  readonly credentials: readonly string[]
  /** The runner file's key variable and the variables it copies into the sandbox. */
  readonly runner:
    | { readonly secret: string | undefined; readonly pass: readonly string[] }
    | undefined
  /** The backup file's `secrets:`. */
  readonly backup: readonly string[]
  /** Values handed to a spawn that the environment never held. */
  readonly minted: readonly string[]
}

/** The values to redact: each named variable's, long enough to be one, longest first. */
export const secretValues = (from: SecretSources): readonly string[] => {
  const names = new Set([
    ...ENGINE_SECRETS,
    ...from.hosted,
    ...from.credentials,
    ...(from.runner?.secret === undefined ? [] : [from.runner.secret]),
    ...(from.runner?.pass ?? []),
    ...from.backup,
  ])
  const values = [...names].flatMap((name) => {
    const value = name === "" ? undefined : from.env[name]
    return value !== undefined && value.length >= SHORTEST_SECRET ? [value] : []
  })
  // Longest first, so a value inside another cannot leave the rest of that one showing.
  return [
    ...new Set([...values, ...from.minted.filter((v) => v.length >= SHORTEST_SECRET)]),
  ].toSorted((a, b) => b.length - a.length)
}

/**
 * Each form an answer can carry `value` in: as it is, and JSON-escaped once and twice — an
 * entry is rendered as its JSON, and an event's `envelope` is JSON text inside that JSON.
 * The forms differ only where the value holds a `"`, a `\` or a control character.
 */
const formsOf = (value: string): readonly string[] => {
  const once = JSON.stringify(value).slice(1, -1)
  const twice = JSON.stringify(once).slice(1, -1)
  return [...new Set([twice, once, value])]
}

/**
 * `text` with every form of each value replaced by `[redacted]`, and the values it held,
 * each once whichever form matched. Longest form first, so a form inside another cannot
 * leave the rest of that one showing.
 */
export const redact = (
  text: string,
  values: readonly string[],
): { readonly text: string; readonly found: readonly string[] } => {
  const forms = values
    .flatMap((value) => formsOf(value).map((form) => ({ form, value })))
    .toSorted((a, b) => b.form.length - a.form.length)
  const none: readonly string[] = []
  return forms.reduce(
    (done, { form, value }) =>
      done.text.includes(form)
        ? {
            text: done.text.replaceAll(form, REDACTED),
            found: done.found.includes(value) ? done.found : [...done.found, value],
          }
        : done,
    { text, found: none },
  )
}

/**
 * One answer's redaction, applied to each piece of it before anything shortens the piece —
 * a cut that kept half a secret would leave a half no form matches — and once more to the
 * whole. `found` is how many values it took out across every piece.
 */
export interface Redactor {
  readonly hide: (text: string) => string
  readonly found: () => number
}

export const redactor = (values: readonly string[]): Redactor => {
  const found = new Set<string>()
  return {
    hide: (text) => {
      const hidden = redact(text, values)
      for (const value of hidden.found) found.add(value)
      return hidden.text
    },
    found: () => found.size,
  }
}
