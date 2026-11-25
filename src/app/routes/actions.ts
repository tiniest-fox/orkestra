// Starting a trak and acting on one: create, act, resume and its preview, close, abandon,
// reenter and run-now. Takes `@orkestra/shared/dto/actions`. Every one that moves a trak
// drives it through `app/drive.ts`.

import { Effect, Either } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import {
  AbandonRequestDto,
  ActRequestDto,
  CreatedDto,
  CreateTrakRequestDto,
  ReenterRequestDto,
  ResumeRequestDto,
} from "@orkestra/shared/dto/actions"
import {
  AtRestDto,
  DrivingDto,
  NotAtRestDto,
  NotFinishedDto,
  NotParkedDto,
  NotWaitingDto,
  NoFailedEffectDto,
  NothingToStopDto,
  PlanRefusedDto,
  ProposalMovedDto,
  AttachmentRefusedDto,
} from "@orkestra/shared/dto/common"
import { SessionId } from "../../agent/types/session.js"
import { agentNamed } from "../../library/logic/resolve.js"
import { Lib } from "../../library/ports/library.js"
import type { Library } from "../../library/types/library.js"
import {
  editedPlan,
  editRefusal,
  type PlanEdit,
  unpicked,
} from "../../workflow/domain/plan-edit.js"
import {
  asGate,
  atRest,
  effectFailedAt,
  firstUnrun,
  type Trak,
  waitingAt,
} from "../../workflow/domain/trak.js"
import { type Event, Events } from "../../workflow/domain/event.js"
import { isCompose, isSpawn, openingPlan } from "../../workflow/domain/outputs/proposal.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { chatWith } from "../../workflow/domain/decide.js"
import { Ids } from "../../workflow/ports/ids.js"
import { Runs } from "../../workflow/ports/runs.js"
import { Store } from "../../workflow/ports/store.js"
import { Uploads } from "../../workflow/ports/uploads.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import { actFromDto, toResumePreviewDto } from "../dto.js"
import {
  abandonChildren,
  Drives,
  holdMessage,
  ENDING,
  proposalRefusal,
  reenterDrive,
  skipFailedEffect,
  skipWait,
  startDrive,
  takeOverDrive,
  workdir,
} from "../drive.js"
import { pressedBy } from "../guard.js"
import { claimUploads, placeUploads } from "../attachments.js"
import { heldNow, ownerOnly, pathId, refuse } from "./common.js"

/**
 * Is this a name `/api/agents` would have offered? The create route's guard.
 *
 * `agentNamed` rather than `lib.agents`: the engine's own agent sits beside the fleet,
 * and it is startable — New Chat opens a trak with it. Reading the fleet alone would
 * answer `400` to the one name the shelf draws that no project file holds.
 */
const startable = (name: string) => Effect.map(Lib, (lib) => agentNamed(lib, name)?.start === true)

/**
 * Start a trak — composing a plan for it, or opening a conversation with one agent.
 *
 * **Uncommitted work in the project checkout does not refuse a start.** A trak branches
 * from the last commit, so that work is not in it, and the project checkout is left as it
 * was — the person can go on with it while the trak runs.
 *
 * **The agent check comes first**, because it is a fact about the request rather than
 * about the repository — and a bad name must not cost a git call.
 */
