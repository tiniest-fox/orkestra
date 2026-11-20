// The composer's primary output: a title, and an ordered sequence of steps.
//
// **One field here opens a gate, and it is `ambiguity`.** `clearance` — the field that
// did it before — was deleted, and *this one is safe to run unattended* is still the
// shape to refuse: it puts the model whose work is being waved through in charge of
// waving it through, with nothing able to overrule it, and it makes composition quality
// unmeasurable, because the evidence a plan was any good is a human reading it.
//
// **Two things separate the rung from that, and it takes both.** It can only *cost* a
// stop: on `smart` a gate goes past by default, so the lowest rung buys no passage the
// mode had not already granted, and only the two above it change anything. And it is
// checkable — what a turn ran into is in the document it filed, so a false `none` is
// contradicted by the calls the turn described, where `clearance` was checkable against
// nothing. See `ambiguity.ts`, and `attention.ts` for what reads it.
//
// `continues` is the other field the engine acts on, and it is a third shape again: it
// names a conversation, and whose that conversation is and whether it exists at all are
// facts read off the plan rather than words the composer is handed.
//
// **Nothing tells the composer what any of it costs.** *What did this turn run into* is
// answerable honestly by a turn that does not know the answer opens a gate, and a
// prompt test is what holds that absence in place.

import { Schema } from "effect"
import { WaitUntil } from "../wait-until.js"
import { Ambiguity } from "./ambiguity.js"
import type { Correction } from "./correction.js"
import { HandOff } from "./hand-off.js"
import type { ReentryCause } from "../trak.js"

/** The engine conditions a plan entry may wait on itself — `AgentStep.wait_for`. */
const WaitFor = Schema.Literal("merged", "deployed")

const AgentStep = Schema.Struct({
  /**
   * Which of the two kinds of entry this is — a turn, or a spawn.
   *
   * **Optional**, which is the device `conversational` already uses below: a log
   * written before spawn existed replays unchanged, and a composer that omits it
   * is not re-prompted. Untagged would also decode, since the two members have
   * disjoint required fields — but a tag is what the composer is *shown*, and *an
   * entry is either a turn or a spawn, never both* should be visible in the JSON
   * rather than inferred from which keys are present.
   *
   * Ask `isSpawn` rather than the field, for the reason `isConversational`
   * exists: absent and `"agent"` mean the same thing, and there is one place to
   * be wrong about it.
   */
  type: Schema.optional(Schema.Literal("agent")),
  /**
   * Which agent runs this step, by name from the library. **Nothing else about
   * the step is on the plan entry** — the knowledge, the output shape and the
   * checks are properties of that agent, defined once by a human.
   *
   * The composer picked knowledge before anyone had read the code, which made it
   * structurally the worst-placed participant to decide what the work would need.
   * One name is the whole of what it chooses now.
   */
  agent: Schema.String,
  /**
   * Required, not optional. This is the composer's own contribution: the
   * lightweight intent for this step ("come up with a high-level plan",
   * "review technically"). The agent's brief carries the reusable how; the
   * instruction says what this particular step is FOR. Making it optional let
   * the composer omit it and leave a step with nothing but an agent name.
   */
  instruction: Schema.String,
  /**
   * The artifact is not owed on the **first** turn: this step starts as a
   * conversation, and prose stops being a decode failure until one arrives.
   *
   * A deferred deadline, not an optional output. The declared shape does not
   * move — when the document does arrive it validates strictly, runs its checks
   * and gates like any other. What this changes is one rule that is not an
   * envelope at all.
   *
   * **On the entry, not on the agent.** Any agent can be run this way — `build`
   * unenforced is pairing on code, `review` unenforced is talking a review
   * through before it commits to findings — so putting it on the role would mean
   * a second, freeform fleet entry per role to maintain.
   *
   * Optional, so a log written before this field replays unchanged and a
   * composer that omits it is not re-prompted. Ask `isConversational` rather
   * than the field: absent and `false` mean the same thing, and there is one
   * place to be wrong about it.
   *
   * `continues` below is the other part of an entry the composer may leave off, and
   * the two are different kinds of claim: it names a session to pick up, and this one
   * says when the artifact is owed, which is the engine's own behaviour. **Neither
   * says whether a person looks.** A per-entry flag that did — `clearance` — was
   * deleted, and what decides it now is the trak's mode and what the turn at that
   * position reports about itself once it has run. See `attention.ts`.
   */
  conversational: Schema.optional(Schema.Boolean),
  /**
   * The artifact key of a document whose conversation this step picks up —
   * `2-build`. Absent means a fresh session, which is every other step.
   *
   * **This is how a fix reaches the agent that wrote the thing being fixed.** A
   * step told *the reviewer says your §Findings misreads the guard* is cheap in a
   * session that already holds the code it wrote and expensive in one that does
   * not, and re-entering the position that filed it is not available: that is
   * backward routing, and it would renumber a completed entry. A new entry
   * resuming that document's session is forward in the plan and continuous in the
   * conversation.
   *
   * Optional, the device `conversational` uses and for the same replay reason: a
   * log written before this field decodes unchanged, and a composer that omits it
   * is not re-prompted. Ask `continuesFrom` rather than the field.
   *
   * A key naming no entry is not an error. `borrowedSession` has nothing to hand
   * back, so the turn starts fresh — the same outcome as omitting it, reached without
   * a decode rule that would have to know the plan. It answers the same way for a key
   * that does name one whose agent file has since been renamed or deleted: the model
   * that session was minted with is then unknowable, and a session is never resumed
   * under another model.
   */
  continues: Schema.optional(Schema.String),
  /**
   * When this step may start, and absent for the step that starts as soon as the one
   * before it is done — which is every other step.
   *
   * An hour on the local clock, `2026-09-16T06`, or an ISO-8601 duration, `PT90M`,
   * and **both resolve against the moment the plan was composed** — `Trak.planAt`,
   * read through `waitUntilAt` — so the instant is known at the plan gate and never
   * moves. The engine answers it before the agent's own conditions, as a wait like
   * theirs: not yet rests the trak at `Finished` holding the entry, and the sweep
   * wakes it on the instant rather than on an interval. See `wait-until.ts`.
   *
   * On the entry rather than on the agent, because *when* is about the work and not
   * the role: *tomorrow morning* and *the start of next week* are the same verify
   * work at two times. On an agent step only — a spawn or a compose takes none.
   *
   * Optional, on `continues`' terms: a log written before this field decodes
   * unchanged, and a composer that omits it is not re-prompted. Ask `waitUntilOf`
   * rather than the field. Snake case, because the composer writes it by hand.
   */
  wait_until: Schema.optional(WaitUntil),
  /**
   * One of the two conditions the engine answers itself, held on this step as though
   * its agent declared it — `merged`, or `deployed` where the project has a deploy
   * script — and absent for every step whose only waits are its agent file's.
   *
   * On the entry for `wait_until`'s reason: *once the pull request has merged* is about
   * this work, not about the role, and a project override would hold every step that
   * agent ever runs. Asked after the time and before the agent's own conditions, with a
   * name the agent repeats asked once — see `declaredConditions` in the runtime.
   *
   * One value rather than a list, because `deployed` already asks `merged` first. A
   * project's own condition scripts stay on agent files. `ComposerOutputFor` refuses
   * `deployed` on a project with no deploy script, and a writer at or after the step.
   * Optional on `continues`' terms; ask `waitForOf`. Snake case, because the composer
   * writes it by hand.
   */
  wait_for: Schema.optional(WaitFor),
  /**
   * The model this step runs on instead of its agent file's `model:`, and absent for
   * every step but the one a person opened New Chat with and one a person picked a
   * model for at the plan gate.
   *
   * **A person's field, never the composer's.** A model is the largest cost lever in
   * the system, so it is set by a person and by nothing an agent writes:
   * `ComposerOutputFor` refuses a proposal carrying it, so a step nobody picked for runs
   * on its own agent file. The create route, or the act route for a pick at the gate,
   * has already checked the name against `models.yaml` by the time it is here.
   *
   * Optional on `continues`' terms — a log written before this field decodes unchanged.
   * Ask `modelOf` rather than the field.
   */
  model: Schema.optional(Schema.String),
})
export type AgentStep = Schema.Schema.Type<typeof AgentStep>

