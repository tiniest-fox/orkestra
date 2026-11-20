/**
 * Which controls the trak's state offers — the only thing allowed to decide that.
 *
 * **A pure function of `TrakStateDto`, exhaustive, and never of anything else.** That is
 * `client-style`'s checklist item 5, and items 5 and 6 are one rule read from two sides:
 * there is no `gate` on the wire and there must not be, because the engine's
 * `Trak.lastGate` is its memory of the *last* gate and deliberately survives into
 * `AgentWorking` so a conversational reply can land where the conversation started. A
 * control guarded on that would be offered to a trak that had already moved on — which is
 * the failure the server's own `actRoute` docstring records paying for: `decide` rejected
 * the event as unexpected and a healthy trak went to `Failed{kind:"engine"}`.
 *
 * **A control per press, and one action still missing.** `decide` accepts a different
 * set at each gate, so one fixed pair drawn everywhere would offer, at the approval gate,
 * a `Skip` the gate refuses. An action a gate does not accept is not refused: it is settled
 * as `Failed{engine}`, so a control drawn one state too wide ends the trak. Approving,
 * answering, chatting, resuming, recomposing, asking for a filing and the three endings
 * the finished position carries are here; skipping lands here too, as its own exhaustive
 * switch, when the surface that sends it does. `archiveUnfinishedOffered` is the header
 * menu's rather than the finished position's — it is offered at every state the rest are
 * not — and `stopOffered` and `fileOffered` are the two whose subject can be a turn that is
 * *running*, which is why they read custody the other way up.
 *
 * **Two switches here are not controls**, and both are here because they are the same
 * shape and would drift if they were not: `finishedPosition` says which ending a plan ran
 * out into, and `destinationAsked` gates the merge preview's `enabled`. Neither draws a
 * press, and `destinationAsked` is deliberately *wider* than the press it looks like — see
 * its own note before reaching for `mergeOffered` instead.
 *
 * **The three endings are the case where the *route* refuses rather than `decide`**, and
 * that is not a reason to draw them wider. `mergeRoute` and `closeRoute` re-check the
 * state and answer `409 NotFinished`, so the cost of a stale press is a sentence rather
 * than a dead trak — but a press offered at a state a person is *looking at* is a lie
 * about what the trak can do, and the three switches below are what stop it.
 *
 * **Custody is never inside a switch, and two of these compose it afterwards.** Whether
 * somebody is *already driving* is a fact about the run rather than about the state, it
 * lives on `custody.holder`, and for a press that is the acting hook's guard — see
 * `useApprove`. `chatClosed` and `stopOffered` take it as an argument, as
 * `format/interrupted.ts`'s `runInterrupted` does, because what they answer is genuinely about both: a crashed run stays `AgentWorking`
 * with nobody holding it, and *that pair* is the whole of what interrupted means — and
 * the whole of what separates a turn there is no point stopping from one there is. The
 * switch stays pure and the composition is one line above it.
 */

import type { TrakStateDto } from "../../api/types"

/**
 * The six kinds `AwaitingHuman` carries. Narrowed out of the state rather than named on
 * the wire: `api/types` takes a name when something imports it, and a second export for
 * a field one function switches over would be that rule going the wrong way.
 */
type Gate = Extract<TrakStateDto, { readonly _tag: "AwaitingHuman" }>["kind"]

/**
 * Whether `decide` accepts somebody saying something here.
 *
 * **Two tags, and six gate kinds inside one of them.** `AwaitingProposal` takes `Chat`
 * and re-runs the composer on its own session; every `AwaitingHuman` kind takes it, all
 * six, because `onHumanAction` does not branch on the kind — whatever you say resumes
 * the session of whoever just spoke, which is the one rule the whole gate vocabulary is
 * built on.
 *
 * **`AwaitingComposerAnswers` is the near-miss, and it is the `false` this function
 * exists for.** It is a human standing in front of the composer, one state over from the
 * plan gate, and it is drawn on the same row by the same component — but
 * `onComposerAnswers` takes `AnswerQuestions` and nothing else, so a `Chat` there is
 * settled as `Failed{kind:"engine"}`. It ends the trak rather than being refused.
 */
