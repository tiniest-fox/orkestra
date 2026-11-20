// Pure prompt assembly. Every word sent to an agent lives in
// src/prompts/templates/*.md; this file only decides what data fills the holes.
//
// Templates arrive as data, exactly like an agent's brief does — which is what
// keeps this file pure and the domain free of a filesystem dependency.

import { attachedView } from "./attachment.js"
import { Match } from "effect"
import { render, renderText, type TemplateName, type Templates } from "../../prompts/index.js"
import type { StandingBrief } from "../../agent/types/session.js"
import {
  type Agent,
  type BriefFlag,
  FIGURES,
  type Figure,
  type OutputSection,
  type Skill,
} from "../../library/types/agent.js"
import type { Check } from "../../library/types/check.js"
import { stripAnsi } from "./check-progress.js"
import { artifactText } from "./outputs/artifact.js"
import { decisionsText, identified, type Recorded } from "./outputs/decided.js"
import { artifactPath, inheritedKey, inheritedPath, visibleArtifacts } from "./projection.js"
import {
  type AgentStep,
  artifactKey,
  childKey,
  type Compose,
  inPiece,
  isCompose,
  isSpawn,
  type ReconsultWhy,
  type Step,
} from "./outputs/proposal.js"
import { firstUnrun, slotAt, splitWithSiblings, type StoppedTask, type Trak } from "./trak.js"
import type { Trigger } from "./trigger.js"
import { spellLocal } from "./wait-until.js"

/**
 * Answers are positional — the number is the only thing that maps one back to
 * the question it answers — and Mustache iterates arrays, not tuples of two.
 */
const numbered = (answers: readonly string[]) => answers.map((text, i) => ({ number: i + 1, text }))

/**
 * An unattended turn's picks, numbered as answers are. `taken` is the section's guard
 * and `label` its value, so a pick with no recommendation renders the other line
 * rather than an empty one.
 */
const picked = (picks: readonly { readonly recommended?: string | undefined }[]) =>
  picks.map((p, i) => ({ number: i + 1, taken: p.recommended !== undefined, label: p.recommended }))

/**
 * The thought a person sent alongside their answers, which answers no question.
 *
 * Absent renders nothing at all, so a turn with no note is the same bytes as one
 * sent before the field existed. `hasNote` is what the template's section reads;
 * `{{#note}}` alone would do the same — Mustache falls back to the parent frame for
 * a lookup inside a section over a string, which is how `step.md` renders
 * `skipMessage` — so the flag buys separating the guard from the value and nothing
 * more.
 */
const noteView = (note: string | undefined) => ({ hasNote: note !== undefined, note })

/**
 * A body with the background work this session's last filing stopped named after it.
 *
 * **After every body there is, the full ones included**: the notice is owed to a
 * session rather than to a trigger, and a session is resumed by all of them — a step
 * that borrows a conversation is sent `step.md`. After rather than before, so a
 * person's message still opens the prompt it is sent in.
 *
 * With nothing stopped the body is returned as it came, byte for byte.
 */
const withStopped = (
  templates: Templates,
  body: string,
  stopped: readonly StoppedTask[],
): string =>
  stopped.length === 0
    ? body
    : `${body.trimEnd()}\n\n${render(templates, "stopped-tasks", {
        stopped: stopped.map((task) => ({ name: task.description ?? task.id })),
      })}`

/**
 * The documents this trak was born holding, as paths. Empty for anything but a
 * child, which renders as nothing.
 *
 * A list of its own rather than entries in the plan, because they are not entries
 * in this trak's plan: nothing here will ever run at those positions, and a step
 * looking up the list has to be able to tell work that was done elsewhere from
 * work that is coming.
 *
 * **Named by `inheritedKey`, not the parent's bare key.** The contract tells the
 * agent a `supersedes` names a document as this list lists it, and `supersedable`
 * is what holds it to that — so the name shown, the path shown and the key
 * accepted have to be one string. Shown bare, the key is usually refused, and
 * where the child's own plan files under the same key it is accepted and the note
 * lands on the child's document instead.
 */
const inheritedView = (trak: Trak) => ({
  hasInherited: trak.inherited.length > 0,
  inherited: trak.inherited.map(([name]) => ({
    name: inheritedKey(name),
    path: inheritedPath(name),
  })),
})

/**
 * Whether this trak is one piece of a split that has other pieces in it.
 *
 * A flag and no data: who the pieces are is in `trak.md`, which every turn opens,
 * and what the template adds is the rule about them — that a gap belonging to
 * another piece is not work this plan is missing. Naming them twice would put the
 * roster in two places to keep in step.
 *
 * **Deliberately not `hasInherited`**, which is true of every child: a spawn of one
 * inherits documents and has nobody beside it.
 */