/**
 * One step of one piece of a spawn: an agent, and what that step is for.
 *
 * The same two fields an agent step carries and a separate shape all the same,
 * because what they mean differs. A piece's first `instruction` is the whole of
 * what its trak is *about* — it becomes that trak's plan title — where a step's is
 * situational guidance beside a request the trak already holds.
 *
 * No `conversational` and no `type`: a piece's steps are turns by shape, which is
 * also the second half of why a piece cannot split again. The ceiling stays the
 * decode refusal in `ComposerOutputFor`, and nothing here can express a nested
 * fan-out or a scheduled re-compose for it to have to catch.
 *
 * `model` is `AgentStep`'s, on its terms: a person's pick at the parent's plan gate and
 * never the composer's, which `ComposerOutputFor` refuses. `childPlan` carries it onto
 * the child's own entry, which is where `modelAt` reads it.
 *
 * `wait_for` is here only to be refused: the decode drops a key the schema does not
 * name, so a piece's wait would vanish without the composer being told. Nobody has
 * traced whether a child resting on `merged` is ever released.
 */
const ChildStep = Schema.Struct({
  agent: Schema.String,
  instruction: Schema.String,
  model: Schema.optional(Schema.String),
  wait_for: Schema.optional(WaitFor),
})
export type ChildStep = Schema.Schema.Type<typeof ChildStep>

/**
 * One piece of a spawn: the plan its trak is born with, in order.
 *
 * **Two arms, and only the first is ever written.** `{ steps: [...] }` says what it
 * holds with no guessing, which is the standing rule for anything an agent writes
 * by hand; the bare `{agent, instruction}` is there so a log written when a piece
 * was one agent replays unchanged. Ask `childSteps` rather than the shape — six
 * readers, and one place to be wrong about which arm arrived.
 *
 * A piece that builds and then reviews its own work is the case this exists for.
 * **Every step of it stops at a gate**, like any other step of any other trak, so a
 * piece of two costs two stops plus its keep-or-drop decision.
 *
 * It carried a third field, `standalone`, saying a piece was releasable on its
 * own and should therefore branch from the host's `HEAD` and never come back.
 * **Removed**: whether a piece deserves its own pull request is discovered while
 * doing it rather than while planning it, so it belongs to closing a child rather
 * than to describing one — and if the piece did land on main, the parent needs to
 * be sitting on it, which *never comes back* makes impossible. Every child now
 * branches from the parent's branch and merges back when a human says so.
 */