const createRoute = Router.post(
  "/api/traks",
  Effect.gen(function* () {
    const request = yield* ServerRequest.schemaBodyJson(CreateTrakRequestDto)

    // A 400 rather than a `RefusalDto`: the screen only ever sends what
    // `/api/agents` gave it, so a name that reaches here is a hand-written request —
    // which is what the platform already answers 400 for. A refusal variant would put
    // a case in the client's exhaustive switch that its own UI cannot produce.
    const startWith = request.agent
    if (startWith !== undefined && !(yield* startable(startWith))) {
      return ServerResponse.empty({
        status: 400,
        statusText: `no agent \`${startWith}\` can start a trak`,
      })
    }
    // The same answer for the same reason: the screen sends only what `/api/models`
    // listed, and only beside an agent — with the composer planning there is no entry
    // to carry a pick, and one that went nowhere would be a spend nobody could see.
    const model = request.model
    if (model !== undefined) {
      const { allowed } = (yield* Lib).models
      if (startWith === undefined) {
        return ServerResponse.empty({
          status: 400,
          statusText: "a model goes with an agent: the composer plans on its own",
        })
      }
      if (!allowed.includes(model)) {
        return ServerResponse.empty({
          status: 400,
          statusText: `no model \`${model}\` is listed: one of ${allowed.join(", ")}`,
        })
      }
    }

    yield* (yield* Vcs).ensureIgnored()

    const ids = yield* Ids
    const drives = yield* Drives
    const uploads = yield* Uploads
    const id = yield* ids.newTrakId
    // Held under the new id until `SetupWorktree` makes the checkout they go in.
    const files = yield* uploads.hold(request.attachments, id)
    if (typeof files === "string") {
      return yield* refuse(422, AttachmentRefusedDto.make({ reason: files }))
    }
    // Two constructors, and which one runs is the whole of what naming an agent does.
    // `trakOpenedWith` builds the one-entry plan `decide`'s `WorktreeReady` arm enters
    // directly, so there is no composer turn and no plan to approve; `trakCreated`
    // writes no plan and that same arm composes, which is every trak that existed
    // before this field. Neither can reach the third birth — a spawn's child is
    // `Born`, and this route has no parent to fill it with.
    //
    // Both take the mode, because how much of a trak a person wants to stand at is a
    // fact about the trak rather than about how it was planned. Absent is `manual`,
    // which is what a caller that has never heard of it sends.
    const mode = request.mode ?? "manual"
    // Beside the mode and not part of it: whether the engine merges the pull request is
    // a second question about the trak, and either mode may answer it either way.
    const autoMerge = request.autoMerge ?? false
    // Whose trak it is: the host user who pressed, and nobody where no host named one.
    const owner = yield* pressedBy
    const { attachments } = files
    const birth = (): Event =>
      startWith === undefined
        ? Events.trakCreated(request.description, undefined, mode, autoMerge, owner, attachments)
        : Events.trakOpenedWith(
            request.description,
            openingPlan(startWith, request.description, model),
            mode,
            autoMerge,
            owner,
            attachments,
          )
    // A freshly minted id cannot already be driving, so `start` cannot answer `busy`
    // here. That is a guarantee the mint buys rather than one the id's shape gives:
    // a name is three words drawn from a wordlist, and what makes it this trak's is
    // that nothing in the store or in git held it. Checked anyway rather than
    // assumed, because the alternative is a route that silently does nothing if
    // that ever stops being true.
    //
    // **Answered once the birth is on the log, not at the fork**: a caller that reads the
    // trak by the id it was answered with finds it. Only the birth is waited for — the
    // drive goes on to the worktree and the composer after the answer.
    const born = yield* drives.bear(id, birth)
    if (born === "busy") return yield* refuse(409, DrivingDto.make({}))
    if (born === "unwritten") {
      yield* uploads.drop(id)
      return ServerResponse.empty({ status: 500, statusText: "the trak could not be written" })
    }
    yield* files.release
    return yield* ServerResponse.json(CreatedDto.make({ id }), { status: 202 })
  }),
)