const splitView = (trak: Trak) => ({ hasSiblings: splitWithSiblings(trak) !== undefined })

/**
 * Whether this trak was spawned by another, which is what the templates' rule about
 * where its branch goes is guarded on.
 *
 * A flag of its own, because neither of the two above means it. `hasSiblings` is
 * false for a spawn of one; `hasInherited` is false for a child spawned at a
 * position with no visible documents above it. A child's composer guarded on either
 * was told it was *a piece of something larger* and never that it was a child — so
 * it applied the default that a plan changing tracked files ends in a pull request,
 * and the exception the team conventions write for a child, in words its prompt
 * never used, went unrecognised.
 */
const parentView = (trak: Trak) => ({ hasParent: trak.parent !== undefined })

/**
 * The one artifact still injected: the step immediately before this one.
 *
 * Everything older is a path in the plan above. This one is not, on a narrower
 * argument than "read what you need": a sequential pipeline's handoff is the
 * document a step almost always needs, so making the common case a tool call
 * buys nothing.
 *
 * **A child with nothing filed before this point falls back to the last document
 * it inherited**, which is the same argument one level up: the parent's last
 * artifact is what the spawn was decided from, and it is the handoff whether or
 * not a plan boundary sits in the middle of it. Its own work wins as soon as it
 * has any, so this is the first step of most children and the whole of the ones
 * whose earlier steps filed nothing.
 *
 * An inherited one is named as the list above names it, for `inheritedView`'s
 * reason: the heading is the name an agent copies into a `supersedes` against the
 * handoff.
 */
const precedingView = (trak: Trak, index: number) => {
  const own = visibleArtifacts(trak, index).at(-1)
  const inherited = trak.inherited.at(-1)
  const last =
    own ?? (inherited === undefined ? undefined : [inheritedKey(inherited[0]), inherited[1]])
  return last === undefined
    ? { hasPreceding: false }
    : // Rendered here, at the point of display. The trak holds the Document.
      { hasPreceding: true, precedingName: last[0], precedingText: artifactText(last[1]) }
}

/**
 * What the session's system prompt needs beyond the shared core: which role is
 * being spawned, and — for a step — everything its output contract has to state.
 *
 * Constant for the life of a session. There is one session per step, so the
 * sections its declared shape requires are fixed the moment the step is spawned;
 * the composer's contract is fixed outright. That is the whole argument for
 * stating them here instead of at the end of every prompt body, where a resume
 * prompt was mostly contract.
 *
 * Neither shape a step may return names a destination, so its contract depends on
 * nothing but its own agent — there are no other steps' names to carry.
 */
export type SystemContext =
  | {
      readonly role: "step"
      /** The sections this step's agent declares. Never empty. */
      readonly sections: readonly OutputSection[]
      /**
       * Whether the artifact is owed on the first turn. A property of the plan
       * entry, so it is fixed for the life of the session — which is what allows
       * it here at all. A flag that could change between a step's turns would be
       * the `chatting` boolean `system/contract.md` records the deletion of.
       */
      readonly conversational: boolean
      /** The repository skills the agent names — its own, so fixed for the session too. */
      readonly skills: readonly Skill[]
    }
  | { readonly role: "composer" }

/**
 * The rules that hold for every turn of a session, in the two parts a provider may
 * deliver separately — see `StandingBrief`.
 *
 * `system.md` is the shared core — a composer narrating is exactly as expensive
 * as a step narrating — and the contract is the role's own, chosen here as one of
 * two templates rather than one template with an `isStep` flag inside it: a body
 * selected by a boolean is the pattern that gave every trigger its own file.
 *
 * A third role would fail to compile in the `else` branch rather than silently
 * getting the step's contract.
 */
export const buildSystemPrompt = (templates: Templates, ctx: SystemContext): StandingBrief => ({
  core: render(templates, "system", {}),
  contract:
    ctx.role === "composer"
      ? render(templates, "system/composer", {})
      : render(templates, "system/step", {
          ...shapeView(templates, ctx.sections),
          conversational: ctx.conversational,
          hasSkills: ctx.skills.length > 0,
          skills: ctx.skills,
        }),
})