const Child = Schema.Union(Schema.Struct({ steps: Schema.NonEmptyArray(ChildStep) }), ChildStep)
export type Child = Schema.Schema.Type<typeof Child>

/**
 * The steps a piece runs, in order — exactly one for a piece written as a bare pair.
 *
 * A function rather than a field read, for the reason `isConversational` is one:
 * the two arms mean the same thing where they overlap, and a reader that got
 * `"steps" in c` right in one place and wrong in another is the drift a total
 * function costs nothing to prevent.
 */
export const childSteps = (c: Child): readonly [ChildStep, ...ChildStep[]] =>
  "steps" in c ? c.steps : [c]

/**
 * The step whose document lands on the parent — the last one.
 *
 * `steps[0]` answers the compiler's question about an index it cannot see is in
 * range, rather than an assertion, which is the one thing this repository does not
 * allow. For a piece of one step the two are the same value.
 */
const lastStep = (c: Child): ChildStep => {
  const steps = childSteps(c)
  return steps[steps.length - 1] ?? steps[0]
}

/**
 * N pieces of work that are genuinely independent, each run as its own trak.
 *
 * `instruction` is shared with an agent step, because the composer's why-now for
 * a group is the same kind of thing it is for a turn — situational guidance with
 * no declared output and no check of its own.
 *
 * Named `Spawn` and not `SpawnStep`, which is already a `Command` meaning very
 * nearly the opposite: *run one step's turn*.
 */
const Spawn = Schema.Struct({
  type: Schema.Literal("spawn"),
  instruction: Schema.String,
  children: Schema.NonEmptyArray(Child),
})
export type Spawn = Schema.Schema.Type<typeof Spawn>

/**
 * The composer scheduling its own next turn: *stop here, and ask me again.*
 *
 * **A plan that does not finish the job is a real plan**, and this is how one says so
 * — an entry in the sequence rather than a field beside it. `instruction` is what the
 * composer could not see past (*"whether this is one service or two is not decidable
 * until the discovery lands"*), which is the same thing an agent step's is: what this
 * particular entry is FOR.
 *
 * It was `Proposal.open_question`, a field, and a person at the plan gate read it
 * beside the plan rather than in it. As an entry it is a row like any other, it takes
 * its position in the record when it runs, and the rule that acted on it — *the plan
 * ran out still carrying one* — is deleted along with everything that had to be careful
 * about clearing it.
 *
 * **Only ever the last entry**, enforced by `ComposerOutputFor`: a compose in the
 * middle would be the composer planning around an answer it has just said it does not
 * have.
 */
const ProposedCompose = Schema.Struct({
  type: Schema.Literal("compose"),
  instruction: Schema.String,
})

/** What the **composer** may return: an agent turn, a spawn, or a re-cut of its own. */
export const ProposedStep = Schema.Union(AgentStep, Spawn, ProposedCompose)
export type ProposedStep = Schema.Schema.Type<typeof ProposedStep>

/**
 * A run of the composer, as an entry in the plan it wrote.
 *
 * **The composer is a step.** It has a position, a session in that position's slot and
 * an outcome in the log, exactly like a turn — and a plan that could not say where its
 * own re-cuts happened was a record with the most interesting thing missing.
 *
 * Two fields, and **exactly one of them is ever present**, because a compose entry
 * arrives one of two ways:
 *
 * - `why` — the engine wrote it at the join, the moment something asked the composer
 *   again. Absent on the very first compose, which nothing asked for.
 * - `instruction` — the composer proposed it, as the last entry of a plan that stops
 *   short. See `ProposedCompose`.
 *
 * Both optional rather than a union of two shapes: they share a tag and a position, and
 * every surface that draws a plan renders whichever it finds. A shape that is
 * discriminated by which of two optional fields is set discriminates on nothing the
 * compiler can check, so this is a comment rather than a type — the two writers are
 * `withAsk` and the composer's own proposal, and neither ever fills in the other's
 * field.
 *
 * **`why` also means the entry is the engine's to take back.** A composer-proposed
 * re-cut is a plan entry like any other; an ask stands only while its reason does, which
 * is what `withoutAsk` reads.
 */
export interface Compose {
  readonly type: "compose"
  readonly why?: ReconsultWhy
  readonly instruction?: string
}

