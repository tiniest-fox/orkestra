/** The `actions` slice's routes: starting a trak, and every press on one that moves it. */

import { Schema } from "effect"
import {
  CreatedDto as CreatedSchema,
  MergePreviewDto as MergePreviewSchema,
} from "@orkestra/shared/dto/actions"
import { withAttachments } from "./attachments"
import { get, post, trakPath } from "./http"
import type {
  CreatedDto,
  MergeMethodRequestDto,
  MergePreviewDto,
  PlanEditsDto,
  RunModeDto,
} from "./types"

const decodeCreated = Schema.decodeUnknownSync(CreatedSchema)
const decodeMergePreview = Schema.decodeUnknownSync(MergePreviewSchema)

/**
 * `POST /api/traks`. **Spends money**: a real `claude` runs the moment this answers —
 * the composer, or the named agent's first turn.
 *
 * `agent` is one of `listAgents`' names, and omitting it is the ordinary case: the
 * composer plans the trak. Naming one starts the conversation instead, with the trak
 * born holding a one-entry plan that runs it.
 *
 * `mode` says how much of it the person wants to stand at, and is sent always rather
 * than omitted for the default: the engine reads absent as `manual`, and a screen that
 * held a choice and then said nothing about it would be two ways of asking for one
 * thing.
 *
 * `model` is the opposite case and is sent only when a person pressed one: absent means
 * the agent file's own, which is what every door but New Chat asks for and what New Chat
 * asks for until a tile is pressed. It goes with `agent` — the engine refuses one sent
 * alone — and it is one of `listModels`' names.
 *
 * `attachments` are the ids `uploadAttachment` answered with, for the files the
 * description arrived with; the engine places each in the new checkout.
 *
 * Answers `202` with the id and nothing else — the drive was forked, so there is no
 * state yet that is not a guess. Uncommitted work in the host tree is no refusal: the trak
 * branches from the last commit and leaves it where it is.
 */
export const createTrak = async (
  description: string,
  agent: string | undefined,
  mode: RunModeDto,
  model: string | undefined,
  autoMerge: boolean,
  attachments: readonly string[],
): Promise<CreatedDto> =>
  decodeCreated(
    await post("/api/traks", {
      description,
      mode,
      ...(agent === undefined ? {} : { agent }),
      ...(model === undefined ? {} : { model }),
      // Off is absent, which is what a caller that has never heard of it sends.
      ...(autoMerge ? { autoMerge } : {}),
      ...withAttachments(attachments),
    }),
  )

/**
 * `POST /api/traks/:id/act` with `Approve`. **Spends money**: taking what is on the table
 * enters the next position, which is a real `claude` — a plan's first step, or the step
 * after the one whose work was just approved.
 *
 * The gate it applies at is the server's to decide, not this file's — the route replays
 * the log and reads the gate off `state` via the domain's own `asGate`, so a stale client
 * pressing a button the trak has moved past gets `409 NotParked` rather than an event
 * `decide` would settle as `Failed{engine}`. `409 Driving` is the other one, and it is
 * what a second press races into.
 *
 * `edits` is what a person changed about a proposed plan before taking it, at the plan
 * gate only. The engine checks them before it appends anything: `409 ProposalMoved` where
 * the composer has answered again since, `422 PlanRefused` with the sentence where the plan
 * they leave breaks a rule.
 *
 * Answers `202` with the id, which the caller already has — so this returns nothing. The
 * drive was forked, so there is no state yet that is not a guess; what the screen does
 * next is the stream's business.
 */
export const approve = async (id: string, edits?: PlanEditsDto): Promise<void> => {
  await post(
    `${trakPath(id)}/act`,
    edits === undefined ? { action: "approve" } : { action: "approve", edits },
  )
}

/**
 * `POST /api/traks/:id/act` with `Chat`. **Spends money**: whatever is said resumes the
 * session of whoever last spoke, which is a real `claude`.
 *
 * The same route and the same two 409s as `approve`, and the same reason there is no
 * step in the body: the server reads the gate off `state` and takes the position from it,
 * so a client that has fallen behind is refused rather than landing an event at the wrong
 * index. Which position it reaches is therefore not this file's to say, and not the
 * caller's either.
 *
 * `attachments` are upload ids, as `createTrak` takes them.
 *
 * Answers `202` with the id the caller already has, so this returns nothing — what the
 * screen does next is the stream's business.
 */