export interface PromptContext {
  readonly trak: Trak
  /**
   * The entry being run — an agent turn, never a spawn: `enterStep` routes a
   * spawn position to `SpawnChildren`, which produces no prompt at all.
   */
  readonly step: AgentStep
  /** The definition the step names — its brief, its permission, its sections. */
  readonly agent: Agent
  readonly trigger: Trigger
  /** Project policy from `.orkestra/ORKESTRA.md`; "" when there is none. */
  readonly guidance: string
  /**
   * Where `step` sits in the proposal. Passed rather than derived, because `Step`
   * carries no index and finding one by artifact name would be a guess when two
   * steps share a name.
   *
   * One thing needs it: the sequence, so a step can see where it is. Anything
   * constant for the whole session belongs on `SystemContext` instead.
   */
  readonly index: number
  /**
   * The checks that will run on this step's artifact, if any.
   *
   * Told up front rather than only on failure, because the cheapest place to
   * catch one is before the turn ends: an agent that knows `pnpm verify` is
   * about to run can run it itself and fix what it finds, instead of costing a
   * whole extra iteration to be told.
   */
  readonly checks: readonly Check[]
  /**
   * The checks the engine's `run_check` tool takes this turn — the session was handed
   * the server — and empty where it was handed none.
   */
  readonly checkTool: readonly string[]
  /**
   * The hosted processes this turn is told about: every one the agent lists, which the
   * engine has just tried to start, and any other already running at the trak.
   */
  readonly processes: readonly TurnProcess[]
  /** Whether the session was handed the engine's process tools. */
  readonly processTools: boolean
  /** `stoppedOn` for the session this prompt resumes. */
  readonly stopped: readonly StoppedTask[]
}

/** A hosted process as it stood when the turn began. */
export interface TurnProcess {
  readonly name: string
  readonly description: string
  /** Where it answers; absent when it is not up. */
  readonly url: string | undefined
  /** Why it is not up; absent when it is. The sentence for each is `step.md`'s. */
  readonly notUp:
    | "didNotComeUp"
    | "exited"
    | "stopped"
    | "stoppedByRestart"
    | "notStarted"
    | undefined
  /** What a start that did not come up gave as its reason. */
  readonly reason: string | undefined
  /** The code a process that exited ended with, where it ended with one. */
  readonly exitCode: number | undefined
  /** The environment variable holding `url` for the turn. */
  readonly variable: string
}

/**
 * The declared sections, as the prompt states them and the schema enforces them.
 *
 * There is no `hasShape` flag beside them: every agent declares an output, so the
 * list is never empty and the contract has one artifact shape to describe.
 */
const shapeView = (templates: Templates, sections: readonly OutputSection[]) => ({
  shapeSections: sections.map((s) => ({
    title: s.title,
    description: s.description,
    when: s.when,
    figure: s.figure,
  })),
  figures: FIGURES.filter((f) => f === "table" || sections.some((s) => s.figure === f)).map(
    (f) => ({ grammar: render(templates, GRAMMAR[f], {}) }),
  ),
})

/**
 * Each figure's grammar template. A record rather than a name built from a string, so a
 * figure added to `FIGURES` without a grammar fails to compile.
 */
const GRAMMAR: Record<Figure, TemplateName> = {
  decision: "system/figure-decision",
  scope: "system/figure-scope",
  criteria: "system/figure-criteria",
  files: "system/figure-files",
  table: "system/figure-table",
  overview: "system/figure-overview",
  walkthrough: "system/figure-walkthrough",
  changes: "system/figure-changes",
  runs: "system/figure-runs",
}

/**
 * The requirements recorded so far, for the block that carries the request and
 * them together. `hasRequirements` guards the lead-in that dates the request as
 * well as the list itself — with nothing recorded since, there is nothing to date
 * it against.
 *
 * On a fresh session only — the resume bodies deliberately do not carry it, and
 * cannot go stale for want of it. `templates/intent.md` says why.
 */
const intentView = (decisions: readonly Recorded[]) => ({
  hasRequirements: decisions.length > 0,
  requirements: decisionsText(identified(decisions)),
})

/** The servers this turn can reach, and how it can manage them. */
const processView = (processes: readonly TurnProcess[], tools: boolean) => ({
  hasProcesses: processes.length > 0,
  processes: processes.map((p) => ({
    ...p,
    down: p.notUp !== undefined,
    didNotComeUp: p.notUp === "didNotComeUp",
    exited: p.notUp === "exited",
    // A string, so a code of 0 still renders: Mustache skips a section on `0`.
    exitCode: p.exitCode === undefined ? undefined : String(p.exitCode),
    stopped: p.notUp === "stopped",
    stoppedByRestart: p.notUp === "stoppedByRestart",
    notStarted: p.notUp === "notStarted",
  })),
  processTools: tools,
})

