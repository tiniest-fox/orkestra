// Two ways to take a turn, and the difference is what an unusable response means.
//
// `elicit` drives an agent CLI until it produces a value of the given schema:
// nobody is waiting, so a response that isn't one is a failure worth re-prompting.
// `converse` runs one turn for a human who is waiting, where prose is a complete
// answer — and an envelope that was meant as one and refused is re-prompted like
// any other, because the agent is the reader the refusal was written for.
//
// Both are generic over A — which is why this module never learns what a trak is.
// Workflow passes StepOutput; the composer passes Proposal.

import { Effect, Either, Option, Schema, Stream } from "effect"
import { render } from "../../prompts/index.js"
import { Prompts } from "../../prompts/ports/prompts.js"
import { type Answer, answering, noAnswer } from "../logic/answer.js"
import { extractJson, unparsedEnvelope } from "../logic/extract.js"
import { refusalReason } from "../logic/refusal.js"
import { Provider } from "../ports/provider.js"
import { Transcript } from "../ports/transcript.js"
import { type BackgroundTask, ProviderEvent } from "../types/provider-event.js"
import { ElicitFailed, type ProviderFailed } from "../types/errors.js"
import type { SessionId, SessionRequest, Settles } from "../types/session.js"

/**
 * What a turn produced, and the text it wrote it as.
 *
 * `envelope` is the exact slice `extractJson` took, fence delimiters included — what
 * a surface subtracts from the agent's words so the same object is not drawn twice,
 * once as raw JSON and once as the card below it. Reported rather than re-derived:
 * the scan that found it is the only thing that knows where it was.
 *
 * **`undefined` means nothing was taken, and that is the honest half.** A turn that
 * answered in prose, or one whose JSON did not decode, has no envelope — so its raw
 * text stays on screen whole, which is what makes the confusing turns readable.
 *
 * `stopped` is the background work that was still running when the envelope arrived,
 * which ending the turn there stopped — every attempt's, since a re-ask is the same
 * turn. The agent is not told by the provider, so whoever sends that session its next
 * prompt has to say.
 */
export interface Elicited<A> {
  readonly value: A
  readonly envelope: string | undefined
  readonly stopped: readonly BackgroundTask[]
}

// -- Leaf steps: named, non-recursive, so Effect.fn gives them spans ---------

/**
 * Run one session and collect the turn's answer, recording as it flows.
 *
 * Which words those are is `answering`'s rule and not this function's — one `claude`
 * is no longer one turn, so "the text that came back" needs deciding rather than
 * concatenating.
 *
 * `settles` goes to the provider and to the fold both. The provider stops waiting on
 * background work at the result it accepts; the fold reads the answer from that result,
 * whether or not the provider is one that can.
 *
 * `ProviderFailed` passes straight through rather than being folded into
 * `ElicitFailed`, and the distinction is the whole point: an agent that produced
 * unusable output is the agent failing, while a dropped connection or an
 * exhausted usage limit is the *turn* being interrupted — the same thing as the
 * process being killed, and recoverable the same way. Flattening them here makes
 * a transport error read as the agent giving up — a terminal verdict, on a trak no
 * re-run can reach.
 *
 * The fold ignores every event that is not text, `ApiError` included, and that
 * is safe rather than lax: an error a CLI reports in-band fails the stream in
 * `adapters/cli-provider.ts` before the fold can return, so it arrives here as
 * `ProviderFailed` like any other transport failure. Converting it per-call
 * here would have caught only the callers that went through `elicit`, and would
 * have changed what an unmatched scripted turn means. See the comment there.
 */
const CollectText = Effect.fn("CollectText")(function* (req: SessionRequest, settles: Settles) {
  const provider = yield* Provider
  const transcript = yield* Transcript

  const answer: Answer = yield* provider
    .run({ ...req, settles })
    .pipe(Stream.tap(transcript.record), Stream.runFold(noAnswer, answering(settles)))
  return answer
})

/**
 * `SessionRequest.settles` for a schema: the text holds JSON that decodes against it.
 *
 * **Decoding, not "holds JSON".** An agent waiting on a check that quotes a config
 * block has written JSON and filed nothing, and ending its turn there would stop the
 * check it is waiting for. An envelope that does not decode is left for the end of the
 * turn, where it is re-asked. `also` is a guard the value has to pass first.
 */
const holdsEnvelope = <A, I>(
  schema: Schema.Schema<A, I>,
  also: (value: unknown) => boolean = () => true,
): Settles => {
  const decode = Schema.decodeUnknownEither(schema)
  return (text) =>
    Option.match(extractJson(text), {
      onNone: () => false,
      onSome: (found) => also(found.value) && Either.isRight(decode(found.value)),
    })
}