export const chatAccepted = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingProposal":
    case "AwaitingHuman":
      return true

    case "Preparing":
    case "Composing":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a message sent now is kept for the agent — the states the engine is carrying
 * the trak through on its own, where a send is neither a gate's chat nor a refusal.
 *
 * The engine writes such a message down as waiting and the running turn reads it, or
 * the next turn that starts does, or it is the chat at the gate the trak parks at. So
 * this is `true` at every state with something of that kind ahead of it: a turn, a
 * check, and the bookkeeping between two of them — which has to be here too, or the
 * field would shut and take the cursor with it each time a step handed over to the next.
 *
 * **The gates are `false` because they have their own answer** — `chatAccepted` — and a
 * send there is a chat that starts a turn. `AwaitingChildren` is `false` because the
 * pieces are who is working and each has a bar of its own. The three endings are
 * `false` because the trak is being put away, and `Failed` because nothing is ahead of
 * it until a person decides so.
 *
 * Read with custody by `chatClosed`, never alone: a crashed run stays `AgentWorking`
 * with nothing to hear a message until somebody resumes it.
 */
export const messageKept = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
      return true

    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AwaitingHuman":
    case "AwaitingChildren":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a send now would be refused as a second drive: something holds the trak, at a
 * state that keeps no message. Wider than `chatClosed` at a gate, which stays open with
 * custody held so the field keeps its cursor while a drive lets go: this still refuses
 * there, and the bar disables the send on it alone. The send hook guards on it too, so a
 * control that forgot to read `disabled` still cannot post into a refusal. No state yet
 * is the first frame of a trak still loading, which keeps nothing.
 */
export const sendBlocked = (state: TrakStateDto | undefined, running: boolean): boolean =>
  running && !(state !== undefined && messageKept(state))

/**
 * Whether the composer is standing on a question it asked.
 *
 * `AwaitingComposerAnswers` and nothing else, which makes this the exact inverse of the
 * near-miss `chatAccepted` documents: the one state that refuses a `Chat` is the one state
 * this offers. `onComposerAnswers` takes `AnswerQuestions` alone, so nothing else on this
 * switch may be `true` — a `Chat` there ends the trak and an `AnswerQuestions` anywhere
 * else is the same mistake with the actions swapped.
 */
export const composerAwaitsAnswers = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingComposerAnswers":
      return true

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * The one gate where a step has questions on the table.
 *
 * A switch rather than an equality, for `hasFiled`'s reason: a sixth gate kind must be a
 * compile error here rather than a form that silently stops being offered — or, worse, one
 * that starts being.
 */
const hasAsked = (gate: Gate): boolean => {
  switch (gate) {
    case "answers":
      return true

    case "approval":
    case "checks":
    case "conversation":
    case "stuck":
    case "permission":
      return false
  }
}

/**
 * Whether a step is standing on a question it asked.
 *
 * **Two switches for one action, because the two gates are two states** — the same split
 * `planAwaitsApproval` and `workAwaitsApproval` take, and for the same reason: the composer
 * re-runs on its own session where a step re-enters at the index its state is holding, and
 * one predicate over both would put the form on screen with nothing saying which of the two
 * it belongs to.
 *
 * **Narrower than `decide` accepts, deliberately, and it is the one control here that
 * is.** `onHumanAction` routes `AnswerQuestions` at every one of the six kinds without a
 * gate check — so unlike an approval at an `answers` gate, this is not a press that ends
 * the trak. What it would do instead is worse in a quieter way: it re-enters the step with
 * `Triggers.answers`, and a template that numbers answers against questions nobody asked
 * hands the agent a list joined to nothing. The `answers` kind is the only one with
 * questions on the table, and it is what the surface below actually draws a form beside.
 */
export const workAwaitsAnswers = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingHuman":
      return hasAsked(state.kind)

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/** The one gate where a step asks to run a refused command. A switch, for `hasFiled`'s reason. */
const asksPermission = (gate: Gate): boolean => {
  switch (gate) {
    case "permission":
      return true

    case "approval":
    case "answers":
    case "checks":
    case "conversation":
    case "stuck":
      return false
  }
}

/**
 * Whether a step is standing on a request to run a command the CLI refused — where Allow
 * and Refuse are offered. `decide` takes `Permit` at that gate alone and settles it
 * `Failed{engine}` anywhere else, so this is exactly as wide as the one kind.
 */
export const workAwaitsPermission = (state: TrakStateDto): boolean =>
  state._tag === "AwaitingHuman" && asksPermission(state.kind)