/**
 * What has to pass before a human is asked to look at this step's artifact, and what
 * the tool will run — two lists, because the tool takes every check that keeps a pass
 * and only the first is what judges this step. A step with no check of its own is
 * still told the tool is there, and told that nothing runs after it.
 */
const checkView = (checks: readonly Check[], tool: readonly string[]) => ({
  checkSection: checks.length > 0 || tool.length > 0,
  hasChecks: checks.length > 0,
  checks: checks.map((c) => ({ name: c.name, description: c.description })),
  hasCheckTool: tool.length > 0,
  checkTool: tool.map((n) => `\`${n}\``).join(", "),
  // Only where one of this step's checks is left out of the tool, so the line is not
  // said for nothing.
  untooled: tool.length > 0 && checks.some((c) => !tool.includes(c.name)),
})

/**
 * The sequence, with this step marked and a path against every entry that has
 * produced something.
 *
 * One list where there were two. The plan and *artifacts so far* were always the
 * same sequence twice — the second one carrying whole documents, so a five-step
 * plan meant the last step paid for four it mostly did not need. The documents
 * are files in the worktree now (see `projection.ts`), and what is left of the
 * second list is a path.
 */
const planView = (trak: Trak, index: number) => {
  // **Compose entries are dropped here, and this is the only place that decides it.**
  // The plan holds them because it is the record of what happened; an agent is being
  // shown the work, and a row saying the composer ran is noise in a list whose job is
  // to say what has been produced and what is coming. Indices are kept, because they
  // are the artifact keys: filtering the display must not renumber anything.
  const steps = (trak.plan?.steps ?? [])
    .map((s, i) => [s, i] as const)
    .filter(([s]) => !isCompose(s))
  const visible = visibleArtifacts(trak, index).map(([name]) => name)
  const filed = new Set(visible)
  const at = (name: string) => (filed.has(name) ? artifactPath(name) : undefined)
  return {
    hasPlan: steps.length > 0,
    plan: steps.map(([s, i]) => {
      const name = artifactKey(s, i)
      return {
        name,
        here: i === index,
        // Absent for a step that has not run, and for this one — its artifact is
        // what the turn is for. Mustache renders an absent key as nothing.
        path: at(name),
        // Said, because the alternative reads wrong rather than reading as
        // nothing: a skipped step has no path, and so does one that has not run
        // yet. An agent looking up the list has to be able to tell "nobody is
        // going to produce that" from "not yet".
        skipped: slotAt(trak, i).skipped,
        // A spawn is N pieces rather than one document, and a step after it that
        // saw only `3-spawn` would have no way to reach any of them. Each piece
        // lists every document it filed, under the piece's name — a piece that has
        // not landed lists none. Absent for an agent step, which Mustache renders
        // as nothing.
        children: isSpawn(s)
          ? s.children.map((c, j) => {
              const piece = childKey(i, j, c)
              return {
                name: piece,
                documents: visible
                  .filter((key) => inPiece(piece, key))
                  .map((key) => ({ name: key, path: artifactPath(key) })),
              }
            })
          : undefined,
      }
    }),
  }
}

/**
 * What a human said when they skipped the step before this one.
 *
 * The *step before this one* rather than every skip in the plan, because this is
 * an instruction and instructions are for the turn they are given to. Older skips
 * are in the plan list above, marked.
 *
 * It renders under the composer's instruction rather than in a channel of its
 * own: what a human types when they wave a step through is the same kind of thing
 * as what the composer wrote about the step that follows it, and a second hole
 * would be a second place to look.
 */
const skipView = (trak: Trak, index: number) => {
  const before = index - 1
  const slot = slotAt(trak, before)
  if (!slot.skipped) return { afterSkip: false }
  const step = trak.plan?.steps[before]
  return {
    afterSkip: true,
    skippedName: step === undefined ? `step ${before}` : artifactKey(step, before),
    skipMessage: slot.skipNote,
  }
}

/**
 * The condition a person skipped the wait on to start this step, where they did.
 *
 * Under the instruction, beside what a skipped step's person said and for the same
 * reason: it is a fact about how this turn came to run, and the one thing a forced
 * step must not do is take what it was waiting for as having happened.
 */
const skippedWaitView = (trak: Trak, index: number) => ({
  skippedWait: slotAt(trak, index).skippedWait,
})

/**
 * The flags an agent's brief is rendered with. See `BRIEF_FLAGS`.
 *
 * `opening` is the entry a trak was opened with. Index 0 alone says it, because a
 * composed trak's index 0 is always the compose entry, which never reaches here — save
 * on a spawned child, which is born holding its piece of the parent's plan and is no
 * more a chat than the parent's step that spawned it.
 */