/**
 * Which of the four asked the composer again, and what to tell it.
 *
 * Lives here rather than on the `Trak` because it ends up on the entry: it is a fact
 * about that run, written down when the run lands, and reading it back is how any
 * surface says why the plan changed shape.
 *
 * **There is no `Exhausted`.** A plan running out where the composer said it would is
 * no longer a reason the *engine* infers from a field — the composer writes the entry
 * itself, and reaching it is entering a step. So a compose entry with no `why` at all
 * is the planned case, and its `instruction` says what it is for.
 *
 * **`Raised` carries both of a step's channels, and at least one is non-empty.** Two
 * reasons would be two asks, and `withAsk` allows exactly one standing at a time — so
 * an artifact filing a requirement *and* a correction would have had one of them
 * replace the other silently. The invariant is held in `replay.ts` by its two writers:
 * `raisedBy`, for a step's artifact, and `joinChildren`, for what a spawn's children
 * handed up.
 *
 * **`Replanned` may carry the ask it displaced, and that is the same invariant met from
 * the other side.** A recompose pressed while a step's turn runs lands after the turn
 * has ended — the take-over forks it after interrupting — so it can find an ask already
 * standing: the step's own `Raised`, or one the composer is answering. One ask stands, and
 * it is the person's; the one it displaced rides inside it under `displaced`, so its
 * corrections reach the composer rather than being written over. Only the raced press
 * folds — `recordFacts` reads the gate — because at a gate the artifact and its complaints
 * were on screen before the person typed, and their words replace the ask whole.
 *
 * **The type admits any depth, and the writer folds whatever stands — including a fold.**
 * A raced press re-parks the trak with the folded ask standing; a resume re-issues the
 * turn, and a second press mid-turn folds again, so `Replanned{displaced: Replanned{…}}`
 * is reachable and is not bounded away: bounding it would drop one person's words, which
 * is the loss the fold exists to refuse. What holds instead is that **every level but the
 * innermost is one person's press, newest outermost**, and the innermost is whatever was
 * standing before any of them — so the chain reads as the presses in reverse order over
 * at most one non-`Replanned` account. Every reader recurses: `raisedIn` in
 * `attention.ts`, the schema on the wire, the composer's partial and the row's caption.
 * Nothing may test `_tag === "Raised"` on the entry directly.
 *
 * `Conflicted` is the one that comes from git rather than from an agent or a person,
 * and the two fields are not the same kind of thing. `paths` is the material — what a
 * resolution is sized against. `into` is the destination's **name**, and the composer
 * carries it onto the resolving step's instruction because nothing inside that
 * checkout can tell a host trak's destination from a child's. Only the branch's *tip*
 * is read live. Absent for a detached host `HEAD`.
 */
export type ReconsultWhy =
  | {
      readonly _tag: "Raised"
      readonly step: number
      readonly requirements: readonly string[]
      readonly corrections: readonly Correction[]
    }
  | {
      readonly _tag: "Replanned"
      readonly step: number
      readonly reason: string
      // `| undefined` beside the `?`, matching what `Schema.optional` produces on the
      // wire — so this is assignable to `ReconsultWhyDto` without a copy.
      readonly displaced?: ReconsultWhy | undefined
    }
  /**
   * `cause` is set where the engine sent an auto-merging trak back, and `what` is then
   * its pull request's address. `base` is the pull request's base branch, set wherever
   * the re-entry answers the forge refusing a merge — through either door.
   */
  | {
      readonly _tag: "Reentered"
      readonly what: string
      readonly cause?: ReentryCause | undefined
      readonly base?: string | undefined
    }
  /**
   * The engine refused the step at `step` as it was about to run — an agent that
   * writes, on a trak whose branch or whose parent's has merged since the plan was
   * accepted. `reason` is the decode's own sentence, so the composer is told the
   * same thing whether it is refused before the plan is approved or after.
   */
  | { readonly _tag: "Refused"; readonly step: number; readonly reason: string }
  | {
      readonly _tag: "Conflicted"
      readonly paths: readonly [string, ...string[]]
      // `| undefined` beside the `?`, matching what `Schema.optional` produces on the
      // wire — so this is assignable to `ReconsultWhyDto` without a copy.
      readonly into?: string | undefined
    }

/**
 * One plan entry: a compose, an agent turn, or a spawn.
 *
 * **Three kinds, and the third is what makes the plan a record.** An entry that has run
 * is never moved, replaced or renumbered — a re-compose truncates only the unrun tail
 * and appends — so a position is a permanent name, `artifactKey` is stable by
 * construction, and an index written into the log stays true forever.
 *
 * Wider than `ProposedStep` by what a compose entry may carry rather than by a whole
 * kind: the composer can propose one, but only the engine can say *why* it ran.
 */
export type Step = Compose | AgentStep | Spawn

/** Is this entry the composer's own run? */
export const isCompose = (s: Step): s is Compose => s.type === "compose"

/** Is this entry N traks rather than a turn? See `type` above. */
export const isSpawn = (s: Step): s is Spawn => s.type === "spawn"

/**
 * Does this entry defer its artifact past the first turn?
 *
 * A function rather than a field read, because the field is optional and absent
 * is the same answer as `false`. Three places ask — which gate a reply parks at,
 * whether the turn is enforced, and what the contract says — and one of them
 * getting `!step.conversational` right and another getting it wrong is exactly
 * the kind of drift a total function costs nothing to prevent.
 *
 * A spawn is never one: its children each hold their own conversation, and the
 * position itself has no session to talk to.
 */
export const isConversational = (s: Step): boolean =>
  !isSpawn(s) && !isCompose(s) && s.conversational === true