/**
 * Why the chat bar is closed, in a sentence — or `undefined` when it is open.
 *
 * **A bar is not a button, which is why this answers with a sentence rather than a
 * boolean.** A press that does not apply is simply absent, and an absent button raises no
 * question; the bar is chrome, on screen at every state, so somebody who cannot type in
 * it is owed the reason. The placeholder is where a field says things about itself.
 *
 * **Four closings, and the order is the order they are worth hearing.** Custody first:
 * *something is driving this* is true of a turn this tab started, a second tab, and a
 * `pnpm ork` in a terminal, and it is the only one of the four that will clear on its
 * own — **and it closes nothing where `messageKept` holds**, which is a turn or a check
 * running: the bar is open there, and what is sent waits for the agent. **Nor at a gate**,
 * where custody is held across the moment a drive lets go: the engine appends the gate
 * and publishes the release as a frame after it, and a field shut for that one frame is
 * a disabled textarea, which a browser blurs — the cursor of somebody typing through the
 * turn, gone and never given back. The send is still refused there; `sendBlocked` is
 * the half that answers that, and the bar disables the button alone on it. Then the
 * composer's question gate, which is the one closing that has somewhere
 * to send you. Then the rest of the states, which is the answer for a trak that is
 * finished or failed — and for a run that crashed, where nobody holds custody and the
 * state still reads `AgentWorking`. Then where you are standing, which is the only one
 * that is about the reader rather than the trak: the message would land at the position
 * the *engine* is at, never at the one on screen, so the bar closes rather than sending
 * somewhere else.
 *
 * **`AwaitingComposerAnswers` is split out of *nothing is being asked here*, which is
 * the one sentence in this file that was false.** It is the state with a question card
 * on screen directly above the bar, so the generic closing read as the surface
 * contradicting itself — and it is the only closing with a remedy, because the form on
 * that card is what the gate accepts.
 */
export const chatClosed = (
  state: TrakStateDto,
  /** Whether the row on screen is the one the trak is being asked about. */
  atGate: boolean,
  /** `custody.holder !== undefined` — asked by the caller, for `planAwaitsApproval`'s reason. */
  running: boolean,
): string | undefined => {
  if (running && messageKept(state)) return undefined
  if (running && !chatAccepted(state)) return "Something is driving this trak"
  if (composerAwaitsAnswers(state)) return "Answer the questions above"
  if (!chatAccepted(state)) return "Nothing is being asked here"
  if (!atGate) return "The trak is not waiting here"
  return undefined
}

/**
 * Whether the state is one an agent turn runs in — the two positions a stop can reach.
 *
 * `Composing` is `true` here and narrowed by the caller, because whether there is a plan
 * to wait beside is not a fact about the state. See `stopOffered`.
 *
 * **`CheckRunning` is the near-miss and it is `false`.** It looks like `AgentWorking` on
 * screen — something is going, and it is going at a step — but what is in flight is a
 * shell script, which is why the engine gives it a state of its own. `Effecting` is the
 * same near-miss one hook later. `Spawning`, `Joining`, `Committing`, `Integrating` and
 * the three endings are the same answer for the same reason: git and bookkeeping, with
 * no gate for a stop to leave the trak at.
 * `AwaitingChildren` is `false` and is the case worth stating — a parent holds no turn of
 * its own while it waits, and a piece is stopped on the piece.
 */
const turnInFlight = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Composing":
    case "AgentWorking":
      return true

    // The press is taken: a kill is in flight, with a gate to land at.
    case "Stopping":
    case "Preparing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a person is being offered the stop — kill the turn in flight and park the trak
 * where they can say what they want instead.
 *
 * **Three facts, and none of them is enough alone**, which is why the switch stays a
 * question about the wire union and the composition sits here:
 *
 *   · the state is one an agent turn runs in — `turnInFlight` above;
 *   · **something is actually driving it.** A crashed run stays `AgentWorking` with
 *     nobody holding it, and there is no turn there to interrupt; what that wants is
 *     `runInterrupted`'s press, and the two are exactly complementary at that state;
 *   · **a composer has a plan behind it.** The trak parks at the plan gate, whose whole
 *     meaning is *a plan is on the table* — so a trak whose *first* plan is being written
 *     has nowhere for a stop to leave it, and the route refuses one. Abandoning is the
 *     way out of that.
 *
 * Read `hasPlan` off `TrakDetailDto.plan`, which is a fact about the trak rather than
 * about the state — the same shape `chatClosed` and `runInterrupted` take custody in, and
 * for the same reason: putting it inside the switch would make the exhaustive half stop
 * being a statement about the union.
 *
 * **Whether the turn has spawned yet is not one of them.** The engine accepts a press
 * before the run record exists and cancels the pending spawn, which under a sandbox can
 * be minutes of waking it and copying the session in — so the press is drawn across that
 * window rather than refused inside it.
 *
 * **`Stopping` is `false`**: the press was taken, and `stopTaken` is what draws it so.
 */