const briefFlags = (trak: Trak, index: number): Record<BriefFlag, boolean> => ({
  opening: index === 0 && trak.parent === undefined,
})

/**
 * One template per `Trigger`, chosen by one exhaustive `Match`.
 *
 * Which body a turn gets and which data that body needs are decided in the same
 * arm, so they cannot drift — and a new trigger fails to compile here rather
 * than falling through to the full prompt and being rendered with words nobody
 * chose for it. A negative condition listing the resume triggers, kept in step
 * with a view function by hand, is the shape that lets one slip through.
 *
 * A fresh session gets the full prompt, carrying the step's own instruction —
 * which the composer wrote, including for a step a later plan put there. That is
 * why `Reconsulted` needs no step template: what a re-planned step runs on is an
 * ordinary first turn of a new plan entry.
 */
export const buildStepPrompt = (templates: Templates, ctx: PromptContext): string => {
  const full = (): string =>
    render(templates, "step", {
      description: ctx.trak.description,
      guidance: ctx.guidance,
      // One brief where several technique bodies were concatenated. The rule that
      // told an agent how to reconcile them is deleted with them: there is nothing
      // left to merge, so the failure mode it guarded is unrepresentable.
      brief: renderText(ctx.agent.brief, briefFlags(ctx.trak, ctx.index)),
      readOnly: ctx.agent.permission === "read-only",
      artifactName: artifactKey(ctx.step, ctx.index),
      instruction: ctx.step.instruction,
      ...intentView(ctx.trak.decisions),
      ...attachedView(ctx.trak.attachments),
      ...precedingView(ctx.trak, ctx.index),
      ...parentView(ctx.trak),
      ...inheritedView(ctx.trak),
      ...splitView(ctx.trak),
      ...planView(ctx.trak, ctx.index),
      ...skipView(ctx.trak, ctx.index),
      ...skippedWaitView(ctx.trak, ctx.index),
      ...checkView(ctx.checks, ctx.checkTool),
      ...processView(ctx.processes, ctx.processTools),
    })
  // No resume body carries a view of the contract any more. Each one is only what
  // is new — the message, the answers, the check's output, or the word "continue"
  // — because the shapes, the sections and the routable stages are already on the
  // session and hold for every turn of it.
  const body = Match.value(ctx.trigger).pipe(
    Match.tag("Initial", full),
    // Never reaches a step: `decide` builds `Compose` with it, and a step runs
    // because a plan named it rather than because it was told to run again. The arm
    // is what makes the `Match.exhaustive` below a compile error the day that
    // changes, and it renders the full prompt because a fresh session is what a
    // `Reconsulted` turn is by definition.
    Match.tag("Reconsulted", full),
    // No `chatting` flag: what tells a step that a person is waiting is that this
    // body is nothing but their words, which the contract on the session names as
    // the signal. A flag that flipped the contract's wording per turn could not
    // survive the contract being stated once.
    Match.tag("Message", (t) =>
      render(templates, "step-message", {
        message: t.text,
        ...attachedView(t.attachments ?? []),
      }),
    ),
    Match.tag("Answers", (t) =>
      render(templates, "step-answers", { answers: numbered(t.answers), ...noteView(t.note) }),
    ),
    // What was asked is already in the session this resumes, so the picks come back
    // by number alone, as answers do.
    Match.tag("Unanswered", (t) =>
      render(templates, "step-unanswered", { picks: picked(t.picks) }),
    ),
    // Its twin, one output along, with no data at all: what was said is in the
    // session, and what is new is one sentence that is the same every time.
    Match.tag("Unread", () => render(templates, "step-unread", {})),
    // And the third of them: a press rather than an absence, and still no data.
    Match.tag("Filing", () => render(templates, "step-filing", {})),
    // The escapes come out here and nowhere earlier. The event keeps them because
    // the drawer draws the colour; an agent gets no colour and reads the codes as
    // content, so a `[32m` in a fenced block is a token spent on nothing and a
    // string it may quote back. This is the one place the agent's view is
    // assembled — a Mustache lambda would hide the rule inside the template, where
    // `prompt.test.ts` could not see it.
    Match.tag("CheckFailure", (t) =>
      render(templates, "step-check-failure", {
        checkName: t.name,
        checkOutput: stripAnsi(t.output),
      }),
    ),
    Match.tag("Interrupted", () => render(templates, "step-interrupted", {})),
    // The command comes back exactly as the step's envelope named it — the
    // classifier clears a refused call only for a yes that names it.
    Match.tag("Permitted", (t) => render(templates, "step-permitted", { command: t.command })),
    Match.tag("Refused", (t) => render(templates, "step-refused", { command: t.command })),
    Match.exhaustive,
  )
  return withStopped(templates, body, ctx.stopped)
}