export const sendChat = async (
  id: string,
  message: string,
  attachments: readonly string[],
): Promise<void> => {
  await post(`${trakPath(id)}/act`, { action: "chat", message, ...withAttachments(attachments) })
}

/**
 * `POST /api/traks/:id/act` with `AnswerQuestions`. **Spends money**: the answers resume
 * the session of whoever asked, which is a real `claude`.
 *
 * **Positional, and free prose.** `AnswerQuestionsActionDto` carries a bare list of
 * strings — no question id, no option index, no shorthand the engine expands — and
 * `composer-answers.md` renders it as a numbered list against the questions the agent
 * still has in its session. So the nth string answers the nth question and the numbering
 * is the only thing joining them, which is why the tuple is non-empty at the type level
 * and why a caller must send exactly one entry per question, in order.
 *
 * An option's `label` is what a picked answer sends. `QuestionOptionDto` is a suggestion
 * the agent wrote to narrow the answer space rather than close it — `system/questions-shape.md`
 * writes the contract assuming the caller adds its own escape hatch — so a picked label
 * and a typed sentence go over the same field, and one can be edited into the other.
 *
 * **`note` is not one of them.** It is the one thing a person may send that answers no
 * question — a thought framing the whole round — and the engine renders it under a
 * heading of its own rather than as another number. Omitted from the body when there is
 * none, so a send without one is the request this route took before the field existed.
 *
 * The same route and the same two 409s as `approve`, and the same reason there is no step
 * in the body: the server reads the gate off `state` and takes the position from it.
 *
 * Answers `202` with the id the caller already has, so this returns nothing.
 */
export const answer = async (
  id: string,
  answers: readonly [string, ...string[]],
  note?: string,
): Promise<void> => {
  await post(`${trakPath(id)}/act`, {
    action: "answer",
    answers,
    ...(note === undefined ? {} : { note }),
  })
}

/**
 * `POST /api/traks/:id/act` with `Permit`. **Spends money**: either answer resumes the
 * session of the step that asked, which is a real `claude`.
 *
 * **No command in the body.** The engine quotes the one the step named, off the log, so a
 * yes allows exactly what was asked whatever this screen drew. The same route and the same
 * two 409s as `approve`.
 */
export const permit = async (id: string, granted: boolean): Promise<void> => {
  await post(`${trakPath(id)}/act`, { action: "permit", granted })
}

/**
 * `POST /api/traks/:id/resume`. **Spends money** wherever a position implies a command:
 * re-issuing it re-runs whatever was in flight when the process died, which is a real
 * `claude` at every step position.
 *
 * **An empty body, and the absent field is the point.** `sessionId` is optional on the
 * wire and this never sends one: an interrupted turn has to carry on where it was, and
 * only the drive — inside the server, after this request is answered — can say which
 * session that was. A client naming one would be guessing at a fact it has never been
 * told.
 *
 * The one 409 is `Driving`, which a second press races into. There is no *not parked*
 * refusal because there is no parked check: `decide` is the authority on where a
 * `Restarted` picks up from, and it re-parks a gate unchanged rather than refusing — so a
 * client that has fallen behind spends nothing rather than being told off.
 *
 * Answers `202` with the id the caller already has, so this returns nothing.
 */
export const resume = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/resume`, {})
}

/**
 * `GET /api/traks/:id/merge`. Free — a replay and one `git branch --show-current`.
 *
 * **Where a merge would go, which is a fact about somebody else's checkout.** A host merge
 * lands on whatever branch the machine running `serve` is standing on right now, so it
 * cannot be read off `TrakDetailDto.worktree.base` — that is where the branch was *cut
 * from*. `into` absent means a detached HEAD and nowhere to merge to; `parentId` set means
 * this is a spawn's child and its work goes to its parent instead.
 */
export const mergePreview = async (id: string): Promise<MergePreviewDto> =>
  decodeMergePreview(await get(`${trakPath(id)}/merge`))

/**
 * `POST /api/traks/:id/merge`. **Spends nothing** — no agent and no turn, just a `git
 * merge` and a log line. It still claims custody, so a second press races a drive.
 *
 * No body: the destination is not the caller's to name. The route reads it off the host,
 * which is the same fact `mergePreview` showed before the press, and a merge goes where the
 * human is standing only if the two are the same read.
 *
 * Two refusals, both `409`: `NotFinished` for a trak that has moved — a merge git already
 * refused is not one, the route re-issues that — and `Dirty`, with the files, for
 * uncommitted work in the tree the merge would go into: the host's checkout for a trak
 * at the top, the parent's for a child.
 */
export const mergeTrak = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/merge`, {})
}

