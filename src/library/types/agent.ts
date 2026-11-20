// types: the shape of one `.orkestra/agents/*.md` — a named role, defined once
// by a human, that a plan entry selects by name.
//
// One definition holds the knowledge, the output shape and the checks. A named
// agent does not union, so two failure modes are unrepresentable rather than
// forbidden: two sources each declaring sections, and checks emerging from
// whichever knowledge a step happened to carry.
//
// Field names here are the DOMAIN names. `read-only` is the on-disk spelling and
// survives into the type because there is nothing to translate: it is one word
// either way.

/**
 * What an agent may do to the checkout it works in.
 *
 * Two values, and deliberately not a free-form `disallowed_tools` list: every use
 * of one spells out the same three edit tools, which is `read-only` the long way.
 *
 * **The deny list this becomes belongs to the provider, not here.** `Edit`,
 * `Write` and `NotebookEdit` are Claude's tool names; another provider names them
 * differently, or can only *ask* rather than enforce. So the engine carries the
 * intent and `agent/providers/<name>/` carries the translation.
 *
 * It is not the safety boundary either — every step of a trak already runs in
 * that trak's own worktree, so an agent that writes anyway can only dirty its
 * own. What it buys is a cheaper turn and a statement of intent a check can be
 * held against.
 */
export type Permission = "read-only" | "write"

/**
 * The figures a section may ask for with `figure:`, each the label of a fenced block
 * the client draws in place of the fence and the next agent reads as written.
 *
 * Closed, because the name is stored inside every document that uses it: a fence the
 * client has no figure for draws as a code block, so a name the loader let through
 * would be a brief asking for something nothing draws. `table` is the free one, and
 * every step is taught it whether a section declares it or not.
 */
export const FIGURES = [
  "decision",
  "scope",
  "criteria",
  "files",
  "table",
  "overview",
  "walkthrough",
  "changes",
  "runs",
] as const

export type Figure = (typeof FIGURES)[number]

/** One section an artifact must (or may) contain. */
export interface OutputSection {
  /** The key the agent returns it under, and what the schema checks for. */
  readonly title: string
  /** What belongs in it. Rendered into the step's prompt. */
  readonly description: string
  /**
   * The condition under which the section is written, or `undefined` for one that
   * is always owed. A section with a `when` is omitted whenever the condition does
   * not hold, and the condition is rendered into the prompt beside the title.
   *
   * **A condition, never a bare `optional`.** Sections left to the agent's
   * judgement were filled in 88–100% of documents — "omit when there is nothing"
   * produced a heading saying "none" on every one. The two sections that were
   * genuinely skipped were both conditioned on a fact outside the agent's
   * judgement: a proof file existing, a plan splitting. So an optional section
   * has to say what fact makes it due, and the parser refuses `required: false`
   * without one.
   */
  readonly when: string | undefined
  /**
   * The figure the section is written as, or `undefined` for plain markdown. The
   * figure's grammar is rendered into the prompt, and only a declared figure's is —
   * `table` aside, which every step is taught.
   */
  readonly figure: Figure | undefined
}

/**
 * A skill this role is pointed at: the directory name, and where its `SKILL.md` is
 * relative to the repository root — so the same path holds in every worktree, each of
 * which is a checkout of it.
 */
export interface Skill {
  readonly name: string
  readonly path: string
}