export interface ComposerContext {
  /**
   * The request, from the `Compose` command rather than from `trak` — which is
   * not redundant: `pnpm real:compose` composes for a trak that does not exist,
   * so the command is the only place it is guaranteed to be.
   */
  readonly description: string
  /**
   * Where the plan, the decisions so far and what is being asked are read from.
   * Empty on a first compose, which is what makes every block below it render as
   * nothing.
   */
  readonly trak: Trak
  /**
   * The fleet, as `name: description` lines. One index where there were three —
   * techniques, shapes and checks — because there is now one choice per step.
   *
   * Never empty: the library refuses to load without at least one agent.
   */
  readonly agentIndex: string
  readonly composition: string
  /** Which turn this is — see `Command.Compose`. */
  readonly trigger: Trigger
  /**
   * The moment of this turn, epoch milliseconds, read from `Clock` at the call site so
   * this stays pure. Told to the composer on the local clock beside the one rule for
   * `wait_until`: a duration counts from now, and an instant is on this clock. Nothing
   * else in a prompt carries a date — Claude Code injects its own, and a provider that
   * does not would leave the composer guessing what *tomorrow* is.
   */
  readonly now: number
  /**
   * Whether the project has a deploy script, so a step may carry `wait_for: "deployed"`.
   * The prompt offers that value only where this holds, and `ComposerOutputFor` refuses
   * it where it does not.
   */
  readonly deployed: boolean
  /** `stoppedOn` for the session this prompt resumes. */
  readonly stopped: readonly StoppedTask[]
}

/**
 * A plan entry as the composer reads it back: its name, where its work went, and
 * — for the tail it may hand back — what the entry says to do.
 *
 * `instruction` is `undefined` for a spawn, whose one instruction belongs to the
 * position rather than to a step the composer would re-propose verbatim.
 */
const named = (trak: Trak) => {
  const filed = new Set(visibleArtifacts(trak, undefined).map(([name]) => name))
  return (s: Step, i: number) => {
    const name = artifactKey(s, i)
    return {
      name,
      path: filed.has(name) ? artifactPath(name) : undefined,
      // A compose entry's instruction, where it has one, is the composer's note to
      // itself and not a step to re-propose. Callers filter it out before they get
      // here; this stays total so they cannot be the only thing standing between the
      // composer and its own name in a list.
      instruction: isSpawn(s) || isCompose(s) ? undefined : s.instruction,
    }
  }
}

/**
 * What has happened so far, and what the composer is being asked about.
 *
 * Empty for a first compose, which is what keeps one template body serving every
 * turn: nothing is on the table, so the whole block renders as nothing.
 *
 * **`kept` is the prefix the join keeps and `remaining` is the tail it replaces**,
 * and both are listed for one reason each. The prefix so the composer does not
 * propose finished work again. The tail *with its instructions* so it can hand the
 * tail straight back — a fresh session has never seen the current plan, and
 * "unchanged plus one appended entry" is the cheapest and most common answer to
 * what a step raised. Without it, every compose rewrites the tail from scratch.
 */
const reconsultView = (trak: Trak) => {
  const steps = trak.plan?.steps ?? []
  // The join is the end of what ran, and it is read here rather than carried: what
  // the composer keeps is exactly the entries that happened, and what it replaces is
  // exactly the ones that have not. Compose entries are dropped from both lists for
  // the reason `planView` drops them — the composer is being shown the work.
  const from = firstUnrun(trak)
  const why = trak.reconsult?.why
  // Two ways the composer is asked again, and the entry at the join says which. It is
  // there for both — `withAsk` writes one when something asks, and the composer writes
  // one when it schedules the turn itself — so the field is what tells them apart, and
  // `whyView` prefers it: what asked outranks what was planned.
  const here = steps[from]
  const planned = here !== undefined && isCompose(here) ? here : undefined
  if (why === undefined && planned === undefined) return { isReconsult: false }
  const entry = named(trak)
  const shown = (from_: number, to?: number) =>
    steps
      .map((s, i) => [s, i] as const)
      .slice(from_, to)
      .filter(([s]) => !isCompose(s))
      .map(([s, i]) => entry(s, i))
  const kept = shown(0, from)
  const remaining = shown(from)
  return {
    isReconsult: true,
    hasKept: kept.length > 0,
    kept,
    hasRemaining: remaining.length > 0,
    remaining,
    ...whyView(trak, why, planned),
  }
}