/**
 * `POST /api/traks/:id/merge-pull-request`. **Spends nothing** — the engine runs `gh pr
 * merge` by the method picked on the trak, or the repository's default. It claims no custody
 * and appends nothing: the forge's next answer is the record.
 *
 * Two refusals, both `409`: `NotFinished` for a trak that is not at `Finished`, has landed
 * or has no branch, and `PullNotMerged` with a sentence — there is no pull request, or the
 * forge's own refusal.
 */
export const mergePullRequest = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/merge-pull-request`, {})
}

/**
 * `POST /api/traks/:id/commit-and-merge`. **Spends nothing**: whatever is uncommitted in
 * the parent's checkout is committed under the parent's own description, then the child
 * is merged into it — the press behind a `Dirty` refusal on a child, and behind a merge
 * git already refused. A parent's checkout only: a trak with no parent is a `400`, since
 * a person's own working directory is never committed for them, and the client never
 * offers the press there. `409 NotFinished` for a child that is neither finished nor at
 * a refused merge.
 */
export const commitAndMergeTrak = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/commit-and-merge`, {})
}

/**
 * `POST /api/traks/:id/run-now`. **Spends money**: the step a resting trak is held at
 * starts at once, with its wait unmet — a real `claude` on every kind of wait, a clock
 * included. The engine asks `merged` once more first, so a write agent is still refused
 * from a branch that went in while the trak rested.
 *
 * No body — which step is held is read off the log — and `409 NotWaiting` is the one
 * refusal beyond custody: nothing holds the trak, so there is no wait to skip. A stale
 * press earns that rather than an event `decide` would settle as `Failed{engine}`.
 */
export const skipWait = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/run-now`, {})
}

/**
 * `POST /api/traks/:id/skip-effects`. **Spends money** where the next step runs an agent:
 * the trak enters it at once. The effect that failed and every effect declared after it in
 * that step are not run, and the log names each of them.
 *
 * No body. `409 NoFailedEffect` is the refusal beyond custody and ownership: a failed
 * effect no longer stops the trak — a restart from another tab got there first.
 */
export const skipEffects = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/skip-effects`, {})
}

/**
 * `POST /api/traks/:id/sandbox/rebuild`. **Spends nothing and takes no custody**: git, the
 * runner and the setup script, and no agent. The sandbox is made again with its
 * uncommitted changes carried — at once, or once whatever holds it ends — and the detail's
 * `rebuild` says which. 404 for a trak whose checkout is not in a sandbox.
 */
export const rebuildSandbox = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/sandbox/rebuild`, {})
}

/**
 * Archive a finished trak — `POST /api/traks/:id/close`, the wire's older name for it.
 * **Spends nothing**: the checkout goes, and so do the branch, its recorded base ref and
 * the branch's copy on GitHub.
 *
 * No body — *archive it* has no parameters — and `409 NotFinished` is the one refusal
 * beyond custody, made by the route so that a stale press is a refusal rather than an
 * event `decide` would settle as `Failed{engine}`.
 */
export const archiveTrak = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/close`, {})
}

/**
 * Archive a trak that has not finished — `POST /api/traks/:id/abandon`, the wire's older
 * name for it. **Spends nothing**: what exists is committed, the trak is declared over,
 * and the same four things go as on a finished trak's archive.
 *
 * **`reason` is required by the wire and this always sends the empty string.** Interrupting
 * an agentic session never requires a message, and this is an interrupt followed by
 * an ending — so the confirmation in the UI is a second press rather than a sentence. The
 * field stays on the request because the CLI has one worth recording;
 * `record.ts` prints `abandoned` alone when it is empty.
 *
 * One refusal, `409 AtRest`, for a trak that has already ended. **`Driving` is not one** —
 * the route interrupts whatever holds the trak and takes over, which is the whole point of
 * an ending that has to reach a running `claude`. A spawn's child is archived like any
 * other trak, and lands on its parent as a drop; a parent takes its children with it.
 */