export const stopOffered = (
  state: TrakStateDto,
  /** `custody.holder !== undefined` — asked by the caller, for `planAwaitsApproval`'s reason. */
  running: boolean,
  /** `trak.plan !== undefined`, for the trak the press would act on. */
  hasPlan: boolean,
): boolean => running && turnInFlight(state) && (state._tag !== "Composing" || hasPlan)

/**
 * Whether a stop was pressed and the engine is still ending the turn — where the press is
 * drawn taken, busy and not pressable, rather than offered again or gone. Custody beside
 * it for `stopOffered`'s reason: a `Stopping` nobody drives is `runInterrupted`'s, and its
 * resume finishes the kill.
 */
export const stopTaken = (state: TrakStateDto, running: boolean): boolean =>
  running && state._tag === "Stopping"

/**
 * Whether a step is parked at a gate with nothing filed — a conversation it replied in, a
 * question it asked, or an account of why it is stuck.
 *
 * **The gates with no document card**, which is what makes it its own switch: at these the
 * two break-out presses sit beside the chat bar, where at the two gates with a document on
 * the table they are welded into that card's header. So the page has to be able to ask
 * *these gates and not the other two*. `decide`'s `skippable`, read the other way up — the
 * same one fact that decides `Skip` is offered and `File it` is. A switch over the kind
 * rather than an equality, for `hasFiled`'s reason.
 */
export const unfiledGate = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingHuman":
      return unfiled(state.kind)

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

const unfiled = (gate: Gate): boolean => {
  switch (gate) {
    case "answers":
    case "conversation":
    case "stuck":
    case "permission":
      return true

    case "approval":
    case "checks":
      return false
  }
}

/**
 * Whether the state is a step's own turn running — the one position a filing can be
 * asked of mid-flight.
 *
 * **`Composing` is the near-miss and it is `false`**, where `turnInFlight` has it `true`:
 * a composer has no document to be made to file, and the route answers a press there
 * `409 NothingToStop`. Everything `turnInFlight` refuses is refused here for its reasons.
 */
const stepTurnInFlight = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AgentWorking":
      return true

    // A stop is under way, and the turn a filing would ask is the one being killed.
    case "Stopping":
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a person is being offered the filing — ask the step for what it has, now.
 *
 * **Two places, and custody decides the opposite way at each**, which is why the switches
 * stay pure and the composition is one line here. With something driving, the only
 * position the route takes is a step's own turn: it kills the turn and re-enters the step
 * told to file, so like `stopOffered` it exists *because* something is running — a crashed
 * run stays `AgentWorking` with nobody holding it, and what that wants is the resume. With
 * nothing driving, the positions the route takes are the step gates where nothing is filed
 * — a conversation it parked in, a question it asked, an account of why it is stuck — where
 * there is nothing to kill and the step is simply re-entered to settle what is open and
 * file. The route refuses a drive already under way at one of those with `409 Driving`, so
 * the press is withheld rather than drawn and refused. The two document gates are not among
 * them: a filing there has nothing to ask for, and `unfiledGate` is what leaves them out.
 *
 * **The engine knows one thing more, exactly as it does for the stop**: a turn is recorded
 * a moment after the state says one has begun, and a press inside that window is refused
 * `NothingToStop`. `useFile` renders the sentence.
 */
export const fileOffered = (
  state: TrakStateDto,
  /** `custody.holder !== undefined` — asked by the caller, for `planAwaitsApproval`'s reason. */
  running: boolean,
): boolean => (running ? stepTurnInFlight(state) : unfiledGate(state))

/**
 * Whether a person is being offered the recompose — send the composer your words from
 * where the step stands, keeping whatever it has filed.
 *
 * **Two places, and custody decides the opposite way at each — the shape `fileOffered`
 * takes, and for the same reason.** With nothing driving, every step gate: `decide`
 * accepts `Replan` at all six kinds and refuses it at none, so unlike `workAwaitsApproval`
 * this does not narrow by kind. The route is `/act` with `startDrive`, which refuses a
 * drive already under way — so a gate with something else driving withholds it, which is
 * why custody is in the predicate here rather than only in the hook. With something
 * driving, the one position the route takes over is a step's own turn: a recompose mid-turn
 * kills it, keeps the work, and hands the composer the reason. What differs by kind is what
 * the press does first, which the sheet says in words, and where it is drawn — welded into
 * a document card, or beside the bar — which the page decides off `unfiledGate` and whether
 * an artifact is the newest thing.
 *
 * **The composer's own two gates are the near-misses**: `AwaitingProposal` takes `Approve`
 * and `Chat`, `AwaitingComposerAnswers` takes `AnswerQuestions`, and a `Replan` at either
 * is settled `Failed{engine}`.
 */