/**
 * Why a plan gate's edits cannot be taken, as the status and the body to refuse with, or
 * `undefined` where they can.
 *
 * Three questions, in order. **Are they over the plan on the table?** `proposal` names the
 * `ComposerReturned` the person edited, and anything but the newest — a chat at the gate
 * brought another — would lay the edits over steps nobody looked at. **Do they fit it?**
 * `editRefusal`: positions in the proposal, a `continues` naming an earlier agent step
 * the edits keep, and a model `models.yaml` lists on a step not locked to another's
 * conversation. **Is the plan they leave one the composer could have written?** The
 * composer's own decode, read now — see `proposalRefusal`. It is what refuses a swap to
 * an agent no plan may name, or to a writer after the merge, and it reads the plan with
 * the person's picks taken off: that decode refuses any `model`, which is the composer's
 * rule and not the person's.
 */
const planEditsRefused = (
  trak: Trak,
  events: readonly Event[],
  proposal: number,
  edits: readonly [PlanEdit, ...PlanEdit[]],
) =>
  Effect.gen(function* () {
    const newest = events.findLastIndex((e) => e._tag === "ComposerReturned")
    const returned = events[newest]
    if (
      trak.state._tag !== "AwaitingProposal" ||
      trak.plan === undefined ||
      newest !== proposal ||
      returned?._tag !== "ComposerReturned" ||
      returned.output.type !== "proposal"
    ) {
      return { status: 409, refusal: ProposalMovedDto.make({}) }
    }
    const from = firstUnrun(trak)
    const { allowed } = (yield* Lib).models
    const reason =
      editRefusal(trak.plan, from, edits, allowed) ??
      (yield* proposalRefusal(trak, {
        ...returned.output,
        steps: editedPlan(trak.plan, from, edits).steps.slice(from).map(unpicked),
      }))
    return reason === undefined
      ? undefined
      : { status: 422, refusal: PlanRefusedDto.make({ reason }) }
  })

/**
 * Act on a parked trak. One `HumanActed` event, exactly like `ork approve`.
 *
 * **Parked is read from `state`, via the domain's own `asGate`.** It must not be
 * read from `trak.lastGate`: that field is the engine's memory of the *last* gate and
 * deliberately survives into `AgentWorking` so a conversational reply can land
 * where the conversation started (`domain/trak.ts`). Gating on it accepted an
 * approval for a trak that had already moved on — one request, no agent involved,
 * and nowhere for the press to apply. `decide` absorbs an approval it cannot route
 * and refuses everything else `Failed{kind:"engine"}`, so reading the remembered
 * gate either loses the press silently or ends a healthy trak.
 *
 * `step` comes from the same gate: only `AwaitingHuman` stands at one, and the
 * composer's two gates record 0 because nothing has an index there — the same
 * nominal the CLI writes.
 *
 * **A recompose pressed while a step's turn runs is the one action that lands off a
 * gate**, and it takes the drive over rather than being refused — the shape `fileRoute`
 * and `stopRoute` take, and for their reason: the trak with a `claude` mid-turn is
 * exactly the trak somebody is recomposing. The turn's record is a condition of
 * accepting, exactly as at `stopRoute`: absent is the window where the state says a turn
 * is running and none is recorded yet, and a `Replan` there would take a drive over with
 * nothing to kill. **The session is read off it and carried on the press**, as a stop
 * carries it: not for the composer, which mints a fresh one, but for the position — with
 * no session in its slot the interrupted entry reads as unrun, and the ask is written over
 * it rather than after it, deleting the entry and the model a person picked on New Chat.
 * **A `Chat` off a gate is kept rather than refused** — `holdMessage` records it as
 * waiting and answers the same `202`, so a surface sends one request whichever it is.
 * Every other action off a gate has nowhere to apply and is refused.
 *
 * **An approval may carry edits to the plan at its gate**, and they are checked here, before
 * anything is appended — `planEditsRefused`. Refused in `decide` instead, a bad edit would
 * end a healthy trak rather than be answered.
 *
 * 404 unknown id · 403 not the owner, on a host with more than one user, where the host provides `People`
 * · 409 not parked and not a chat, or no turn is recorded yet · 409 held by another process
 * · 409 the edits are over a proposal no longer at the gate · 422 the edited plan is refused.
 */