export interface Agent {
  /** Derived from the filename: `build.md` -> `build`. The one field a file cannot lie about. */
  readonly name: string
  /** The composer's only selection signal. Required. */
  readonly description: string
  /**
   * Required, and handed to the provider verbatim after being checked against
   * `models.yaml`. One word, and the largest cost lever in the system.
   */
  readonly model: string
  /**
   * The reasoning effort this role's turns run at, beating the model's own default in
   * `models.yaml` — and only on turns that run on this file's `model:`. A model a person
   * picked on New Chat carries its own default instead, because this level was checked
   * against the CLI of the model named here and the pick may be on the other one.
   * `undefined` is the ordinary case: the model's default, else the CLI's.
   *
   * Validated at load against the levels the model's CLI accepts, like `model` and for
   * the same reason: a CLI handed a level it does not know warns and runs anyway, so
   * the typo would otherwise be invisible for the life of the trak.
   */
  readonly effort: string | undefined
  readonly permission: Permission
  /**
   * Required, and never empty. There is no shapeless agent: a role whose output
   * is one blob of markdown is an agent declaring one section, which is the
   * degenerate case rather than a special one.
   */
  readonly sections: readonly OutputSection[]
  /**
   * Names from `.orkestra/checks/`, validated when the library loads. Empty is
   * normal — a read-only agent has nothing for a script to inspect.
   *
   * On the agent rather than chosen per step, and that is not the reversal it
   * looks like. `check:` in a *technique* was rejected because unioning checks
   * across whatever a step happened to carry made verification an emergent
   * property of knowledge. One agent, one definition, nothing to union — and
   * verification genuinely is a property of the role.
   */
  readonly checks: readonly string[]
  /**
   * Names from `.orkestra/checks/`, validated with `checks` when the library loads,
   * and run once this step's work is on the branch. Empty is the common case.
   *
   * **The same file kind, and a different meaning for a non-zero exit.** A check
   * *verifies* — non-zero means the work is wrong, so the agent is re-entered to fix
   * it. An effect *acts*, outside this checkout, on work a person has already
   * approved — so non-zero means it could not do it, which is nobody's mistake and
   * settles `Failed{project}` for a human to retry.
   *
   * What makes running one safe without asking is that the approval already
   * happened: the artifact holds what is about to be sent, and the gate that took it
   * is the yes. Nothing here judges, so an effect is written to be idempotent —
   * *create it if it is not there* — because a restart re-issues it.
   */
  readonly effects: readonly string[]
  /**
   * Names from `.orkestra/checks/`, validated with the other two when the library
   * loads, and asked **before a step of this agent starts**. Empty is the common
   * case.
   *
   * **The same file kind, and a third meaning for the exit code — this list's
   * alone.** `exit 0` is *the thing happened*, so the step runs; `exit 1` is *not
   * yet*, which rests the trak at `Finished` holding its checkout and every door it
   * has, and the engine asks again on the interval the script's own header
   * declares; anything else is *it never will, or I cannot tell*, so the engine
   * stops asking and says so. A script that timed out or could not be spawned has
   * no exit code and reads as not yet — a hung poll must not be mistaken for a pull
   * request that closed.
   *
   * **Two names here back onto no script**: `merged`, which the engine answers from
   * the forge or a merge made here, and `deployed`, which is `merged` and then the
   * project's `deploy.sh` — listable only where that file exists. See
   * `ENGINE_CONDITIONS`.
   *
   * What a condition asks about is the world outside the checkout — a pull request
   * merging, a deploy landing — and what makes the wait cheap is that a resting
   * trak is workable: sent back, asked, merged or archived exactly as one whose
   * plan ran out.
   */
  readonly conditions: readonly string[]
  /**
   * Names from `.orkestra/processes/`, validated when the library loads, and started
   * before each turn of a step of this agent — a role that reads a page needs the
   * server up. A process that does not come up does not stop the turn: the agent is
   * told it is down. Empty is the common case.
   */
  readonly processes: readonly string[]
  /**
   * Can this role work as the **first** thing that happens in a trak — no plan, no
   * prior step, nothing but the request?
   *
   * Most can. `resolve` and `unblock` cannot: one needs a merge that did not go in
   * and the other a step that reported it was stuck, so neither has anything to read
   * when it is the opening turn.
   *
   * **Declared here rather than known by a surface.** New Trak offers the startable
   * ones, and a screen holding its own list of which agents are odd is drift nothing
   * can check — a new agent file would have to remember to teach the client about
   * itself.
   *
   * Required and defaulted, like `checks`: absent in the frontmatter means `false`,
   * which is the safe direction — an agent nobody thought about is not offered as an
   * opening move.
   */
  readonly start: boolean
  /**
   * The glyph a surface draws this agent with — an icon name in kebab, as
   * `lucide.dev` spells one: `signpost`, `layout-template`.
   *
   * **Here for the same reason `start` is here.** Which agents a project has, and
   * what each one is, are the project's to say; a screen holding its own map of
   * which agent looks like what is drift nothing can check. `survey` shipped
   * without a glyph and drew the fallback for weeks before anyone read the file.
   *
   * **Not validated at load, unlike `model`.** Checking a name would mean the
   * engine carrying the icon set of whichever library a client happens to draw
   * with — the coupling this field exists to remove. So the failure mode is
   * different in kind from a bad `model`: that one costs a trak mid-turn, this
   * one draws the fallback glyph, which is visible and costs nothing.
   *
   * Optional and defaulted like `checks` and `start` — a project that never wrote
   * one still loads.
   */
  readonly icon: string | undefined
  /**
   * Where a trak this agent starts keeps its checkout under a runner. `host` asks for a
   * linked worktree on the engine's machine, as with no runner, and no sandbox — for a
   * role that has to reach the machine itself. **A request, not a grant**: it takes effect
   * only where the host allows it for the project, and only for the agent of a trak's
   * first step, when its checkout is first made (`vcs/ports/host-traks.ts`). Anywhere
   * else the trak's checkout is in a sandbox as every other trak's is.
   *
   * Optional in the file and defaulted to `sandbox`, like `start`.
   */
  readonly place: "sandbox" | "host"
  /**
   * The repository's own skills this role reads, named in the project's agent file and
   * resolved to a `SKILL.md` at load. Empty is the common case.
   *
   * **A key rather than a sentence in the brief**, so a project can point a shipped
   * brief at its own skills in one line instead of copying the brief to add one. A
   * shipped file may not name any — which skills a repository keeps is the
   * repository's to say. Said on the session, with each path, by `system/skills.md`.
   */
  readonly skills: readonly Skill[]
  /**
   * The body: this role's anti-instincts. A Mustache template that may test the
   * `BRIEF_FLAGS` as sections and nothing else, which the step prompt renders before
   * inserting it.
   */
  readonly brief: string
}

/**
 * The flags an agent body may test, as `{{#flag}}…{{/flag}}` or `{{^flag}}…{{/flag}}`,
 * and every one the engine fills. `opening` is true on the entry a trak was opened
 * with — New Chat, or New Trak with an agent named — and false everywhere else.
 *
 * Closed, and checked at load: Mustache renders a name nobody fills as nothing, so a
 * misspelt flag would drop the guidance it wraps on every turn with no error.
 */
export const BRIEF_FLAGS = ["opening"] as const

export type BriefFlag = (typeof BRIEF_FLAGS)[number]

/**
 * The name of the one agent the **engine** carries rather than the project writing it —
 * `src/library/shipped/generic.md`, and the name a re-entry may ask for by. It is held
 * outside `Library.agents`, so a project's own file may not take the name: see
 * `assembleLibrary`, which refuses one.
 */
export const GENERIC = "generic"

/** Titles an artifact from this agent cannot omit. */
export const requiredTitles = (agent: Agent): readonly string[] =>
  agent.sections.filter((s) => s.when === undefined).map((s) => s.title)

/** Every title this agent declares, conditional or not — the ones an amendment may name. */
export const declaredTitles = (agent: Agent): readonly string[] =>
  agent.sections.map((s) => s.title)