export const recomposeOffered = (
  state: TrakStateDto,
  /** `custody.holder !== undefined` — asked by the caller, for `planAwaitsApproval`'s reason. */
  running: boolean,
): boolean => (running ? stepTurnInFlight(state) : atStepGate(state))

/** Whether the state is any of a step's six gates — every kind `Replan` is accepted at. */
const atStepGate = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingHuman":
      return true

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a person is being asked to approve the composer's plan.
 *
 * `AwaitingProposal` and nothing else. `AwaitingComposerAnswers` is the composer's *other*
 * gate and looks adjacent — a human standing in front of the composer's output — but it
 * accepts an answer and refuses an approval, which is exactly the one-state-too-wide
 * mistake above.
 */
export const planAwaitsApproval = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingProposal":
      return true

    case "Preparing":
    case "Composing":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/** The gates where the step has filed something there is to take — `decide`'s `skippable`, the other way up. */
const hasFiled = (gate: Gate): boolean => {
  switch (gate) {
    case "approval":
    case "checks":
      return true

    case "answers":
    case "conversation":
    case "stuck":
    case "permission":
      return false
  }
}

/**
 * Whether a person is being asked to take what a step filed.
 *
 * **Two switches for one press, because the two gates are two states.** The plan gate and
 * the step gate both accept `Approve` and mean different things by it — one enters the
 * plan at its resume point, the other advances past the step whose work is on the table —
 * and `HumanActed` carries the step index the state is holding. One predicate over both
 * would put the press on screen with nothing saying which of the two it belongs to.
 *
 * **Four of the six kinds refuse it, and refusing is not what they do.** `decide`
 * settles an approval at an `answers`, `conversation`, `stuck` or `permission` gate as
 * `Failed{kind:"engine"}` — nothing has been filed to take, so approving would advance
 * past work that has not happened. What those four are offered is `Skip`, which routes
 * identically and records the different fact.
 *
 * `checks` is the one that looks like it should be false and is not: an artifact *is* on
 * the table and a declared check disagrees with it, so approving is taking it anyway.
 * `decide` reads both questions off one predicate for that reason — see `skippable`.
 */
export const workAwaitsApproval = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "AwaitingHuman":
      return hasFiled(state.kind)

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a failed trak is being offered the restart.
 *
 * **A second predicate rather than a widening of `runInterrupted`**, whose note in
 * `format/interrupted.ts` is correct and stays: a failure is a trak the engine wrote an ending for, not one whose
 * process vanished, and what a reader is told about the two is different. Where the press
 * goes is not — both are drawn inside the same notice, beside the sentence saying what
 * happened, at the position the trak stopped on. They are never both true, so the notice
 * asks each in turn and takes whichever answers.
 *
 * The route behind both is `POST /resume`, which `decide` accepts from `Failed` through
 * `failedFrom` — so this widens where the press is *offered*, not what the engine takes.
 *
 * Custody as an argument, for `runInterrupted`'s reason: a trak somebody is already
 * driving must not be handed a second drive, and that is a fact about the run.
 *
 * **A merge git refused is the one failure with no restart on a notice.** Its way out is
 * the finishing card's own Merge press, which `finishedPosition` keeps drawn there — a
 * second press on a notice would be the same `Restarted` under a different name.
 */