/**
 * Every flag `reconsult-why.md` branches on, spelled `false`.
 *
 * **Spread under each arm below, and load-bearing for the displaced ask.** A person's
 * replan that raced a raise renders the ask it displaced as a nested object under
 * `displaced`, and Mustache looks a missing key up the context stack — so a displaced
 * `Raised` with no `isReplanned` of its own would find the outer view's `true`, render the
 * person's paragraph a second time inside its own, and include the partial again from
 * there without end. A key that is present and `false` stops the lookup where it is.
 */
const NO_REASON = {
  isRaised: false,
  isReplanned: false,
  isReentered: false,
  isConflict: false,
  conflictInto: undefined,
  isChecks: false,
  isRefused: false,
  isConflicted: false,
  hasDisplaced: false,
  isDisplaced: false,
  // Not a flag but read as one: the template branches on it, so it is stopped here too.
  base: undefined,
}

/**
 * Which of the five the composer is answering, and the words that came with it —
 * or, with none of them, the turn it scheduled for itself.
 *
 * `planned`'s words are the composer's own, written onto the entry when it proposed
 * the plan that stops there; the other five are the payload of whatever asked.
 *
 * **A `Replanned` carrying the ask it displaced renders that ask under keys of its own**,
 * as one nested view, never spread beside the person's: `reason` is a key of `Refused` as
 * well, and a spread would have one silently win. The template steps into `displaced` and
 * the same partial renders the inner reason there, with the inner keys shadowing the outer.
 */
const whyView = (
  trak: Trak,
  why: ReconsultWhy | undefined,
  planned: Compose | undefined,
): Record<string, unknown> => {
  const steps = trak.plan?.steps ?? []
  const at = (step: number): string => {
    const s = steps[step]
    return s === undefined ? `step ${step}` : artifactKey(s, step)
  }
  if (why === undefined) return { ...NO_REASON, isPlanned: true, plannedFor: planned?.instruction }
  switch (why._tag) {
    case "Raised": {
      // Two writers, told apart by where the raise is: a step raises from its own
      // position, and the join raises from the spawn's. The position is the whole
      // of the fact — the reason carries no writer, and does not need to — and the
      // template says something different about each. A step's raise came with an
      // artifact that answered everything else; a spawn files nothing under its own
      // key, and what it raises is the very work its children filed as requirements,
      // so *that needed no plan* is false there.
      const s = steps[why.step]
      const handedUp = s !== undefined && isSpawn(s)
      // Two lists, each with its own flag, because the template says something
      // different about each and an artifact may carry either or both. At least one
      // is non-empty — see `raisedBy`.
      //
      // **`raisedWork`, not `requirements`, and the name is load-bearing.** This
      // object is spread into the same `render` as `intentView`, whose block is the
      // trak's whole standing list — so a key of that name here replaced it, and
      // suppressed it outright on the corrections-only turn. Three of the four kinds
      // of requirement reach the composer through the standing block alone, and this
      // is the one turn on which they have to.
      return {
        ...NO_REASON,
        isRaised: true,
        handedUp,
        raisedAt: at(why.step),
        hasRaisedWork: why.requirements.length > 0,
        raisedWork: why.requirements,
        hasCorrections: why.corrections.length > 0,
        corrections: why.corrections,
      }
    }
    case "Replanned":
      return {
        ...NO_REASON,
        isReplanned: true,
        replannedAt: at(why.step),
        reason: why.reason,
        ...(why.displaced === undefined
          ? {}
          : {
              hasDisplaced: true,
              // Rendered as the account the press did not read, not as what the turn
              // is asking: the partial withholds every whole-turn sentence on this.
              displaced: { ...whyView(trak, why.displaced, undefined), isDisplaced: true },
            }),
      }
    case "Reentered":
      return {
        ...NO_REASON,
        isReentered: true,
        arrived: why.what,
        isConflict: why.cause?._tag === "Conflict",
        conflictInto: why.cause?._tag === "Conflict" ? why.cause.into : undefined,
        base: why.base,
        isChecks: why.cause?._tag === "Checks",
        failedChecks: why.cause?._tag === "Checks" ? why.cause.failed.join(", ") : undefined,
      }
    case "Refused":
      return { ...NO_REASON, isRefused: true, refusedAt: at(why.step), reason: why.reason }
    case "Conflicted":
      // `into` may be absent — a detached host has no branch name — so the template
      // renders that clause on the value rather than on a second flag.
      return { ...NO_REASON, isConflicted: true, conflicts: why.paths, into: why.into }
  }
}