/**
 * Resume the same session carrying why the last response was unusable.
 *
 * **Recorded before the retry runs, and that ordering is the point.** The resume
 * spawns a second `claude`, and one `claude` is one turn everywhere else — so the
 * entry is what says the spawn about to happen continues this turn rather than
 * starting one. The whole loop files a single ending in the trak's log, and a reader
 * counting spawns against endings without this would place a turn's document on the
 * turn before the one that produced it.
 *
 * **Resumed by the id the provider announced, where it announced one.** A CLI that
 * takes the id it is given announces that same id back; one that mints its own
 * never knew the request's, and resuming by it would resume nothing. The re-ask is
 * the conversation's own next turn, so it inherits nothing — the brief a fresh turn
 * carried in its body is already in the conversation, and it rejoins nothing either.
 */
const ResumeWithFeedback = Effect.fn("ResumeWithFeedback")(function* (
  req: SessionRequest,
  why: string,
  session: SessionId | undefined,
) {
  const templates = yield* Prompts
  const transcript = yield* Transcript
  yield* transcript.record(ProviderEvent.Reask({ reason: why }))
  // **Never `reattach`.** Only a turn's first spawn may rejoin a command a dead engine
  // left: that command ended with the answer being re-asked, and its exec was killed when
  // the stream closed, so a re-ask rejoining it would find it gone and fail the turn.
  // Nor the exec id: a second spawn under the first one's id is two commands one `kill`
  // reaches. The re-ask's id is reported as it spawns, as every id was before.
  const { reattach: _rejoined, execId: _first, ...fresh } = req
  const next: SessionRequest = {
    ...fresh,
    resumeFrom: session ?? req.sessionId,
    inherited: false,
    prompt: render(templates, "elicit-retry", { reason: why }),
  }
  return next
})

/** Why the envelope `text` ends on does not parse, as a retry's reason; `undefined` when it has none. */
const UnparsedReason = Effect.fn("UnparsedReason")(function* (text: string) {
  const error = unparsedEnvelope(text)
  if (error === undefined) return undefined
  const templates = yield* Prompts
  return render(templates, "envelope-unparsed", { error })
})

// -- The loop ---------------------------------------------------------------

/**
 * How many times to ask before giving up.
 *
 * Retries were unbounded by design at first — matching current production
 * behavior and the epic's stance on caps. That held until an agent whose output
 * shape simply disagreed with the schema spun forever: in tests a hung suite
 * burning CPU across workers, against a real provider unbounded spend on a loop
 * that cannot succeed.
 *
 * Three is the number because every failure inside one `elicit` call is
 * consecutive by construction — success returns immediately — so "3 attempts"
 * and "3 failures in a row" are the same statement, and no extra state is needed
 * to tell them apart. Two genuine reformats is generous; a third identical
 * failure is evidence that re-prompting is not the fix.
 */
const MAX_ATTEMPTS = 3

/**
 * What a value that decoded may still be refused for: a reason, or `undefined` to
 * accept it. For what a schema cannot say — whether a diagram in it parses is a
 * question for a parser.
 */
export type Vet<A> = (value: A) => Effect.Effect<string | undefined>

/**
 * Each retry resumes the same session, so the agent already holds full context
 * and only needs to reformat.
 *
 * `vet` runs inside the loop rather than after it, because only here can its
 * refusal resume the same session on the same budget: the re-ask, the three
 * attempts and the `ElicitFailed` at the end are the ones a malformed response gets.
 *
 * The recursive shell is an annotated arrow rather than `Effect.fn` — the
 * wrapper cannot infer a type through a self-call when the function is also
 * generic. The named leaf steps above still get their spans.
 */
export const elicit = <A, I>(
  schema: Schema.Schema<A, I>,
  req: SessionRequest,
  vet: Vet<A> = () => Effect.succeed(undefined),
): Effect.Effect<Elicited<A>, ElicitFailed | ProviderFailed, Provider | Transcript | Prompts> => {
  const decode = Schema.decodeUnknown(schema)
  const settles = holdsEnvelope(schema)

  const attempt = (
    request: SessionRequest,
    n: number,
    stoppedBefore: readonly BackgroundTask[],
  ): Effect.Effect<Elicited<A>, ElicitFailed | ProviderFailed, Provider | Transcript | Prompts> =>
    Effect.gen(function* () {
      const answer = yield* CollectText(request, settles)
      // An envelope that decodes settles the turn and can still be refused by `vet`,
      // so an attempt that is re-asked may already have stopped work.
      const stopped = [...stoppedBefore, ...answer.stopped]
      const again = (reason: string) => retryOrGiveUp(request, n, reason, answer.session, stopped)

      const found = extractJson(answer.text)
      if (Option.isNone(found)) {
        const broken = yield* UnparsedReason(answer.text)
        // Nothing JSON-shaped at all — the `park_plain_text` case.
        return yield* again(broken ?? "no JSON found in response")
      }

      const decoded = yield* Effect.either(decode(found.value.value))
      // The envelope is reported only for the attempt that decoded, so an earlier
      // attempt's JSON stays on screen — which is the direction to be wrong in: a
      // re-ask is one of the turns worth reading in full.
      if (decoded._tag === "Left") {
        return yield* again(`schema mismatch: ${refusalReason(decoded.left)}`)
      }
      const refused = yield* vet(decoded.right)
      if (refused !== undefined) return yield* again(refused)
      return { value: decoded.right, envelope: found.value.envelope, stopped }
    })

  const retryOrGiveUp = (
    request: SessionRequest,
    n: number,
    reason: string,
    session: SessionId | undefined,
    stopped: readonly BackgroundTask[],
  ): Effect.Effect<Elicited<A>, ElicitFailed | ProviderFailed, Provider | Transcript | Prompts> =>
    n >= MAX_ATTEMPTS
      ? Effect.fail(new ElicitFailed({ reason, attempts: n }))
      : Effect.flatMap(ResumeWithFeedback(request, reason, session), (retry) =>
          attempt(retry, n + 1, stopped),
        )

  return attempt(req, 1, [])
}