export const restartOffered = (state: TrakStateDto, running: boolean): boolean => {
  switch (state._tag) {
    case "Failed":
      return !running && !mergeRefused(state)

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * A merge git refused: `Failed`, narrowed to the one kind whose trak is still finished.
 * The work is on its branch and the checkout is held, exactly as at `Finished`; what
 * failed is the last hop, and git's own sentence is on `error`.
 */
export type RefusedMergeDto = Extract<TrakStateDto, { readonly _tag: "Failed" }> & {
  readonly kind: "merge"
}

/**
 * An archive that did not finish: `Failed`, narrowed to the kind that stopped after a
 * person pressed Merge, Close or Abandon. `archiving` says which.
 */
export type ArchiveFailedDto = Extract<TrakStateDto, { readonly _tag: "Failed" }> & {
  readonly kind: "archive"
}

/**
 * The states the finished position is drawn in — the five a trak reaches by running its
 * plan out, and the two failures that leave it there — narrowed so everything downstream
 * switches over six tags instead of twenty.
 */
export type EndStateDto =
  | Extract<
      TrakStateDto,
      { readonly _tag: "Finished" | "Merging" | "Closing" | "Merged" | "Closed" }
    >
  | RefusedMergeDto
  | ArchiveFailedDto

/**
 * A type guard rather than a `kind ===` at each site: narrowing a property does not narrow
 * the object it is read off, so a switch that wants to *return* the state as a
 * `RefusedMergeDto` has to be told by a predicate.
 */
const mergeRefused = (
  state: Extract<TrakStateDto, { readonly _tag: "Failed" }>,
): state is RefusedMergeDto => state.kind === "merge"

/** `mergeRefused`'s twin, for `ArchiveFailedDto`. */
export const archiveFailed = (state: TrakStateDto): state is ArchiveFailedDto =>
  state._tag === "Failed" && state.kind === "archive"

/**
 * Whether the plan has run out, and which ending it ran out into.
 *
 * **Five states, not the three the design named.** `Merging` and `Closing` are the same
 * two endings with a command in flight, and leaving them out is what would make the
 * position appear the moment a merge starts and vanish again while it runs — a row that
 * pops is a surface disagreeing with itself for as long as a `git merge` takes.
 *
 * **`Abandoned` and `Failed` are not endings of a plan**, which is why they get no
 * position at all: a human ended one mid-flight and the other died, so *the plan ran out
 * and the work is on its branch* would be false on both. `Integrating` and `Abandoning`
 * are the commands that lead into them and are equally not at rest.
 *
 * **Except two failures that happen after the plan, which are the sixth and seventh.**
 * `Failed{merge}` is a finished trak whose last hop was declined: the plan did run out,
 * the work is on its branch and the checkout is held, so the sentence is true and the
 * card is drawn — with the refusal above it, and the Merge press still on it.
 * `Failed{archive}` is a trak a person already ended with Merge, Close or Abandon, whose
 * checkout did not go away; its notice is drawn on this row because that is where the
 * press was made. It is its own ending throughout, not `Finished` with a failure on it:
 * after an abandon the plan did *not* run out, and nothing offers a merge from it. The
 * other kinds stopped somewhere in the plan and keep the notice at the position they
 * stopped on.
 *
 * Returns the state rather than a boolean: the words, the presses and the mark all switch
 * over which ending it is, and a caller re-narrowing a tag it has already been told is one
 * `_tag ===` away from asking about a state this function excluded.
 */
export const finishedPosition = (state: TrakStateDto): EndStateDto | undefined => {
  switch (state._tag) {
    case "Finished":
    case "Merging":
    case "Closing":
    case "Merged":
    case "Closed":
      return state

    case "Failed":
      return mergeRefused(state) || archiveFailed(state) ? state : undefined

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Abandoned":
      return undefined
  }
}

/**
 * Whether a person is being offered the merge.
 *
 * `Finished`, and a merge git refused — `mergeRoute` takes both, issuing `Merged` from
 * the first and `Restarted` from the second, and re-checks the state, so a press one
 * state wide is a `409 NotFinished` rather than an event. `Merging` is the press already
 * in flight and is deliberately false: a second one would race a `git merge`.
 *
 * **Two facts narrow it further and neither belongs here**: a pull request on the branch,
 * and a branch nothing was committed to. Both are about the work rather than about the
 * state — the state is `Finished` either way, by design — so `FinishedView` `&&`s them at
 * the call site. The route still takes a merge in both cases, which is deliberate: only
 * the on-screen press goes.
 */
export const mergeOffered = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Finished":
      return true

    case "Failed":
      return mergeRefused(state)

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Whether *where this would go* is still a live question.
 *
 * **Not a control, and the one thing here that is deliberately wider than a press.** It
 * gates the merge preview's `enabled`, and `Merging` is why it is its own switch rather
 * than `mergeOffered`: the merge is running into that branch right now, so the card has a
 * destination to draw and nothing else can tell it what it is. A preview cached from the
 * press survives in the query cache, so gating it on the press made the destination true
 * only in the tab that pressed and `…` on every reload.
 *
 * **`Merged` is false, and that is the point of stopping at two.** The route answers
 * *where a merge would go*, which a merge that has already happened has no answer to —
 * `arrowEnd` draws the commit it went in as instead, and a terminal trak polling a route
 * about somebody else's checkout would be asking a question nothing reads.
 *
 * A branch nothing was committed to is the same argument reached from the other side, and
 * `useFinishing` composes it on for `mergeOffered`'s reason: the card draws no right-hand
 * side there, so the question has nowhere to land.
 */
export const destinationAsked = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Finished":
    case "Merging":
      return true

    // A refused merge is still going somewhere: the card names it and the press is
    // labelled by it, and the id it answers with is the parent the refusal names.
    case "Failed":
      return mergeRefused(state)

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Whether a person is being offered the archive — put the trak away, deleting its
 * checkout, its branch and the branch's copy on the forge.
 *
 * The same one state as `mergeOffered`, and its own switch rather than a shared predicate:
 * they are two routes with two refusals, and *what a trak that is done does* is a
 * different question from *where its work goes*.
 *
 * **That day came and the split is what paid for it.** A finished trak whose branch never
 * moved is offered Close and not Merge, and the two switches did not have to be pulled
 * apart to say so: the state is `Finished` for both, this one stays `true`, and the fact
 * that removes the merge is composed onto `mergeOffered` at the call site.
 */
export const archiveOffered = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Finished":
      return true

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether a person is being offered the archive of a trak that has not finished — the
 * same word and the same deletion as `archiveOffered`, and the only press here that
 * reaches a `claude` still running.
 *
 * **The complement of `archiveOffered`, near enough that the near-misses are the whole
 * switch.** `decide` accepts `Abandoned` from every state that is not at rest, and
 * `abandonRoute` re-checks it — so the four at-rest states are `false` because the server
 * says so: `Finished` has `archiveOffered` for it, with the checkout still there to look at
 * first, and the other three are over.
 *
 * **`Merging`, `Closing` and `Abandoning` are the three the engine would accept and this
 * refuses anyway.** They are an ending already running, and taking one over is the one
 * interruption with no re-run story: `Merging` runs a `git merge` **into the host's
 * checkout**, which is a different blast radius from a trak's own worktree. `Integrating`
 * is not one of them — it is the commit past the last step, on the way to `Finished`, and
 * a trak can still be given up on there.
 *
 * **`Failed` is `true`, and it is the case worth stating.** A failed trak is not at rest:
 * it sits waiting for a person, and *put it away* is one of the two things they can say.
 * The other is the restart on the notice at the position it stopped on — a different
 * surface, so the two never compete for the same row.
 *
 * Its own switch rather than `!archiveOffered(state)`, for `archiveOffered`'s own reason:
 * two routes with two refusals and two meanings, and a shared predicate moves both the day
 * one of them moves.
 */
export const archiveUnfinishedOffered = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Failed":
      return true

    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Whether a person can send the trak back for more work.
 *
 * **Every ending that has a pane offers it**, which is the three the position is drawn at.
 * `reenterRoute` takes any at-rest state — `decide` sends a re-entered trak to `Preparing`,
 * and `SetupWorktree` adopts the orphaned branch with its recorded base intact, so all of
 * them work — and the one it takes that this does not offer is `Abandoned`, which never
 * gets the position at all, so the question does not arise.
 *
 * **`Merged` is offered here**, though once the work is in the host branch more work is a
 * new trak: a merged trak is exactly the one you have a question about afterwards,
 * and offering the ask without the plan beside it would make the row you learn at
 * `Finished` a different row from the one you meet at `Merged`. The branch survives the
 * merge — `git merge --no-ff` does not delete it — so re-entering there is a checkout from
 * it again, the same as at `Closed`.
 *
 * **`FinishedView` asks this once**, for the box and for the pull-request ticks alike, so
 * turning it on at `Merged` turned the ticks on there too: a merged trak whose branch has a
 * pull request can have a failing check ticked and sent back. That is taken knowingly
 * rather than repaired with a second predicate, which risks a checkbox with nothing to
 * send it to.
 */
export const changesOffered = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Finished":
    case "Closed":
    case "Merged":
      return true

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Abandoned":
    case "Failed":
      return false
  }
}

