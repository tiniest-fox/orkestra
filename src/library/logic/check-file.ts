// logic: one `.orkestra/checks/*.sh` file -> one Check.
//
// The same four steps as an agent file — split, parse, validate, derive — over a
// comment block instead of a YAML document, because a shell script's first line
// belongs to the kernel.
//
// **One file kind, two lists that name it**, and this parser is blind to which.
// A script under `checks:` reads the repo it runs in, so it is `pnpm check`, a
// grep over `src/`, a test run — the things a step, which runs with write
// permission, actually changed. One under `effects:` runs after that work is
// committed and acts outside the checkout, reading `.orkestra/.trak/` for what to
// send. What `exit 1` means comes from the list, so it is `description:` that has
// to carry it — a reader of the script alone cannot tell *wrong* from *could not
// do it*.

import { Either, Schema } from "effect"
import {
  CACHE_ACROSS,
  type Check,
  CONDITION_MIN_INTERVAL,
  DEFAULT_CHECK_TIMEOUT,
  REACHES,
} from "../types/check.js"
import type { LoadFailed } from "../types/errors.js"
import { decodeOr, invalid, splitCommentFrontmatter } from "./frontmatter.js"

/** The composer writes this name back in a proposal, so it is kebab like the others. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const Frontmatter = Schema.Struct({
  description: Schema.String,
  timeout_seconds: Schema.optional(Schema.Positive),
  // Parsed on any script, and refused where it means nothing — see `Check.askedEverySeconds`.
  asked_every_seconds: Schema.optional(
    Schema.Number.pipe(Schema.greaterThanOrEqualTo(CONDITION_MIN_INTERVAL)),
  ),
  exclusive: Schema.optional(Schema.Boolean),
  cache: Schema.optional(Schema.Boolean),
  ignores_linguist_generated: Schema.optional(Schema.Boolean),
  units: Schema.optional(Schema.NonEmptyTrimmedString),
  cache_across: Schema.optional(Schema.Literal(...CACHE_ACROSS)),
  fingerprint: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
  // Parsed on any script, and refused where it means nothing — see `Check.reaches`.
  reaches: Schema.optional(Schema.Literal(...REACHES)),
})

const ALLOWED: readonly string[] = [
  "description",
  "timeout_seconds",
  "asked_every_seconds",
  "exclusive",
  "cache",
  "ignores_linguist_generated",
  "units",
  "cache_across",
  "fingerprint",
  "reaches",
]

const REJECTED: Record<string, string> = {
  model:
    "a check is a shell script, not a turn. Nothing here talks to an agent, so there is no model to pick.",
  disallowed_tools:
    "a check is a shell script and runs whatever it likes. Tool restrictions are an agent's `permission:`, which narrows what an AGENT may do.",
  expect_failure:
    "the runtime contract is always `exit 0 = pass`. A check that means to assert a failure inverts it in its own exit logic, where the inversion is visible to whoever reads the script.",
  assumes:
    "which assumptions a print may lean on is the machine's to say, not a check's: an engine accepts every one a print names, and one with `CI` set accepts none. Drop `assumes:`.",
}

/**
 * `name` comes from the filename, so it is the one field the file cannot lie
 * about. `shown` is where the file actually is, because the same parser reads
 * `worktrees/setup.sh` — one script kind, one set of rules, and an error that
 * names the file the reader has open.
 */
export const parseCheck = (
  shown: string,
  name: string,
  path: string,
  text: string,
): Either.Either<Check, LoadFailed> =>
  Either.gen(function* () {
    if (!KEBAB.test(name)) {
      return yield* invalid<never>(
        shown,
        `\`${name}\` cannot be a check name — a proposal references a check by its filename, so use lowercase-kebab (no-secrets.sh).`,
      )
    }

    const split = yield* splitCommentFrontmatter(shown, text, ALLOWED, REJECTED)
    const fields = yield* decodeOr(
      shown,
      Frontmatter,
      split.fields,
      `frontmatter needs \`description:\`; \`timeout_seconds:\` must be a positive number if present, \`asked_every_seconds:\` at least ${String(CONDITION_MIN_INTERVAL)}, \`exclusive:\`, \`cache:\` and \`ignores_linguist_generated:\` true or false, \`units:\` a label, \`cache_across:\` \`platform\` or \`os\`, \`fingerprint:\` a list of tool names, and \`reaches:\` \`${REACHES.join("` or `")}\`.`,
    )
    if (fields.fingerprint !== undefined && fields.units === undefined) {
      return yield* invalid<never>(
        shown,
        "`fingerprint:` without `units:` — a recording is kept per unit, and a check with no label reports none. Add `units:`, or drop `fingerprint:`.",
      )
    }
    if (split.body === "") {
      return yield* invalid<never>(
        shown,
        "no script after the frontmatter — a check that runs nothing verifies nothing, and would pass every time.",
      )
    }

    return {
      name,
      // Trimmed for the reason an agent's description is: a folded scalar ends with a
      // newline, which would put a blank line between every entry of the index.
      description: fields.description.trim(),
      timeoutSeconds: fields.timeout_seconds ?? DEFAULT_CHECK_TIMEOUT,
      askedEverySeconds: fields.asked_every_seconds,
      exclusive: fields.exclusive ?? false,
      cache: fields.cache ?? true,
      ignoresLinguistGenerated: fields.ignores_linguist_generated ?? false,
      units: fields.units,
      cacheAcross: fields.cache_across ?? "platform",
      ...(fields.fingerprint === undefined ? {} : { fingerprint: fields.fingerprint }),
      ...(fields.reaches === undefined ? {} : { reaches: fields.reaches }),
      path,
    }
  })