/**
 * One turn on a session a human is talking to. Either the agent produced a value
 * of the schema, or it answered — and `fromProse` says what an answer is.
 *
 * The caller supplies that constructor rather than this module knowing about
 * replies, which is what keeps `agent/` generic and unaware of traks.
 *
 * **A turn that wrote several results and no envelope answered with all of them**,
 * joined in order — `answering` has the rule. The sentence an agent writes before it
 * waits on background work and the report it writes afterwards are one message.
 *
 * **Prose is never re-prompted, and neither is JSON that was not an envelope.**
 * `extractJson` takes the last JSON-shaped thing in the response by deliberate
 * policy — the contract asks for the envelope last — so a reply that ends by
 * showing someone a config block is a false positive by construction, and
 * re-prompting it would spend two turns telling a correctly-behaving agent it was
 * wrong. `meant` is what tells that block from an envelope: the loose shape of
 * *this was written as one of the outputs you may return*, which the caller
 * derives from the same union `schema` narrows. A block that is not even that is
 * an answer, whole.
 *
 * **JSON written as an envelope that does not parse is re-prompted too** — a ```json
 * fence, or a block opening with a `"type"` key, that `extractJson` could not read.
 * Not parsing looks the same as prose to the extractor, and filing it as a message
 * leaves the agent never told about the one comma that cost it the filing.
 *
 * **An envelope that was meant and refused is re-prompted**, because the refusal
 * text is guidance — *leave out a section you did not change* — and the agent is
 * the only reader it can help. Without this it was filed as prose: the person read
 * the raw JSON, the agent was never told, and whatever else the envelope carried
 * was dropped. Bounded like `elicit`, and what it does when the bound is reached is
 * the one difference: the last text is handed to `fromProse` rather than the turn
 * failing. A person is at the prompt, and their reading the raw text and saying so
 * is a better ending for a chat than a trak settling `failed` under them.
 */
export const converse = <A, I, M, MI, B>(
  schema: Schema.Schema<A, I>,
  meant: Schema.Schema<M, MI>,
  fromProse: (text: string) => B,
  req: SessionRequest,
  // No `ElicitFailed`, unlike `elicit`: nothing here fails on attempts, because a
  // conversation exhausted falls back to the answer the human is waiting for. The
  // only way this turn fails is the provider failing.
): Effect.Effect<Elicited<A | B>, ProviderFailed, Provider | Transcript | Prompts> => {
  const decode = Schema.decodeUnknown(schema)
  const wasMeant = Schema.is(meant)
  const settles = holdsEnvelope(schema, wasMeant)

  const attempt = (
    request: SessionRequest,
    n: number,
  ): Effect.Effect<Elicited<A | B>, ProviderFailed, Provider | Transcript | Prompts> =>
    Effect.gen(function* () {
      const said = yield* CollectText(request, settles)
      // An answer carries no envelope: nothing was taken out of the text, and the
      // raw string it fell back to is the only account of a turn that meant to file.
      // Nor did it stop anything: `settles` accepts only what decodes below.
      const answer: Elicited<A | B> = {
        value: fromProse(said.text),
        envelope: undefined,
        stopped: [],
      }
      const again = (reason: string) =>
        n >= MAX_ATTEMPTS
          ? Effect.succeed(answer)
          : Effect.flatMap(ResumeWithFeedback(request, reason, said.session), (retry) =>
              attempt(retry, n + 1),
            )
      const found = extractJson(said.text)
      if (Option.isNone(found) || !wasMeant(found.value.value)) {
        // JSON written as an envelope that does not parse is not prose: the agent
        // meant to file, and only it can fix the comma.
        const broken = yield* UnparsedReason(said.text)
        return broken === undefined ? answer : yield* again(broken)
      }
      const decoded = yield* Effect.either(decode(found.value.value))
      if (decoded._tag === "Right") {
        return { value: decoded.right, envelope: found.value.envelope, stopped: said.stopped }
      }
      return yield* again(`schema mismatch: ${refusalReason(decoded.left)}`)
    })

  return attempt(req, 1)
}
