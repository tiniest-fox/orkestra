// logic: the rules a composer's drafted goal is checked by, as the text of a goal file.
//
// The agent file's format — YAML frontmatter, then a body — so a draft is held to the same
// rules a person writing frontmatter would be. Nothing writes the text to disk: an approved
// draft lives on the goal's log as its spec.

import { Either, Schema } from "effect"
import type { LoadFailed } from "../types/errors.js"
import { GOAL_AUTO_MERGES, GOAL_MODES, type GoalAutoMerge, type GoalFile } from "../types/goal.js"
import { decodeOr, invalid, splitFrontmatter } from "./frontmatter.js"

/** A goal's name is kebab, like every other `.orkestra` name. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const Limit = Schema.Int.pipe(Schema.positive())

/**
 * What a goal branch may be called before git is asked: no whitespace, no leading `-` or
 * `/`, no `..`. Git's own rules are checked when the goal starts, against the repository.
 */
const BRANCH = /^(?![-/])(?!.*\.\.)[^\s~^:?*[\\]+$/

const Frontmatter = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  line: Schema.NonEmptyTrimmedString,
  parallel: Schema.optional(Limit),
  traks_per_hour: Schema.optional(Limit),
  traks_per_day: Schema.optional(Limit),
  modes: Schema.optional(Schema.NonEmptyArray(Schema.Literal(...GOAL_MODES))),
  // `true` and `false` are the older spelling, from when the key was a switch.
  auto_merge: Schema.optional(Schema.Union(Schema.Literal(...GOAL_AUTO_MERGES), Schema.Boolean)),
  branch: Schema.optional(Schema.NonEmptyTrimmedString.pipe(Schema.pattern(BRANCH))),
})

/**
 * The older `auto_merge:` spelling read as it was meant: `false` refused a trak merging
 * itself, which is `never`, and `true` allowed it, which is the composer deciding.
 */
const autoMergeOf = (written: GoalAutoMerge | boolean | undefined): GoalAutoMerge | undefined =>
  written === false ? "never" : written === true ? undefined : written

const ALLOWED: readonly string[] = [
  "title",
  "line",
  "parallel",
  "traks_per_hour",
  "traks_per_day",
  "modes",
  "auto_merge",
  "branch",
]

const REJECTED: Record<string, string> = {
  model:
    "the goal's composer runs on `models.yaml`'s `default:`, as a trak's composer does. A goal names the work, not who does it.",
  description:
    "the body is the description: write the finished state below the closing `---`, and the one line a list shows as `line:`.",
}

const isGoalName = (name: string): boolean => KEBAB.test(name)

export const parseGoal = (
  shown: string,
  name: string,
  text: string,
): Either.Either<GoalFile, LoadFailed> =>
  Either.gen(function* () {
    if (!isGoalName(name)) {
      return yield* invalid<never>(
        shown,
        `\`${name}\` cannot be a goal name — use lowercase-kebab (ship-goals).`,
      )
    }
    const split = yield* splitFrontmatter(shown, text, ALLOWED, REJECTED)
    const fields = yield* decodeOr(
      shown,
      Frontmatter,
      split.fields,
      `frontmatter needs \`title:\` and \`line:\`; \`parallel:\`, \`traks_per_hour:\` and \`traks_per_day:\` must be positive whole numbers if present, \`modes:\` a list of ${GOAL_MODES.join(", ")}, \`auto_merge:\` never or always, and \`branch:\` a branch name.`,
    )
    if (split.body === "") {
      return yield* invalid<never>(
        shown,
        "no body after the frontmatter — the body says what the world looks like once the goal is over, and a goal without one can never be done.",
      )
    }
    const autoMerge = autoMergeOf(fields.auto_merge)
    return {
      name,
      title: fields.title,
      line: fields.line,
      finished: split.body,
      limits: {
        ...(fields.parallel === undefined ? {} : { parallel: fields.parallel }),
        ...(fields.traks_per_hour === undefined ? {} : { perHour: fields.traks_per_hour }),
        ...(fields.traks_per_day === undefined ? {} : { perDay: fields.traks_per_day }),
        ...(fields.modes === undefined ? {} : { modes: fields.modes }),
        ...(autoMerge === undefined ? {} : { autoMerge }),
      },
      ...(fields.branch === undefined ? {} : { branch: fields.branch }),
    }
  })

/**
 * The goal as file text, as `parseGoal` reads it back — what `goalDraftRefusal` checks.
 * A key appears only where the goal sets it, so the text reads as a person would write it.
 */
export const goalFileText = (goal: GoalFile): string => {
  const { limits } = goal
  const keys = [
    `title: ${JSON.stringify(goal.title)}`,
    `line: ${JSON.stringify(goal.line)}`,
    ...(limits.parallel === undefined ? [] : [`parallel: ${String(limits.parallel)}`]),
    ...(limits.perHour === undefined ? [] : [`traks_per_hour: ${String(limits.perHour)}`]),
    ...(limits.perDay === undefined ? [] : [`traks_per_day: ${String(limits.perDay)}`]),
    ...(limits.modes === undefined ? [] : [`modes: [${limits.modes.join(", ")}]`]),
    ...(limits.autoMerge === undefined ? [] : [`auto_merge: ${limits.autoMerge}`]),
    ...(goal.branch === undefined ? [] : [`branch: ${JSON.stringify(goal.branch)}`]),
  ]
  return ["---", ...keys, "---", "", goal.finished.trim(), ""].join("\n")
}

/**
 * A drafted goal, checked by the rules a goal file is: its text read back by
 * `parseGoal`. The reason it would be refused, or `undefined` where it reads as it is.
 */
export const goalDraftRefusal = (goal: GoalFile): string | undefined =>
  Either.match(parseGoal(`goals/${goal.name}.md`, goal.name, goalFileText(goal)), {
    onLeft: (e) => e.reason,
    onRight: () => undefined,
  })