export const archiveUnfinishedTrak = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/abandon`, { reason: "" })
}

/**
 * `POST /api/traks/:id/stop`. **Spends nothing, and un-spends what it can**: the `claude`
 * mid-turn is killed and the trak parks at a gate, where saying something resumes the
 * conversation it was holding.
 *
 * No body. Which turn is being stopped and which session it was in are facts only the
 * engine has — the session lives in a run record this request never sees — so a client
 * naming either would be guessing.
 *
 * **`Driving` is not one of its refusals**, for `archiveUnfinishedTrak`'s reason: overriding the
 * drive is the request. The one it can answer is `409 NothingToStop`, and it has two
 * shapes: a position that is not an agent turn at all — the checks, a git operation, a
 * parent waiting on its children, a composer writing a first plan — and a turn the
 * engine has not recorded yet, which is a window of milliseconds a second press clears.
 * The screen cannot tell the second one apart in advance: the wire carries custody and
 * the state, and both say a turn is running before the record exists.
 *
 * It answers `202` and waits for the kill first, so it is the slowest press on the
 * screen by roughly the grace period `killGroup` gives the agent to clean up after
 * itself.
 */
export const stopTrak = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/stop`, {})
}

/**
 * `POST /api/traks/:id/background/:taskId/stop`. **Spends nothing and kills no turn**:
 * one background task the agent left running is stopped, via a control line down the
 * turn's own open pipe. The turn keeps running, and so does every other task.
 *
 * `taskId` is the provider's own handle, off the transcript's `Background` level — the
 * one name for the job both sides hold.
 *
 * One refusal, `409 NothingToStop`: no turn is in flight, or none this daemon holds a
 * pipe for — a turn a dead process left recorded, or a task that has already landed.
 * The outcome is not in the `204` either way: what says the job is gone is the stream,
 * as the level shrinks and the task's own stopped report lands on its card.
 */
export const stopBackgroundTask = async (id: string, taskId: string): Promise<void> => {
  await post(`${trakPath(id)}/background/${encodeURIComponent(taskId)}/stop`, {})
}

/**
 * `POST /api/traks/:id/file`. **Spends money**: the step is re-entered at once on the
 * session it was holding and asked to file what it has, which is a real `claude`.
 *
 * `stopTrak`'s twin with the opposite ending, and one route for both places a person can
 * press it from: a turn still running is killed first, as a stop is; a step parked in a
 * conversation has nothing to kill and is simply re-entered. No body, for `stopTrak`'s
 * reason — which turn and which session are facts only the engine has.
 *
 * Two refusals, both `409`. `NothingToStop` covers every position that is neither a step's
 * running turn nor a parked conversation — a composer, a check, git, every other gate — and
 * the same recording window a stop can land in. `Driving` is answered at the parked
 * conversation alone, where something else already holds the trak: mid-turn, taking the
 * drive over is the request.
 *
 * Answers `202` with the id the caller already has, so this returns nothing.
 */
export const fileTrak = async (id: string): Promise<void> => {
  await post(`${trakPath(id)}/file`, {})
}

/**
 * `POST /api/traks/:id/act` with `Replan`. **Spends money**: the composer runs with the
 * person's words attached, which is a real `claude`.
 *
 * **Accepted at every step gate, and it does the same thing first at each.** The step's
 * work is committed before the composer runs, whether or not a document was filed — at
 * the approval and checks gates that means pressing it is taking the work as well, and at
 * a conversation, answers or stuck gate it keeps the files the step edited before it said
 * anything. The sheet that takes the reason says so in words.
 *
 * `reason` is the whole of what the composer is told beyond what it already knows, and
 * it is quoted to it verbatim. The same route and the same two 409s as `approve`.
 *
 * Answers `202` with the id the caller already has, so this returns nothing.
 */
export const replan = async (id: string, reason: string): Promise<void> => {
  await post(`${trakPath(id)}/act`, { action: "replan", reason })
}