const actRoute = Router.post(
  "/api/traks/:id/act",
  Effect.gen(function* () {
    const id = yield* pathId
    const req = yield* ServerRequest.schemaBodyJson(ActRequestDto)
    const action = actFromDto(req)

    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const notOwner = yield* ownerOnly(trak.owner)
    if (notOwner !== undefined) return notOwner
    // A chat's files are checked first and written last: a 422 for an id the engine does
    // not hold costs nothing, and every 409 below leaves the uploads where they wait, so
    // the person can send the same ids again. See `placedFor`.
    const ids = req.action === "chat" ? (req.attachments ?? []) : []
    const unheld = ids.length === 0 ? [] : yield* claimUploads(ids)
    if (typeof unheld === "string") {
      return yield* refuse(422, AttachmentRefusedDto.make({ reason: unheld }))
    }
    const state = trak.state
    const gate = asGate(state)
    if (gate === undefined) {
      if (state._tag === "AgentWorking" && action._tag === "Replan") {
        const runs = yield* Runs
        const turn = yield* runs.inFlight(id)
        if (turn === undefined) return yield* refuse(409, NothingToStopDto.make({}))
        // `usage` rides the same read, as on a stop: the kill destroys the turn's count.
        return yield* takeOverDrive(id, () =>
          Events.humanActed(state.step, action, turn.sessionId, turn.usage),
        )
      }
      // Said while something else has the trak: kept, and read by the running turn,
      // the next one, or the gate — `holdMessage`. A trak at rest has none of those.
      if (action._tag === "Chat" && !atRest(state)) {
        const files = yield* placedFor(trak, ids)
        if (typeof files === "string") {
          return yield* refuse(422, AttachmentRefusedDto.make({ reason: files }))
        }
        const held = yield* holdMessage(id, action.message, files.attachments, workdir(trak))
        yield* files.release
        return held
      }
      return yield* refuse(409, NotParkedDto.make({}))
    }
    const step = gate._tag === "AwaitingHuman" ? gate.step : 0
    const edits = action._tag === "Approve" ? action.edits : undefined
    if (req.action === "approve" && req.edits !== undefined && edits !== undefined) {
      const refused = yield* planEditsRefused(trak, events, req.edits.proposal, edits)
      if (refused !== undefined) return yield* refuse(refused.status, refused.refusal)
    }

    // Asked before the files are written, so a press another drive turns away keeps them.
    // `startDrive` asks again under the drive's own key, and a press that loses that race
    // keeps its uploads too: they are released only once the drive is taken.
    if (ids.length > 0 && (yield* (yield* Drives).running(id))) {
      return yield* refuse(409, DrivingDto.make({}))
    }
    const files = action._tag === "Chat" ? yield* placedFor(trak, ids) : undefined
    if (typeof files === "string") {
      return yield* refuse(422, AttachmentRefusedDto.make({ reason: files }))
    }
    // Whatever still waits at this gate is older than what was just typed, and goes
    // with it: one chat, one turn.
    const said =
      action._tag === "Chat" ? chatWith(trak, action.message, files?.attachments ?? []) : action
    const answer = yield* startDrive(id, () => Events.humanActed(step, said))
    if (answer.status === 202 && files !== undefined) yield* files.release
    return answer
  }),
)

/**
 * A chat's files, written into the trak's checkout — or held for the one `SetupWorktree`
 * makes, where it has none yet — with the uploads kept until `Placed.release`. Asked
 * only once the route has nothing left to refuse but a race.
 */
const placedFor = (trak: Trak, ids: readonly string[]) =>
  trak.worktree === undefined
    ? Effect.flatMap(Uploads, (uploads) => uploads.hold(ids, trak.id))
    : placeUploads(ids, trak.worktree.path)