/**
 * Which document's conversation this entry picks up, or `undefined` for the fresh
 * session every other entry gets.
 *
 * A function rather than a field read, for the reason `isConversational` is one: the
 * field is optional and on one member only, so a reader that got `step.continues`
 * right for an agent step and reached for it on a spawn would be asking a question
 * that shape cannot answer. A spawn is never one — its children each hold their own
 * conversation, and the position itself has no session.
 */
export const continuesFrom = (s: Step): string | undefined =>
  isSpawn(s) || isCompose(s) ? undefined : s.continues

/**
 * The time this entry waits for, as the composer wrote it, or `undefined` for one that
 * starts when the entry before it is done. A function for `continuesFrom`'s reason:
 * the field is on one member only. `waitUntilAt` in `trak.ts` is the resolved instant.
 */
export const waitUntilOf = (s: Step): string | undefined =>
  isSpawn(s) || isCompose(s) ? undefined : s.wait_until

/** The engine condition this entry waits on itself, or `undefined`. `waitUntilOf`'s reason. */
export const waitForOf = (s: Step): "merged" | "deployed" | undefined =>
  isSpawn(s) || isCompose(s) ? undefined : s.wait_for

/**
 * The model a person picked for this entry, or `undefined` for the agent file's own —
 * which is every entry but a chat's first and one picked at the plan gate. A function for `continuesFrom`'s reason: the
 * field is on one member only. `modelAt` in `trak.ts` reads it — `modelOf(step) ??
 * agent.model`, on the entry that minted the step's session — and that is the one place
 * the two are resolved against each other.
 */
export const modelOf = (s: Step): string | undefined =>
  isSpawn(s) || isCompose(s) ? undefined : s.model

/**
 * The plan a child is born with, one entry per step the piece names. See
 * `TrakCreated` in `event.ts`.
 *
 * **The title is the first step's instruction**, which is what the piece as a whole
 * is about — the later steps are what it does with that, and a piece named after
 * *review the work* would say nothing about which work.
 */
export const childPlan = (c: Child): Proposal => {
  const [first, ...rest] = childSteps(c)
  return proposal(first.instruction, [AgentStep.make(first), ...rest.map((s) => AgentStep.make(s))])
}

/**
 * The one-step plan a trak opened with a named agent is born with — New Trak's
 * *start a conversation with `ui-prototype`* rather than *describe it and wait for
 * the composer*.
 *
 * The same shape `childPlan` builds for a piece of one step, and two deliberate
 * differences:
 *
 * **`conversational: true`, always.** The request was *a conversation with*, and the
 * flag only defers the artifact past the first turn — an agent with enough to go on
 * still files immediately and gates like any other step. There is no per-agent say in
 * it, because there is nothing here for one to be a property of.
 *
 * **The title is the request verbatim**, which is a wart taken knowingly. A row
 * renders `title ?? description`, so the list reads character-for-character as it
 * would with no plan at all, and the first composer turn — a reconsult over what a
 * step raised, or a re-cut — rewrites it. The alternatives were asking a person for a short
 * title in the form, and making `Plan.title` optional across the domain; both cost
 * more than the wart.
 *
 * `model` is New Chat's pick, and absent for every other door: the entry then runs on
 * the agent file's own. See `AgentStep.model`.
 */
export const openingPlan = (agent: string, request: string, model?: string): Proposal =>
  proposal(request, [conversationWith(agent, request, model)])

/**
 * One entry: this agent, on this sentence, as a conversation.
 *
 * **Both doors build it, which is the whole of why it is a function.** New Trak's
 * named-agent birth wraps it in `openingPlan`; a re-entry naming an agent splices it
 * into the plan that already ran (`withStep`). The two differ in where the entry goes
 * and in nothing else, and a second constructor is how they would start to differ.
 *
 * `conversational: true` for `openingPlan`'s reason: what was asked for is a
 * conversation, and the flag only defers the artifact past the first turn.
 *
 * `model` is optional because only one of the doors offers a pick — the re-entry sends
 * none and the entry runs on the agent file's own, exactly as before the field existed.
 */
export const conversationWith = (agent: string, instruction: string, model?: string): AgentStep =>
  AgentStep.make({
    agent,
    instruction,
    conversational: true,
    ...(model === undefined ? {} : { model }),
  })

/**
 * Tagged, because it is one member of the composer's output union — a Proposal
 * and a Questions have to be told apart by `_tag` like every other contract here.
 */