/**
 * `POST /api/traks/:id/mode`. **Spends nothing and interrupts nothing**: the mode is read
 * at the trak's next gate, so a turn in flight finishes on its own session and the gate
 * after it is the first one the new mode decides. Setting `manual` clears a pending hold.
 *
 * **No `Driving` refusal, and no parked check** — this is the one press meant to land
 * while an agent is running, so a surface must not disable it for custody the way it
 * disables Approve. The one refusal is `409 AtRest`: a trak that has ended has no next
 * gate. Answers `204`; what the screen shows next comes off the stream, which carries
 * the mode on every frame.
 */
export const setMode = async (id: string, mode: RunModeDto): Promise<void> => {
  await post(`${trakPath(id)}/mode`, { mode })
}

/**
 * `POST /api/traks/:id/hold`. **Spends nothing and interrupts nothing**, for `setMode`'s
 * reason. `true` asks to hold the current step until a person accepts it, whatever the
 * mode would do at its gates — a spawn has no gate and is passed over — a one-shot the engine spends at that acceptance, so the
 * switch reads off again without a press. `false` takes a pending one back.
 *
 * The same `409 AtRest` as `setMode`, plus `409 OnManual`: on `manual` every gate is stood
 * at already, and the engine refuses rather than record a hold with nowhere to show it.
 */
export const setHold = async (id: string, holding: boolean): Promise<void> => {
  await post(`${trakPath(id)}/hold`, { holding })
}

/**
 * `POST /api/traks/:id/skip-checks`. **Spends nothing and interrupts nothing**, for
 * `setMode`'s reason. `true` asks for the trak's next check run not to happen — the step
 * is then accepted as a pass would accept it — a one-shot the engine spends as that run is
 * recorded, so the switch reads off again without a press. `false` takes a pending one
 * back.
 *
 * The same `409 AtRest` as `setMode`, and no `OnManual`: every mode runs its checks.
 */
export const setSkipChecks = async (id: string, skipping: boolean): Promise<void> => {
  await post(`${trakPath(id)}/skip-checks`, { skipping })
}

/**
 * `POST /api/traks/:id/auto-merge`. **Spends nothing** and starts no drive, like `setMode`
 * — and unlike it, taken at `Finished`, where the forge sweep reads it on its next tick.
 * `true` starts auto-merge afresh, which is how a stopped one is picked up again.
 *
 * `409 Archived` once archived, `409 ChildTrak` on a child, and `409 GoalForbidsAutoMerge`
 * turning it on where the trak's goal file forbids it.
 */
export const setAutoMerge = async (id: string, on: boolean): Promise<void> => {
  await post(`${trakPath(id)}/auto-merge`, { on })
}

/**
 * `POST /api/traks/:id/merge-method`. **Spends nothing** and merges nothing: it records the
 * method the merge press and auto-merge use. `409 Archived` once archived, `409 ChildTrak`
 * on a child.
 */
export const setMergeMethod = async (
  id: string,
  method: MergeMethodRequestDto["method"],
): Promise<void> => {
  await post(`${trakPath(id)}/merge-method`, { method })
}

/**
 * `POST /api/traks/:id/reenter`. **Spends money either way**, and `agent` is which door.
 * Absent, the sentence goes to the composer, which runs and adds steps to the plan; named,
 * one conversational turn of that agent runs on it instead — no composer turn and no plan
 * to approve.
 *
 * **`generic` is the only name the route takes**, and any other is a `400` rather than a
 * refusal, exactly as a name that cannot start a trak is at `createTrak`. So this is not a
 * general way to hand a trak to an agent: it is the second door, and the caller that knows
 * which name is on it is `finished.ts`.
 *
 * `what` is required by the wire, so this is never a bare press — a surface offering it has
 * to have something to say first, which is a sentence somebody typed, whatever they ticked
 * on the finished pane's pull-request half, or both composed into one body. `409 NotAtRest`
 * is the refusal, for a trak that is still going; every at-rest state accepts it, `Merged`
 * included, and this client now offers all of them but `Abandoned`. See `controls.ts`.
 */
export const reenterTrak = async (
  id: string,
  what: string,
  agent?: string,
  base?: string,
): Promise<void> => {
  // A bare re-entry is the body it has always been: `JSON.stringify` drops an `undefined`
  // value, so nothing here has to build the object two ways.
  await post(`${trakPath(id)}/reenter`, { what, agent, base })
}