/**
 * Resume a stopped trak. Re-issues the command for the position. `sessionId`
 * is optional — absent when no session was ever recorded.
 *
 * No parked check: resuming is defined from wherever the trak is, and `decide`
 * is the authority on whether `Restarted` is acceptable there. It claims custody
 * for the same two reasons `act` does.
 */
const resumeRoute = Router.post(
  "/api/traks/:id/resume",
  Effect.gen(function* () {
    const id = yield* pathId
    const req = yield* ServerRequest.schemaBodyJson(ResumeRequestDto)

    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const notOwner = yield* ownerOnly(replayHistory(id, events).owner)
    if (notOwner !== undefined) return notOwner
    const sessionId = req.sessionId
    // The session comes from the record when the caller did not name one: an
    // interrupted turn has to carry on where it was, and only `adopt` — inside the
    // drive, after this request is answered — can say which session that was.
    //
    // Which turn this event *ends* is not here and is not the caller's either:
    // `advance` stamps it from the same record, so no surface can write a restart
    // that leaves an interrupted turn without an ending.
    return yield* startDrive(id, (resuming) =>
      Events.restarted(sessionId === undefined ? resuming?.sessionId : SessionId.make(sessionId)),
    )
  }),
)

/**
 * Archive a finished trak: the checkout goes, and so do the branch, its recorded
 * base ref and the branch's copy on the forge — whatever is on them. On the way,
 * the engine asks GitHub once whether the branch's pull request merged; the
 * answer decides only what the trak ends as (`Merged` with the merge commit, or
 * `Closed`), never how much is deleted.
 *
 * **One of the two archive routes behind the one word.** This one takes a trak
 * at `Finished`; a trak still going archives through `/abandon` below, which
 * interrupts the drive first. The vocabulary unifies and the plumbing does not —
 * their refusal sets differ.
 *
 * **Spends nothing** — no agent, no turn, git and one `gh` read. It still claims
 * custody, because it writes to the same log everything else does.
 *
 * No body: *archive it* has no parameters, and the state it applies from is the
 * only one `decide` accepts it in. The 409 is that check, made here so a mistyped
 * request is a refusal rather than a `Failed{engine}` written into a healthy log.
 *
 * **`merge` is deliberately not a sibling.** It writes to whatever branch the
 * machine running `serve` happens to be standing on, and the whole of that
 * decision is that the destination is
 * shown and confirmed. A button cannot show what the wire does not carry, so the
 * route waits for the wire to carry it.
 *
 * 404 unknown id · 409 not finished · 409 held by another process.
 */
const closeRoute = Router.post(
  "/api/traks/:id/close",
  Effect.gen(function* () {
    const id = yield* pathId

    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    if (replayHistory(id, events).state._tag !== "Finished") {
      return yield* refuse(409, NotFinishedDto.make({}))
    }
    return yield* startDrive(id, () => Events.closed())
  }),
)

/**
 * What resuming would do, before anything is spent.
 *
 * Every failure is retryable, but only some positions re-run anything: `restartFrom`
 * re-parks a gate unchanged and settles a terminal one. `retry` is which of the three,
 * so a caller asks *re-run it?* about the one that costs.
 */
const resumePreviewRoute = Router.get(
  "/api/traks/:id/resume",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const trak = replayHistory(id, events)
    return yield* ServerResponse.json(toResumePreviewDto(trak, yield* heldNow(id)))
  }),
)