/**
 * Whether the trak still has a checkout the opener controls could open — a terminal in
 * it, or an editor on it.
 *
 * **The state's half of a question the wire cannot answer alone.** `Trak.worktree`
 * keeps naming the checkout an archive deleted — the open route's own docstring records
 * it — so `worktree !== undefined` says a checkout *existed*, never that it still does.
 * The caller composes that presence check beside this for every state before a checkout
 * exists; this switch refuses the five states at or past the archive's teardown.
 *
 * **Not a press `decide` judges, so a state too wide cannot end the trak** — the route
 * appends nothing and answers 404 where there is nothing to open. The switch is still
 * exhaustive, because a control drawn at a state a person is looking at is a claim
 * about what the trak has, and `Closed` has no checkout to claim. Both controls read
 * this one answer: the question is the checkout, not what opens it.
 *
 * **`Merging` is `true` and `Merged` is `false`, because the teardown sits between
 * them.** `decide` accepts `WorktreeRemoved` only at `Abandoning` or `Closing`, and
 * `Merged` is one of the two states `Closing` settles into — the merge press runs the
 * archive, so a merged trak's checkout is already gone. At `Merging` the removal has
 * not been issued yet, and the checkout is still there to open.
 */
export const openersOffered = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Finished":
    case "Merging":
    case "Failed":
      return true

    case "Abandoning":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Whether the run mode and the one-shot hold are on offer — the trak still has a next
 * gate for either to decide.
 *
 * **The engine's `atRest`, the other way up.** `modeRoute` and `holdRoute` refuse the four
 * at-rest states `409 AtRest` and take every other, `Failed` among them: a failed trak
 * picked back up runs on to a gate, and the mode read there is whatever was set. So the
 * control is drawn wherever the trak is not over — wherever there is a next gate, and not
 * at all once finished. Whether the hold is *offered* inside it is a fact about `mode`
 * rather than about the state, and the picker composes it.
 *
 * **Not narrowed by custody.** These are the two presses meant to land while a turn is
 * running — the route takes no drive and kills nothing — so `running` is not asked here
 * and must not be composed on by the caller.
 */