/**
 * What landed children sent back have handed up since a composer run last landed —
 * see `Trak.handUps`. **Every composer body spreads this**, because the run that
 * lands spends the list whichever body it was sent: a body without it would spend
 * hand-ups nobody read. `handed-up.md` closes on one of three sentences, and the
 * two flags say which body it is in — the full prompt, where the requirements are
 * above; the chat body, where the block has to give the person's words back their
 * bareness; or a framed resume, which is neither.
 */
const handUpsView = (trak: Trak, body: "full" | "message" | "framed") => ({
  hasHandUps: trak.handUps.length > 0,
  handUps: trak.handUps,
  handUpsBesideIntent: body === "full",
  handUpsAfterMessage: body === "message",
})

/**
 * The composer's prompt. Same mechanism as a step: one body per `Trigger`, one
 * exhaustive `Match` choosing it — the full framing on the first turn, only the
 * new context when resuming a session that already holds the request.
 *
 * `Reconsulted` renders the full body, and genuinely needs it: it is a fresh
 * session by decision, so nothing about the request or the plan so far is already
 * in the conversation, and the intent has moved on by every decision filed since.
 * `reconsultView` is where what is being asked gets stated. Which also means an
 * `Interrupted` compose that lost its session renders correctly: `promptTrigger`
 * falls back to `Initial`, and the block is on the trak either way.
 */
export const buildComposerPrompt = (templates: Templates, ctx: ComposerContext): string => {
  const full = (): string =>
    render(templates, "composer", {
      description: ctx.description,
      agentIndex: ctx.agentIndex,
      composition: ctx.composition,
      now: spellLocal(ctx.now),
      deployed: ctx.deployed,
      // **No view spread here may define a key another one supplies.** A spread is
      // silent about a collision and Mustache is silent about which value it got, so
      // the whole failure is a block quietly rendering somebody else's data — which
      // is what `whyView`'s `Raised` arm did to `intentView` until it was renamed.
      ...intentView(ctx.trak.decisions),
      ...attachedView(ctx.trak.attachments),
      ...parentView(ctx.trak),
      // Where a hand-off goes: a goal's trak's goes to the goal's composer, not to a trak.
      inGoal: ctx.trak.goal !== undefined,
      ...inheritedView(ctx.trak),
      ...splitView(ctx.trak),
      ...handUpsView(ctx.trak, "full"),
      ...reconsultView(ctx.trak),
    })
  const framed = handUpsView(ctx.trak, "framed")
  const body = Match.value(ctx.trigger).pipe(
    Match.tag("Initial", full),
    Match.tag("Reconsulted", full),
    Match.tag("Message", (t) =>
      render(templates, "composer-message", {
        message: t.text,
        ...attachedView(t.attachments ?? []),
        ...handUpsView(ctx.trak, "message"),
      }),
    ),
    Match.tag("Answers", (t) =>
      render(templates, "composer-answers", {
        answers: numbered(t.answers),
        ...noteView(t.note),
        ...framed,
      }),
    ),
    Match.tag("Unanswered", (t) =>
      render(templates, "composer-unanswered", { picks: picked(t.picks), ...framed }),
    ),
    // This one does not reach the composer either, and for a sharper reason than
    // `CheckFailure` below: `conversational` is a field on a plan *entry*, so a
    // composer run is never the thing that ended on a conversational note. It
    // renders the full prompt on that arm's argument — a body that stands alone is
    // the only safe answer where the assumption every resume body makes is exactly
    // what would be wrong.
    Match.tag("Unread", full),
    // Nor this one, for the same reason: a person asks a *step* to file, and the
    // route refuses a composer. The full prompt, on `Unread`'s argument.
    Match.tag("Filing", full),
    Match.tag("Interrupted", () => render(templates, "composer-interrupted", framed)),
    // This one does not reach the composer: `decide` never builds a `Compose`
    // with it, because `CheckFailure` names a check a *step* declared and a plan
    // has none. The arm exists because `Command.Compose` carries the whole
    // `Trigger`, and it is what makes the `Match.exhaustive` below a compile error
    // the day a new trigger lands.
    //
    // It renders the full prompt because that is the only body that stands on its
    // own: every resume body assumes a live session already holding the request,
    // and if one ever did arrive here that assumption is precisely what would be
    // wrong. Narrowing `Compose`'s trigger would delete the arm outright; that
    // reaches decide.ts and runtime.ts, so it is deferred, not dismissed.
    Match.tag("CheckFailure", full),
    // Neither reaches the composer, for `CheckFailure`'s reason: a permission gate
    // is a step's, and `decide` builds a `Compose` with neither.
    Match.tag("Permitted", full),
    Match.tag("Refused", full),
    Match.exhaustive,
  )
  return withStopped(templates, body, ctx.stopped)
}