/**
 * Archive a trak that has not finished — declared over, and its git footprint
 * deleted exactly as `/close`'s is: the checkout, the branch, its recorded base
 * ref and the branch's copy on the forge, whatever was committed to them. The
 * confirmation on the press is the only guard, and the work exists nowhere else
 * afterwards.
 *
 * **A parent takes its children with it.** Every child of its spawns still out is
 * archived the same way, after the parent's own take-over — `abandonChildren` says why
 * the order matters. A child archived on its own lands on its parent as a drop, so a
 * spawn waiting on it stops waiting; the parent is not asked.
 *
 * **One of the two routes that take a drive over rather than being refused by it.** A
 * trak with a `claude` mid-turn is exactly the trak somebody wants to end, so the drive
 * in flight is interrupted and the abandon forked in its place — see `takeOverDrive`
 * for what the interruption costs and what it leaves on the log. `stopRoute` is the
 * other, and the difference is what it forks: an ending here, a gate there. What the
 * two carry is the same: the killed turn's session, position and spend, read off the
 * run record before the kill clears it — and absent here, rather than refused, because
 * an archive reaches a parked trak with nothing running.
 *
 * **Except an ending already running, which keeps the old refusal.** Interrupting
 * `Merging` interrupts a `git merge` in the *host's* checkout, which is the one
 * command in the engine with no re-run behind it, and a second ending of a trak
 * already ending says nothing the first did not. The refusal is conditional on a
 * drive actually being in flight so the sentence stays true: a trak left in
 * `Abandoning` by a crash has nothing driving it, and ending it again is how a
 * person finishes what stopped.
 *
 * 404 unknown id · 409 already at rest · 409 already ending.
 */
const abandonRoute = Router.post(
  "/api/traks/:id/abandon",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(AbandonRequestDto)
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    if (atRest(trak.state)) return yield* refuse(409, AtRestDto.make({}))

    const drives = yield* Drives
    if (ENDING.has(trak.state._tag) && (yield* drives.driving(id))) {
      return yield* refuse(409, DrivingDto.make({}))
    }
    const runs = yield* Runs
    const turn = yield* runs.inFlight(id)
    const response = yield* takeOverDrive(id, () =>
      Events.abandoned(request.reason, turn?.sessionId, turn?.step, turn?.usage),
    )
    yield* abandonChildren(trak, request.reason)
    return response
  }),
)

/**
 * The world came back to a trak that had stopped. Only meaningful once it has.
 *
 * **Two doors, and naming an agent is the whole of what picks the second.** Absent, the
 * sentence goes to the composer, which is what a re-entry has always done. Named, one
 * conversational turn of that agent runs on it and nothing is planned.
 *
 * **`generic` is the only name accepted**, and the refusal mirrors the create route's:
 * a bare `400` rather than a `RefusalDto`, because the screen only ever sends what the
 * engine offered it, so any other name is a hand-written request — and a refusal variant
 * would put a case in the client's exhaustive switch that its own UI cannot produce.
 * Which agents a person may pick here is the engine's answer to give, and today it is
 * one: everything in the project's library is a role a plan places, not a turn to be
 * dropped onto finished work.
 *
 * **A `Finished` trak whose pull request has merged has its branch moved first**, on the
 * drive and under its key — see `Drives.reenter`. Where that cannot be done, the
 * re-entry is a `409 BranchNotMoved` carrying why, so this answers once the move is
 * settled rather than at the fork.
 *
 * The state is not narrowed by which door it is. `atRest` is the whole rule, exactly as
 * before — that more work on a *merged* trak wants the box at all is a question about a
 * surface, and answering it here would answer it for the CLI too.
 */
const reenterRoute = Router.post(
  "/api/traks/:id/reenter",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(ReenterRequestDto)

    const lib = yield* Lib
    const askedFor = request.agent
    if (askedFor !== undefined && askedFor !== lib.generic.name) {
      return ServerResponse.empty({
        status: 400,
        statusText: `no agent \`${askedFor}\` can be asked about a trak`,
      })
    }

    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const notOwner = yield* ownerOnly(trak.owner)
    if (notOwner !== undefined) return notOwner
    if (!atRest(trak.state)) return yield* refuse(409, NotAtRestDto.make({}))
    // Not refused on a trak that has landed, though the one agent this door names
    // writes: a question is exactly what a merged trak gets asked, so `SpawnStep` runs
    // the engine's own agent read-only there instead of refusing it — the one turn that
    // narrows an agent's declaration rather than dying on it. The other door needs no
    // such care: a sentence with no agent goes to the composer, which is refused a write
    // agent at decode and told why.
    const outcome = yield* reenterDrive(id, (moved) =>
      Events.reentered(request.what, askedFor, request.base, moved),
    )
    if (outcome === "busy") return yield* refuse(409, DrivingDto.make({}))
    if (Either.isLeft(outcome)) return yield* refuse(409, outcome.left)
    return yield* ServerResponse.json({ id } satisfies CreatedDto, { status: 202 })
  }),
)