export const Proposal = Schema.Struct({
  type: Schema.tag("proposal"),
  /**
   * One line naming the work, rewritten on every proposal.
   *
   * It costs nothing — the composer has already read the request in order to plan
   * against it — and it is what a listing, a gate and a trak record all want to
   * show. A raw request is a paragraph, and a list of paragraphs is unreadable.
   *
   * **A revision replaces it**, because the turn that just re-cut the plan is the
   * one that knows what the work turned out to be — and the first proposal is the
   * least informed guess anyone will make about that. The cost is a list entry that
   * moves under a reader, which is the smaller of the two: a name that stopped being
   * true is read as fact, where one that changed is read as news.
   */
  title: Schema.String,
  /**
   * One or two sentences on **what the composer found that shaped this sequence**,
   * and absent whenever there was nothing to say — which is most of the time.
   *
   * Not a justification for the plan. A field that is always filled is one a
   * reader skims and approves past, which is worse than nothing because it looks
   * like oversight. What earns a line here is *news*: the thing that made the
   * work smaller or larger than the request suggested — the flag already half
   * exists, the record already computes cost, there are two callers not one. A
   * person at the plan gate can act on that; they cannot act on an argument for a
   * sequence they are already reading.
   *
   * **Its absence is a signal too**, which is what optional buys: a plan with no
   * line here is one composed from the request alone, and that is the ordinary
   * case rather than a gap.
   *
   * A revision or a re-entry replaces it, unlike `title` — the news is about the
   * sequence being proposed now, and the earlier one is in the log.
   */
  rationale: Schema.optional(Schema.String),
  steps: Schema.NonEmptyArray(ProposedStep),
  /**
   * How much of the work was unsettled when this turn cut the plan. See
   * `ambiguity.ts`.
   *
   * **About the compose run that just happened, not about any step it proposed.** A
   * rung per entry would be the composer rating work it has not done; this is the one
   * question it can answer from what it just did.
   *
   * **Optional here and required at the turn** — `ComposerOutputFor` re-prompts a live
   * composer that leaves it out, and this stays permissive because `decodeEvent`
   * replays every proposal ever stored through it. Absent is `none`, via `ambiguityOf`.
   *
   * It lands in the slot at the compose entry's own position when the run does, beside
   * that run's session: `warrants` is recomputed whenever a surface draws it, so a rung
   * read live off the event would be undrawable an hour later.
   */
  ambiguity: Schema.optional(Ambiguity),
  /**
   * Work this plan does not do because it belongs on another base — each entry a
   * trak of its own, cut from the default branch, opened when this plan is approved.
   * See `HandOff`. Not a step: a plan entry runs in this checkout, and the point of
   * a hand-off is that the work cannot.
   *
   * On the proposal as well as on `Finished`, and refused at decode on a child
   * (`ComposerOutputFor`), whose branch goes back to its parent rather than to the
   * main line. Absent is the ordinary case; `planOf` drops it, because a plan is what
   * runs here and a hand-off is what does not.
   */
  handOff: Schema.optional(HandOff),
})
export type Proposal = Schema.Schema.Type<typeof Proposal>

/**
 * What the trak holds: the same three fields, over entries rather than proposals.
 *
 * **A `Proposal` is what the composer returned; a `Plan` is what happened and what is
 * still to come.** They were one type, and that is what left a compose run and a stuck
 * attempt with nowhere to live — anything that had *happened* could only be recorded if
 * it was also something to *do*.
 *
 * Not a `Schema`: nothing decodes one. A plan is replayed from the log every time, and
 * the only plan that crosses a boundary is a child's, which is a `Proposal` because a
 * child has composed nothing.
 */
export interface Plan {
  readonly title: string
  // `| undefined` beside the `?`, matching what `Schema.optional` produces under
  // `exactOptionalPropertyTypes` — so a `Proposal` is assignable here without a copy.
  readonly rationale?: string | undefined
  readonly steps: readonly [Step, ...Step[]]
}

/** A first proposal, as the plan it becomes. What a child is born holding. */
export const planOf = (p: Proposal): Plan => ({
  title: p.title,
  ...(p.rationale === undefined ? {} : { rationale: p.rationale }),
  steps: p.steps,
})

/**
 * What a step's artifact is filed under: its position, then its agent.
 *
 * ```
 * 0-discovery
 * 1-breakdown
 * 2-build
 * 3-breakdown      ← the composer proposed it twice
 * ```
 *
 * **The agent name alone cannot be the identity** — a plan that runs `breakdown`
 * twice is ordinary, and the second would overwrite the first's artifact. A
 * composer-chosen slug fixes that and costs a field, a uniqueness rule and a
 * decision on every step; the position fixes it and costs nothing. It also reads
 * better: an ordered key says what each artifact applies to and in what order,
 * which a set of slugs does not.
 *
 * Zero-based, matching the engine's own step index. Two numbering systems for
 * the same thing is worse than counting from zero in a display.
 *
 * A spawn position is named `spawn` rather than an agent, because it names
 * several — and nothing is ever filed under it. What its children file goes
 * under `childKey`, one entry each.
 */
export const artifactKey = (step: Step, index: number): string => `${index}-${stepName(step)}`

/**
 * What an entry was told to do, and `undefined` for a compose the engine appended —
 * nobody instructed that one.
 *
 * A function rather than a field read for the reason `isConversational` is one: the
 * field is optional on one member, and every surface that prints a plan would otherwise
 * have to remember which.
 */
export const instructionOf = (s: Step): string | undefined => s.instruction

/** What names an entry: its agent, the fact that it is several, or the composer. */
export const stepName = (s: Step): string =>
  isCompose(s) ? "compose" : isSpawn(s) ? "spawn" : s.agent