export const modeSettable = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Failed":
      return true

    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Whether auto-merge can be turned on or off — the engine's `archived`, the other way up.
 * `autoMergeRoute` refuses the three endings and the two archives on the way to them and
 * takes every other state, `Finished` among them: deciding to merge on green after reading
 * the result is what the switch is for. So the picker is drawn at `Finished` too, holding
 * this one row. A child has no pull request of its own; the caller withholds it there.
 *
 * Not narrowed by custody, for `modeSettable`'s reason.
 */
export const autoMergeSettable = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Merging":
    case "Failed":
    case "Finished":
      return true

    case "Closing":
    case "Abandoning":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Whether the one-shot hold has a step to hold — every settable state but the six with
 * nothing a person can be asked about: a spawn's three, and the three past the last stop.
 *
 * A spawn has no human gate on any mode, so a switch reading *Hold · this step* there
 * would name a step that cannot be held; the engine passes a pending hold over a spawn to
 * the first entry after it that has a gate. `Merging`, `Closing` and `Abandoning` are past
 * every stop — the terminal state spends a press made there with nothing stood at.
 * `Integrating` is offered: on a child it is where the ending is decided, and a hold there
 * holds the child at `Finished`. Composed on `modeSettable` by the caller, which is the
 * only place the two are asked together.
 */
const UNHOLDABLE: ReadonlySet<TrakStateDto["_tag"]> = new Set([
  "Spawning",
  "AwaitingChildren",
  "Joining",
  "Merging",
  "Closing",
  "Abandoning",
])
export const holdOffered = (state: TrakStateDto): boolean => !UNHOLDABLE.has(state._tag)

/**
 * Whether the one-shot skip has a check run ahead of it to arm — every settable state
 * but the four with none: `Integrating`, where the plan has run out, and the three past
 * the last stop. Offered while a spawn's children run, unlike the hold: the switch arms
 * whatever `RunChecks` is issued next, and the next one after a spawn is a later step's.
 * Composed on `modeSettable` by the caller, as `holdOffered` is.
 */
const UNSKIPPABLE: ReadonlySet<TrakStateDto["_tag"]> = new Set([
  "Integrating",
  "Merging",
  "Closing",
  "Abandoning",
])
export const skipChecksOffered = (state: TrakStateDto): boolean => !UNSKIPPABLE.has(state._tag)

/**
 * Whether a person is being offered the end of the check that is running — the same
 * route as the stop, on the one script state that has a gate to land at.
 *
 * Custody the other way up, for `stopOffered`'s reason: there is nothing to end unless
 * something is driving, and a crashed `CheckRunning` wants the resume. The engine refuses
 * a cancel nothing of its own is driving with the same `409 NothingToStop`, so this and
 * that route agree.
 */
export const cancelChecksOffered = (
  state: TrakStateDto,
  /** `custody.holder !== undefined` — asked by the caller, for `stopOffered`'s reason. */
  running: boolean,
): boolean => running && state._tag === "CheckRunning"