/**
 * Run the step a resting trak is held at now, without its condition being met.
 *
 * Every kind of wait, and a wait that has given up above all — that is the rest with
 * no other way out short of sending the trak back. No body: which step is the one the
 * plan is held at, read off the log, and the press says nothing else.
 *
 * `merged` is asked once more before the step runs — see `skipWait` — so a write
 * agent is refused from a branch that went in while the trak rested, and the log
 * records the commit where the forge names one. The step's own turn is told which
 * condition it was waiting on, and that a person started it anyway.
 *
 * 404 unknown id · 403 not the owner · 409 not waiting · 409 already driving.
 */
const runNowRoute = Router.post(
  "/api/traks/:id/run-now",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const notOwner = yield* ownerOnly(trak.owner)
    if (notOwner !== undefined) return notOwner
    const wait = waitingAt(trak)
    if (wait === undefined) return yield* refuse(409, NotWaitingDto.make({}))
    return yield* skipWait(trak, wait)
  }),
)

/**
 * What a skip at `step` keeps from running: the effect that failed, and every effect the
 * step's agent declares after it, since one failed effect stops every effect after it.
 * The failed one alone where the library no longer declares it, because nothing then says
 * which effects it stood in front of.
 */
const notRun = (
  lib: Library,
  trak: Trak,
  step: number,
  failed: string,
): readonly [string, ...string[]] => {
  const entry = trak.plan?.steps[step]
  const agent =
    entry === undefined || isSpawn(entry) || isCompose(entry)
      ? undefined
      : agentNamed(lib, entry.agent)
  const declared = agent?.effects ?? []
  const at = declared.indexOf(failed)
  return at === -1 ? [failed] : [failed, ...declared.slice(at + 1)]
}

/**
 * Skip a failed effect: the step is taken as if its effects had run, and none of them runs —
 * not the one that failed and not any declared after it. No body.
 *
 * **Retry's other door, and held to retry's rule**: a person who may resume this trak may
 * skip here, so the ownership check is `/resume`'s. It spends nothing itself, but the step
 * it enters may.
 *
 * Which effect failed is read off the log's last `EffectFailed` at the step, because the
 * state names only the step. The names that did not run go on `EffectsRan.skipped`, which
 * is the note the step carries afterwards. The drive appends it only if the trak is still
 * stopped there — `skipFailedEffect`.
 *
 * 404 unknown id · 403 not the owner · 409 not stopped on a failed effect · 409 already driving.
 */
const skipEffectsRoute = Router.post(
  "/api/traks/:id/skip-effects",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const notOwner = yield* ownerOnly(trak.owner)
    if (notOwner !== undefined) return notOwner
    const step = effectFailedAt(trak)
    const failed = events.findLast((e) => e._tag === "EffectFailed" && e.step === step)
    if (step === undefined || failed?._tag !== "EffectFailed") {
      return yield* refuse(409, NoFailedEffectDto.make({}))
    }
    const skipped = notRun(yield* Lib, trak, step, failed.name)
    return yield* skipFailedEffect(id, step, skipped)
  }),
)

export const actionRoutes = Router.empty.pipe(
  createRoute,
  actRoute,
  resumeRoute,
  closeRoute,
  resumePreviewRoute,
  abandonRoute,
  reenterRoute,
  runNowRoute,
  skipEffectsRoute,
)