/**
 * What names one child of a spawn on its parent: the parent's position, then the
 * child's own, then its agent — `2.0-review`, `2.1-review`.
 *
 * The child index is not decoration. Parallel review lenses are the worked
 * example this phase exists for, and every one of them is a `review`, so a key
 * of position-plus-agent would have four children overwriting each other's
 * findings in one map.
 *
 * **The piece's last step names it**: what a piece is for is what it ends on, and
 * a piece that does the work and then reviews it is a review of that work.
 *
 * **A directory, not a document.** Every document the piece filed lands under this
 * name by the piece's own key — `2.0-review/0-work`, `2.0-review/1-review` — and a
 * piece of one step is laid out the same way, so a reader never has to count steps
 * to know where to look. See `pieceKey`.
 */
export const childKey = (index: number, child: number, c: Child): string =>
  `${index}.${child}-${lastStep(c).agent}`

/**
 * Where one of a piece's documents files on the parent: under the piece's name, by
 * the key the child filed it under in its own checkout.
 *
 * A slash, because the projection is a directory and a key with one in it is a
 * subdirectory — so the parent's `.orkestra/.trak/` holds one folder per piece, and
 * so does its folder in the corpus.
 */
export const pieceKey = (piece: string, key: string): string => `${piece}/${key}`

/** Is this one of the piece's documents? The inverse of `pieceKey`. */
export const inPiece = (piece: string, key: string): boolean => key.startsWith(`${piece}/`)

/**
 * The key a piece's last step files under in its own checkout, read off the spawn
 * entry — `artifactKey` for a plan the child has not yet replanned.
 *
 * What replay keys a landing written before `ChildLanded.artifacts` under: such a
 * log carries the child's last document and no key, and the spawn entry is the
 * only account of the child's plan the parent holds. Right unless the child
 * replanned, which that entry cannot see.
 */
export const lastChildKey = (c: Child): string => `${childSteps(c).length - 1}-${lastStep(c).agent}`

/** One piece of a split, as the pieces beside it read it. */
const SplitPiece = Schema.Struct({ name: Schema.String, instruction: Schema.String })

/**
 * What a child is told about the split it came out of: the composer's statement of
 * the partition, and every piece it named — **this one included**.
 *
 * A piece's `instruction` is what it was *asked* to do, which is exactly the fact
 * that says a topic belongs to somebody else. Nothing here locates a sibling — no
 * id, no branch, no checkout path — because the consequence for this trak is the
 * same whether a sibling has landed or never will: not yours. A path is an
 * invitation to build against a tree that may never exist.
 *
 * Every child of one spawn is handed the identical value. Which entry is its own is
 * `Parent.child`, read where the list is displayed rather than stored per child.
 */
export const Split = Schema.Struct({
  instruction: Schema.String,
  pieces: Schema.NonEmptyArray(SplitPiece),
})
export type Split = Schema.Schema.Type<typeof Split>

/** The split a spawn at `step` hands each of its children. */
export const splitOf = (s: Spawn, step: number): Split => {
  const at = (c: Child, child: number): Schema.Schema.Type<typeof SplitPiece> => ({
    name: childKey(step, child, c),
    instruction: childSteps(c)[0].instruction,
  })
  const [first, ...rest] = s.children
  return Split.make({
    instruction: s.instruction,
    pieces: [at(first, 0), ...rest.map((c, i) => at(c, i + 1))],
  })
}

/**
 * The split as markdown — the partition, then a row per piece, this trak's marked.
 *
 * A named text function rather than markdown inline in `trakDocument`, for the
 * reason `decisionsText` is one: the rendering is a view of a stored shape and
 * belongs beside it.
 *
 * `own` is the reader's own index — `Parent.child`. Absent marks nothing, which is
 * what a reader that is not one of the pieces should see.
 */
export const splitText = (split: Split, own: number | undefined): string => {
  const row = (p: Schema.Schema.Type<typeof SplitPiece>, i: number): string =>
    `- ${p.name} — ${p.instruction.trim()}${i === own ? "  ← THIS PIECE" : ""}`
  return `${split.instruction.trim()}\n\n${split.pieces.map(row).join("\n")}`
}

/**
 * A revision, appended to the entries that stay.
 *
 * The composer is asked what happens *from here*, so a revision is the remainder rather
 * than the whole. `head` is everything the revision does not touch — every entry that
 * ran, plus the compose entry for the run being landed — and the proposal follows it.
 *
 * **Nothing that ran is ever replaced or renumbered**, which is what makes `artifactKey`
 * honest: it is position-plus-name, so a plan that renumbered a completed entry would
 * rename a document that already exists and is already referenced by everything filed
 * against it. This used to depend on `from` being computed carefully by `joinAfter`;
 * now it is a property of the shape.
 *
 * **The revision's own `title` and `rationale`, never the previous plan's** — which is
 * why the plan being revised is not an argument here. Both are what the composer has to
 * say about the sequence it is proposing *now*, and the earlier pair is in the log.
 */
export const revise = (head: readonly Step[], revised: Proposal): Plan => ({
  title: revised.title,
  ...(revised.rationale === undefined ? {} : { rationale: revised.rationale }),
  steps: nonEmpty([...head, ...revised.steps]) ?? revised.steps,
})

/**
 * The plan with nothing left to come: `head`, and the tail that run was going to
 * replace dropped.
 *
 * What the composer answering *the work is already done* leaves behind. `revise`'s
 * opposite number — same head, no steps after it — so the entry reads as run and the
 * plan has run out, which is the one route to `Finished`.
 *
 * **The title is the one the plan already has, never one invented here**: the work did
 * not change, only the reading of what is left of it. A trak whose very first compose
 * answers this way has no plan to take one from, and `asked` is the request it was
 * opened with — the sentence its surfaces already draw for a trak that has no title.
 */
export const ended = (p: Plan | undefined, asked: string, head: readonly Step[]): Plan => ({
  title: p?.title ?? asked,
  ...(p?.rationale === undefined ? {} : { rationale: p.rationale }),
  // Never empty: the head ends with the entry the run that answered landed on.
  // Answered rather than asserted, for the reason `nonEmpty` says.
  steps: nonEmpty(head) ?? [{ type: "compose" }],
})

/**
 * A rebuilt entry list, as the non-empty type a plan holds.
 *
 * `undefined` is the compiler's question rather than the domain's: every caller here
 * builds a list with something in it by construction. Answered rather than asserted,
 * because an assertion is the one thing this repository does not allow.
 */
export const nonEmpty = (list: readonly Step[]): Plan["steps"] | undefined => {
  const [first, ...rest] = list
  return first === undefined ? undefined : [first, ...rest]
}

/** An entry the engine wrote because something asked, rather than one the composer proposed. */
const isAsk = (s: Step | undefined): boolean =>
  s !== undefined && isCompose(s) && s.why !== undefined

/**
 * The plan with the composer's outstanding ask standing in it, at `at`.
 *
 * **The ask is an entry from the moment it is made, not from the moment its run lands.**
 * A plan that showed nothing for a composer already working left every surface pointing
 * at the *previous* compose — reading as a trak that had gone backwards — until the turn
 * came back. The entry is what that run fills in: `landCompose` writes its session into
 * the slot here rather than appending beside it.
 *
 * `at` is the join, and passing anything else is a caller's bug: the entries before it
 * ran and are never touched, and the ones after it are guesswork this ask is about to
 * replace. They are kept all the same, because the ask can still be withdrawn and
 * because the composer is shown them as the tail it may hand back unchanged.
 *
 * **One ask at a time.** A second one — a person replanning at the gate an uncovering
 * artifact stopped at — replaces the entry rather than queueing behind it, matching the
 * single field it stands for. The one press that lands *off* a gate carries the ask it
 * displaced inside the reason it writes — see `ReconsultWhy` — so the entry here is
 * still one, and it rides to the plan, the wire and the composer unchanged.
 */
export const withAsk = (p: Plan, at: number, why: ReconsultWhy): Plan => {
  const entry: Compose = { type: "compose", why }
  const tail = p.steps.slice(isAsk(p.steps[at]) ? at + 1 : at)
  return { ...p, steps: nonEmpty([...p.steps.slice(0, at), entry, ...tail]) ?? p.steps }
}

/**
 * The plan with one turn standing in it at `at` — the second door's answer to `withAsk`.
 *
 * **The same position, and for the same reason.** A re-entry that names an agent runs
 * that turn instead of asking the composer, so the entry goes exactly where the ask
 * would have: at the end of what ran, which is `firstUnrun`. Nothing that ran is touched
 * or renumbered, so no artifact key moves; an unrun tail keeps its order behind the new
 * entry, which is what a trak abandoned mid-plan has and what `withAsk` does with it.
 *
 * **Appending at `p.steps.length` is the wrong shape**, even though for the trak this
 * exists for — a finished one, whose plan has run out — it is the same index. On a trak
 * that stopped with work still planned it would run that work first and answer the
 * person second.
 */
export const withStep = (p: Plan, at: number, step: AgentStep): Plan => ({
  ...p,
  steps: nonEmpty([...p.steps.slice(0, at), step, ...p.steps.slice(at)]) ?? p.steps,
})

/**
 * The plan with an ask taken back out, where one is still standing unrun at `at`.
 *
 * **The reason can evaporate before the turn happens.** A person who argues with the
 * artifact that raised it instead of approving it has withdrawn the question,
 * and an entry nobody will ever run must not be left for the next commit boundary to
 * walk into.
 *
 * Nothing else is touched: a composer-proposed re-cut at the join is not the engine's to
 * take back, and an ask whose run has landed holds a session and is behind the join.
 */
export const withoutAsk = (p: Plan, at: number): Plan =>
  isAsk(p.steps[at])
    ? { ...p, steps: nonEmpty([...p.steps.slice(0, at), ...p.steps.slice(at + 1)]) ?? p.steps }
    : p

/** `Finished` is the virtual step at index N — never declared, always reachable. */
export const isFinished = (i: number, p: Plan): boolean => i >= p.steps.length

export const proposal = (
  title: string,
  steps: readonly [ProposedStep, ...ProposedStep[]],
  /** Last, and absent on most of them: `ambiguityOf` reads that as `none`. */
  ambiguity?: Ambiguity,
): Proposal => Proposal.make({ title, steps, ...(ambiguity === undefined ? {} : { ambiguity }) })
