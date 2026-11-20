// A provider fake that matches on the REQUEST rather than on call order.
//
// The flat-array version couldn't say which turn answered which request, assert
// what the agent was actually asked, or express resume vs fresh. Scenarios need
// all three, so each turn declares its own precondition.

import { Chunk, Effect, Layer, Ref, Stream } from "effect"
import { type ApiErrorKind, ProviderEvent } from "../../src/agent/types/provider-event.js"
import { McpAnswer, type McpRequest, type McpTool } from "../../src/agent/types/mcp.js"
import { Provider } from "../../src/agent/ports/provider.js"
import { ProviderFailed } from "../../src/agent/types/errors.js"
import { registryOf } from "../../src/agent/adapters/provider-registry.js"
import type { SessionId, SessionRequest, SteeredMessage } from "../../src/agent/types/session.js"
import type { Ambiguity } from "../../src/workflow/domain/outputs/ambiguity.js"
import type { Decided } from "../../src/workflow/domain/outputs/decided.js"
import type { Child } from "../../src/workflow/domain/outputs/proposal.js"

export interface Turn {
  readonly label: string
  readonly when: (req: SessionRequest) => boolean
  readonly reply: string
  /**
   * Answer every matching request, not just the first.
   *
   * Turns are consumed by default so that repeated identical requests progress
   * through the script instead of looping on one answer. A turn that models "this
   * agent is broken and will keep being broken" needs the opposite, and without
   * this the second request fell through to UNMATCHED and got an ApiError — which
   * made a retry-cap test pass for entirely the wrong reason.
   */
  readonly repeatable?: boolean
  /**
   * The provider itself failing, rather than the agent answering badly.
   *
   * A different thing from every `reply` below, and the engine now treats it as
   * one: a dropped connection or an exhausted usage limit says nothing about the
   * work, so it becomes `TurnFailed` and a retryable `Failed{provider}` instead
   * of a verdict the agent never gave. Without a way to express it here the only
   * failure a flow test could stage was the agent's own.
   *
   * `sessionStarted` is the half that decides whether the retry can resume
   * anything, so it is a field rather than an assumption: the CLI dying
   * mid-response was talking to a session, and the CLI refusing to start —
   * missing binary, expired auth, a usage limit rejected before the first line —
   * never made one. `crashesOn` and `failsToStartOn` are the two constructors.
   */
  readonly crash?: {
    readonly reason: string
    readonly sessionStarted: boolean
    /** The in-band classification, where the CLI reported one — see `ProviderFailed.kind`. */
    readonly kind?: ApiErrorKind
    /** The rejoined command is gone from its sandbox — see `ProviderFailed.gone`. */
    readonly gone?: true
  }
  /**
   * How many `Thinking` ticks to emit before answering. A real CLI sends dozens
   * per turn, and `withTranscript` deliberately records one line for the whole
   * burst — so a fake that never thinks cannot exercise the collapse, and the
   * transcript nobody could read would have stayed untested.
   */
  readonly thinks?: number
  /**
   * How many extra times to announce the same session before answering. Claude
   * re-announces every time it picks a session back up to drain background work —
   * three `system/init` on one turn, all carrying the same id — and `withTranscript`
   * records one line for the three. A fake that announces once cannot exercise it.
   */
  readonly reannounces?: number
  /**
   * Background levels to emit before answering, each the set of task ids alive at that
   * moment. A real teardown repeats an unchanged set once per task it is stopping, in
   * the same millisecond, and `withTranscript` records one line for the run of repeats
   * — so a fake that never levels cannot exercise the collapse.
   */
  readonly levels?: readonly (readonly string[])[]
  /**
   * Results the turn writes before `reply`, each ending a turn of its own while one
   * background task is alive; the task ends before `reply`. What a real agent does when
   * it has nothing left but to wait: it says so, the CLI ends the turn, and the task's
   * report starts another in the same process.
   */
  readonly earlier?: readonly string[]
  /**
   * An MCP tool the turn calls before answering, on a server that offers a view for it.
   * The call's events are emitted as a provider emits them, and the fake then answers
   * what the engine asks about that server — the tool list, the view's HTML, a call —
   * so keeping a view and pressing one can be driven with no CLI.
   */
  readonly view?: ScriptedView
  /**
   * The turn never comes back.
   *
   * The only way to hold a trak in `AgentWorking` deterministically, which is what
   * anything asserting on a drive *in flight* needs — a scripted turn is otherwise
   * instantaneous, so "act while it is running" would be a race the test usually
   * loses. It is the fake standing in for a real agent thinking for two minutes,
   * not for one that has hung.
   *
   * Whoever stages it is responsible for the interrupt: the fiber is released when
   * the scope that forked it closes, which for a flow test is `runFlow`'s own.
   */
  readonly hangs?: boolean
  /**
   * What the turn reports having spent before it hangs — a `Usage` on the stream
   * after `Spawned`, as a real turn reports each time the CLI writes a result line.
   * With `hangs`, what a stop finds on the run record is what the turn had reported by
   * then; with `crash`, what its `TurnFailed` has to carry.
   */
  readonly spends?: Parameters<typeof ProviderEvent.Usage>[0]
  /**
   * A context reading the turn reports before it hangs, after `spends` — what a real
   * Claude turn sends at every model call, long before its one `Usage` on the `result`
   * line. Only with `hangs`, for `spends`' reason.
   */
  readonly reads?: Parameters<typeof ProviderEvent.Occupancy>[0]
  /**
   * One `Thinking` each, after its effect completes, on a turn that `hangs` — a provider
   * still talking, at moments the test picks, for a reader of when it last said anything.
   */
  readonly paces?: readonly Effect.Effect<void>[]
  /** The runner's exec id on the turn's `Spawned`, as a spawn in a sandbox reports it. */
  readonly execId?: string
  /**
   * Answer only once this has completed.
   *
   * `hangs` for a turn that has to *finish*: what a test about acting on a trak
   * mid-turn needs when the assertion is about the turn coming back afterwards — a
   * changed mode being picked up at the gate the turn ends at, on the session it was
   * already holding. The test holds the `Deferred` and releases it when it has done
   * whatever it wanted to do while the agent was "thinking".
   */
  readonly until?: Effect.Effect<void>
  /**
   * The session the turn announces in place of the request's — a provider that mints
   * its own id (`ResumeStrategy.ReportedId`, which is Codex) never knew the one the
   * runtime minted, and says so on `thread.started`. Announced after `Spawned` on a
   * turn that `hangs` too, so a turn stopped mid-flight has already said which
   * conversation it is.
   */
  readonly announces?: SessionId
  /**
   * The turn takes messages steered into it, as a CLI with streaming input does.
   *
   * `Spawned` first, since that is the moment the runtime hands a process what is
   * waiting; then the session, then one `MessageDelivered` per message steered by
   * then, before the answer. Without it `steer` answers `false` — the turn of a CLI
   * with no open pipe.
   *
   * **`until` is waited out with the pipe open and the session announced**, where every
   * other turn waits before its first event: a message sent while the turn is held is
   * steered by whatever id the run record gives for it, which under `announces` is
   * not the one the pipe is held by.
   */
  readonly hears?: boolean
}

// -- preconditions ----------------------------------------------------------

/**
 * A turn that starts and never answers — see `Turn.hangs`.
 *
 * What anything asserting on a drive *in flight* needs: every other turn here is
 * instantaneous, so "act while it is running" would be a race rather than a state.
 */
export const hangsOn = (
  pattern: RegExp,
  label = `hangs:${String(pattern)}`,
  spends?: Parameters<typeof ProviderEvent.Usage>[0],
): Turn => ({
  label,
  when: (r) => pattern.test(r.prompt),
  reply: "",
  hangs: true,
  ...(spends === undefined ? {} : { spends }),
})

export const onPrompt = (pattern: RegExp, reply: string, label = String(pattern)): Turn => ({
  label,
  when: (r) => pattern.test(r.prompt),
  reply,
})

/** A turn that starts, waits for `until`, and then answers — see `Turn.until`. */
export const onPromptAfter = (
  pattern: RegExp,
  until: Effect.Effect<void>,
  reply: string,
  label = `after:${String(pattern)}`,
): Turn => ({
  label,
  when: (r) => pattern.test(r.prompt),
  reply,
  until,
})

/** Matches only a retry/continuation of an existing session. */
/** Matches anything — for asserting what happens when nothing ever works. */
export const always = (reply: string, label = "always"): Turn => ({
  label,
  when: () => true,
  reply,
  repeatable: true,
})

export const onResume = (reply: string, label = "resume"): Turn => ({
  label,
  when: (r) => r.resumeFrom !== undefined,
  reply,
})

/** The CLI dying mid-turn — a dropped connection, a usage limit hit mid-response. */
export const crashesOn = (pattern: RegExp, reason: string, label = "crash"): Turn => ({
  label,
  when: (r) => pattern.test(r.prompt),
  reply: "",
  crash: { reason, sessionStarted: true },
})

/** The same, on a retry: whatever was down is still down. */
export const crashesOnResume = (reason: string, label = "crash on resume"): Turn => ({
  label,
  when: (r) => r.resumeFrom !== undefined,
  reply: "",
  crash: { reason, sessionStarted: true },
})

/**
 * The CLI exiting non-zero before it ever made a session — a missing binary,
 * expired auth, a usage limit rejected at startup.
 *
 * The same `ProviderFailed` as `crashesOn` and a different fact about the world:
 * the id the runtime minted names nothing, so recording it would make every
 * retry pass `--resume` for a conversation that does not exist.
 */
export const failsToStartOn = (
  pattern: RegExp,
  reason: string,
  label = "startup failure",
): Turn => ({
  label,
  when: (r) => pattern.test(r.prompt),
  reply: "",
  crash: { reason, sessionStarted: false },
})

/** The CLI refusing the credential it was started with, before it made a session. */
export const refusesSignInOn = (pattern: RegExp, label = "refused sign-in"): Turn => ({
  label,
  when: (r) => pattern.test(r.prompt),
  reply: "",
  crash: { reason: "Invalid API key · Please run /login", sessionStarted: false, kind: "auth" },
})

/** The failure a crashing turn ends on, with its in-band kind where it has one. */
const crashed = (crash: NonNullable<Turn["crash"]>): ProviderFailed =>
  new ProviderFailed({
    provider: "scripted",
    reason: crash.reason,
    ...(crash.kind === undefined ? {} : { kind: crash.kind }),
    ...(crash.gone === undefined ? {} : { gone: crash.gone }),
  })

/** `turn`, having first said each of `earlier` while a background task ran — see `Turn.earlier`. */
export const afterWaiting = (earlier: readonly [string, ...string[]], turn: Turn): Turn => ({
  ...turn,
  earlier,
})

// -- replies ----------------------------------------------------------------

const fence = (body: unknown): string => `\`\`\`json\n${JSON.stringify(body)}\n\`\`\``

/**
 * A plan entry as a scripted composer writes it: an agent's turn, a spawn, or a
 * compose the composer schedules for itself.
 *
 * Loose on purpose — this is the fake writing JSON by hand, and what holds it to
 * the contract is `ComposerOutputFor` decoding it, which is the thing under test.
 */
export interface ScriptedStep {
  readonly type?: "agent" | "spawn" | "compose"
  readonly agent?: string
  readonly instruction: string
  readonly conversational?: boolean
  /** The artifact key of a document whose conversation this step picks up. */
  readonly continues?: string
  /** When the step may start, as the composer spells it — an hour, or a duration. */
  readonly wait_until?: string
  /** An engine condition the step waits on itself — `merged` or `deployed`. */
  readonly wait_for?: string
  readonly children?: readonly Child[]
}

/**
 * The last entry of a plan that stops short: *ask me again once this has run.*
 *
 * A step like any other, which is the point — it takes a position, it is approved
 * with the rest of the plan, and reaching it is what asks the composer again.
 */
export const stopShort = (question: string): ScriptedStep => ({
  type: "compose",
  instruction: question,
})

export const reply = {
  /**
   * A schema-valid StepOutput for any agent whose output is one required
   * `Summary` — which is three of the four in the fixture fleet, and the shape
   * most real agents have.
   *
   * There is no prose form any more: every agent declares an output, so an
   * artifact is always `sections`.
   *
   * **Every artifact here reports a rung**, because a live turn that leaves it out is
   * re-prompted — see `StepOutputFor`. `none` is the default rather than a parameter
   * every flow would have to pass, and it is what most turns write; a flow about the
   * gate the other rungs open passes one.
   */
  artifact: (summary: string, ambiguity: Ambiguity = "none") =>
    fence({ type: "artifact", ambiguity, sections: { Summary: summary } }),
  /** An artifact for an agent that declares more than the one section. */
  sectioned: (sections: Readonly<Record<string, string>>) =>
    fence({ type: "artifact", ambiguity: "none", sections }),
  /**
   * An artifact that also records what the turn understood. Separate from
   * `artifact` rather than an optional argument, because most turns record
   * nothing and a default nobody passes reads as one they might.
   *
   * The caller supplies the `kind`, and it decides whether anything happens: see
   * `raising` for the one that sends the plan back.
   */
  deciding: (summary: string, requirements: readonly Decided[]) =>
    fence({ type: "artifact", ambiguity: "none", sections: { Summary: summary }, requirements }),
  /**
   * A requirement and nothing else — the envelope a chat sends when the
   * conversation settled something without changing a section.
   */
  settling: (requirements: readonly Decided[]) =>
    fence({ type: "artifact", ambiguity: "none", sections: {}, requirements }),
  questions: (...qs: readonly string[]) =>
    fence({ type: "questions", questions: qs.map((question) => ({ question, options: [] })) }),
  /**
   * An artifact that also names work the plan does not have. It names no destination:
   * the composer turns the entries into steps, and a human approves the plan that
   * comes back. There is no rejecting counterpart — a review that sends work back is
   * exactly this.
   *
   * `unplanned_work` is what makes it the raising one, and is the whole of what
   * separates it from `deciding` — that fixture's entries settle something and buy
   * no turn.
   */
  raising: (summary: string, texts: readonly [string, ...string[]]) =>
    fence({
      type: "artifact",
      ambiguity: "none",
      sections: { Summary: summary },
      requirements: texts.map((text) => ({ text, source: "assumed", kind: "unplanned_work" })),
    }),
  /**
   * An artifact that also says a document already filed is not good enough to work
   * from. `at` is that document's key, which is the one provenance an agent writes.
   */
  correcting: (summary: string, at: string, text: string) =>
    fence({
      type: "artifact",
      ambiguity: "none",
      sections: { Summary: summary },
      corrections: [{ at, text }],
    }),
  /**
   * A step that could not do the work. Four named fields, no sections, and
   * nothing files the document.
   */
  stuck: (tried: string) =>
    fence({
      type: "stuck",
      tried,
      happened: "it timed out",
      diagnosis: "the fixture is not the problem",
    }),
  /**
   * A stuck account that records something on its way out. The pair `stuck` and
   * this one exist because a ruled-out approach is often the most valuable thing
   * a turn that failed produces — and its account is filed nowhere, which is
   * what makes the decisions worth asserting separately.
   */
  decidingStuck: (tried: string, decisions: readonly Decided[]) =>
    fence({
      type: "stuck",
      tried,
      happened: "it timed out",
      diagnosis: "the fixture is not the problem",
      decisions,
    }),
  /**
   * The shape a step may NOT return. Kept for the tests that assert `elicit`
   * re-prompts it: nothing an agent judges ends a trak, so a step that cannot
   * proceed returns `stuck` instead, which stops for a person.
   */
  failed: (error: string) => fence({ type: "failed", error }),
  /**
   * A Proposal, for the composer.
   *
   * A step is an agent and an instruction, and nothing else required — the shape,
   * the checks and the artifact's name are all properties of the agent or assigned
   * by the engine. `title` is set once and never revised.
   *
   * `conversational` is the one optional field on a step, and it is passed through
   * as given so a test can propose a plan that omits it — which is what every log
   * written before the field existed looks like.
   *
   * A plan that stops short says so with a compose entry — `stopShort` below —
   * which is an ordinary member of `steps` and needs nothing here.
   */
  proposal: (title: string, steps: readonly ScriptedStep[], ambiguity: Ambiguity = "none") =>
    fence({ type: "proposal", title, ambiguity, steps }),
  /** The same, with work handed off to traks of its own beside the steps. */
  proposalHandingOff: (
    title: string,
    steps: readonly ScriptedStep[],
    handOff: readonly [string, ...string[]],
  ) => fence({ type: "proposal", title, ambiguity: "none", steps, handOff }),
  /**
   * The composer saying the work is already done — and, where it hands work off, the
   * descriptions each opening a trak on the default branch.
   */
  finished: (reason: string, handOff?: readonly [string, ...string[]]) =>
    fence({ type: "finished", reason, ...(handOff === undefined ? {} : { handOff }) }),
  /** The composer saying the work is done, and proposing the goal it leads to. */
  finishedProposingGoal: (reason: string, goal: string) =>
    fence({ type: "finished", reason, goal }),
  /** Questions with options, as the composer or a step may ask them. */
  askWithOptions: (question: string, ...labels: readonly string[]) =>
    fence({
      type: "questions",
      questions: [{ question, options: labels.map((label) => ({ label })) }],
    }),
  /**
   * Prose with no JSON. What it means depends on who asked: `elicit` retries it,
   * `converse` takes it as the answer — which is the whole of the chat feature.
   */
  prose: (text: string) => text,
}

// -- the fake ---------------------------------------------------------------

/**
 * A pid for the process a crashed turn is pretending to be. Fixed, because
 * everything else about a scenario is: `Runs` only ever compares it to itself.
 */
const CRASHED_PID = 4242

/**
 * The results a turn ends on: `reply`, and before it the events of `Turn.earlier` —
 * the task appears, each earlier result is written, the task ends.
 */
const resultsOf = (turn: Turn): readonly ProviderEvent[] => {
  const last = ProviderEvent.Result({ text: turn.reply })
  if (turn.earlier === undefined) return [last]
  return [
    ProviderEvent.BackgroundTasks({
      tasks: [{ id: "waited-on", taskType: "local_bash", description: undefined }],
    }),
    ...turn.earlier.map((text) => ProviderEvent.Result({ text })),
    ProviderEvent.BackgroundTasks({ tasks: [] }),
    last,
  ]
}

export interface AgentLog {
  /** Every request the agent received, in order — assert on what it was asked. */
  readonly requests: readonly SessionRequest[]
  /** Which turn matched each request. */
  readonly matched: readonly string[]
  /** What the fake replied to each request. Powers the prompt transcripts. */
  readonly replies: readonly string[]
  /** Every CLI started with no prompt, to answer a press on a view. */
  readonly attended: readonly SessionRequest[]
}

/** Each scripted level as the event a provider emits for it — see `Turn.levels`. */
const levelEvents = (
  levels: readonly (readonly string[])[] | undefined,
): readonly ProviderEvent[] =>
  (levels ?? []).map((ids) =>
    ProviderEvent.BackgroundTasks({
      tasks: ids.map((id) => ({ id, taskType: "local_bash", description: undefined })),
    }),
  )

/** One MCP call a scripted turn makes, and the server behind it — see `Turn.view`. */
export interface ScriptedView {
  readonly call: string
  readonly server: string
  readonly tool: string
  readonly uri: string
  readonly html: string
  /** Other tools on the server a view may call, and ones it may not. */
  readonly open: readonly string[]
  readonly modelOnly: readonly string[]
}

/** What a provider emits around one MCP call: the call, its outcome, and its payload. */
const viewEvents = (view: ScriptedView | undefined): readonly ProviderEvent[] =>
  view === undefined
    ? []
    : [
        ProviderEvent.ToolUse({
          name: "mcp_tool_call",
          kind: "Mcp",
          detail: `${view.server}/${view.tool}`,
          command: undefined,
          backgrounded: undefined,
          call: view.call,
          parent: undefined,
        }),
        ProviderEvent.ToolResult({ ok: true, call: view.call, parent: undefined }),
        ProviderEvent.McpReturned({
          call: view.call,
          server: view.server,
          tool: view.tool,
          arguments: { shown: view.tool },
          result: { content: [{ type: "text", text: "count is 0" }], isError: false },
        }),
      ]

const toolsOf = (view: ScriptedView): readonly McpTool[] => [
  { server: view.server, name: view.tool, callName: view.tool, view: view.uri, openToViews: true },
  ...view.open.map((name) => ({
    server: view.server,
    name,
    callName: name,
    view: undefined,
    openToViews: true,
  })),
  ...view.modelOnly.map((name) => ({
    server: view.server,
    name,
    callName: name,
    view: undefined,
    openToViews: false,
  })),
]

/**
 * What stands behind a scripted turn. No process, so no pipe to write a stop down. An
 * MCP server only where a turn scripts a view, and then it answers for any session: a
 * fake has no pipe to be absent, so *started* and *in a turn* answer alike.
 */
const behind = (turns: readonly Turn[], attended: (req: SessionRequest) => Effect.Effect<void>) => {
  const views = turns.flatMap((t) => (t.view === undefined ? [] : [t.view]))
  const answer = (request: McpRequest) => {
    switch (request._tag) {
      case "ListTools":
        return McpAnswer.Tools({ tools: views.flatMap(toolsOf) })
      case "ReadResource": {
        const view = views.find((v) => v.uri === request.uri)
        return view === undefined
          ? undefined
          : McpAnswer.Resource({ resource: { text: view.html, policy: undefined } })
      }
      case "CallTool":
        return McpAnswer.Result({
          result: {
            content: [{ type: "text", text: `${request.tool} called` }],
            structured: { tool: request.tool, arguments: request.arguments },
            isError: false,
          },
        })
    }
  }
  return {
    stopBackgroundTask: () => Effect.succeed(false),
    mcp: (_: SessionId, request: McpRequest) =>
      Effect.succeed(views.length === 0 ? undefined : answer(request)),
    attend: (req: SessionRequest) =>
      Effect.zipRight(
        attended(req),
        views.length === 0
          ? Effect.fail(new ProviderFailed({ provider: "scripted", reason: "nothing to start" }))
          : Effect.void,
      ),
  }
}

/**
 * The fake's stand-in for the harness's held-open pipes: the sessions whose turn
 * `hears`, and what each has been steered so far. Apart from `scriptedAgent`, which
 * is at its length.
 */
const heldPipes = Effect.gen(function* () {
  const hearing = yield* Ref.make<ReadonlyMap<SessionId, readonly SteeredMessage[]>>(new Map())
  /** What the turn was steered, as the deliveries a CLI reports, closing the session. */
  const heard = (sessionId: SessionId): Stream.Stream<ProviderEvent> =>
    Stream.unwrap(
      Ref.modify(hearing, (open) => {
        const rest = new Map(open)
        rest.delete(sessionId)
        const said = open.get(sessionId) ?? []
        return [
          Stream.fromIterable(
            said.map((m) => ProviderEvent.MessageDelivered({ text: m.text, key: m.key })),
          ),
          rest,
        ]
      }),
    )
  return {
    /**
     * A turn's events as its stream — as they are, unless it hears: then the session
     * is open before `Spawned` is emitted, as the harness registers a
     * pipe, and read after it — by which time the runtime has steered whatever waited.
     * `held` is the hearing turn's wait, `undefined` for a turn that does not hear;
     * it sits after the turn's first event, which is its session.
     */
    replayed: (
      held: Effect.Effect<void> | undefined,
      sessionId: SessionId,
      events: readonly ProviderEvent[],
    ): Effect.Effect<Stream.Stream<ProviderEvent>> =>
      held === undefined
        ? Effect.succeed(Stream.fromIterable(events))
        : Effect.as(
            Ref.update(hearing, (open) => new Map(open).set(sessionId, [])),
            Stream.concat(
              Stream.fromIterable([
                ProviderEvent.Spawned({ pid: CRASHED_PID }),
                ...events.slice(0, 1),
              ]),
              Stream.concat(
                Stream.drain(Stream.fromEffect(held)),
                Stream.concat(heard(sessionId), Stream.fromIterable(events.slice(1))),
              ),
            ),
          ),
    steer: (sessionId: SessionId, message: SteeredMessage): Effect.Effect<boolean> =>
      Ref.modify(hearing, (open) => {
        const steered = open.get(sessionId)
        return steered === undefined
          ? [false, open]
          : [true, new Map(open).set(sessionId, [...steered, message])]
      }),
  }
})

/**
 * A turn that `hangs`: `Spawned` first, so the trak looks like what it is — a turn that
 * started and has not answered — rather than one that never began, then what it reports
 * before it hangs, one `Thinking` per pace, and nothing more. Annotated because
 * `Stream.never` carries no element type of its own, and concatenating it would otherwise
 * widen the whole stream away.
 */
const hanging = (turn: Turn): Stream.Stream<ProviderEvent, ProviderFailed> => {
  const paced = (turn.paces ?? []).map((pace) =>
    Stream.fromEffect(Effect.as(pace, ProviderEvent.Thinking({ tokens: 1, text: undefined }))),
  )
  return Stream.concat(
    Stream.fromIterable<ProviderEvent>([
      ProviderEvent.Spawned({
        pid: CRASHED_PID,
        ...(turn.execId === undefined ? {} : { execId: turn.execId }),
      }),
      ...(turn.announces === undefined
        ? []
        : [ProviderEvent.SessionStarted({ id: turn.announces })]),
      ...(turn.spends === undefined ? [] : [ProviderEvent.Usage(turn.spends)]),
      ...(turn.reads === undefined ? [] : [ProviderEvent.Occupancy(turn.reads)]),
    ]),
    Stream.concat(Stream.concatAll(Chunk.fromIterable(paced)), Stream.never),
  )
}

export const scriptedAgent = (
  turns: readonly Turn[],
): Effect.Effect<{
  readonly layer: Layer.Layer<Provider>
  readonly log: Effect.Effect<AgentLog>
}> =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<{
      requests: SessionRequest[]
      matched: string[]
      replies: string[]
      attended: SessionRequest[]
    }>({ requests: [], matched: [], replies: [], attended: [] })
    const used = yield* Ref.make<ReadonlySet<number>>(new Set())
    const pipes = yield* heldPipes

    const run = (req: SessionRequest): Stream.Stream<ProviderEvent, ProviderFailed> =>
      Stream.unwrap(
        Effect.gen(function* () {
          // First unused turn whose precondition holds. "Unused" keeps repeated
          // identical requests progressing instead of looping on one answer.
          const done = yield* Ref.get(used)
          const idx = turns.findIndex((t, i) => !done.has(i) && t.when(req))
          const turn = idx === -1 ? undefined : turns[idx]
          yield* Ref.update(seen, (s) => ({
            ...s,
            requests: [...s.requests, req],
            matched: [...s.matched, turn?.label ?? "UNMATCHED"],
            replies: [...s.replies, turn?.reply ?? "(no turn matched — ApiError)"],
          }))
          if (idx !== -1 && turn?.repeatable !== true) {
            yield* Ref.update(used, (u) => new Set([...u, idx]))
          }
          // Held here, before any event, so the trak reads as a turn that has started
          // and not answered for as long as the test wants — the shape `hangs` gives,
          // with an ending. A turn that hears is held further down — see `Turn.hears`.
          if (turn?.until !== undefined && turn.hears !== true) yield* turn.until
          // The shape `cli-provider.ts` produces: `Spawned` the moment the
          // process exists, then whatever the CLI managed to say, then a failure
          // at the *end* of the stream where the non-zero exit is noticed.
          // Failing before any event said the process never started, which no
          // real provider does — and it meant a crashed turn never exercised
          // `withTranscript`'s `runs.spawned` path, nor the `SessionStarted` that
          // decides whether the failure has a session worth recording.
          if (turn?.hangs === true) return hanging(turn)
          const crash = turn?.crash
          if (crash !== undefined) {
            return Stream.concat(
              Stream.fromIterable<ProviderEvent>([
                ProviderEvent.Spawned({ pid: CRASHED_PID }),
                ...(crash.sessionStarted
                  ? [ProviderEvent.SessionStarted({ id: turn?.announces ?? req.sessionId })]
                  : []),
                ...(turn?.spends === undefined ? [] : [ProviderEvent.Usage(turn.spends)]),
              ]),
              Stream.fail(crashed(crash)),
            )
          }
          const events: readonly ProviderEvent[] =
            turn === undefined
              ? [
                  ProviderEvent.ApiError({
                    // `unclassified` and not a borrowed kind: an unmatched prompt is
                    // this harness running out of script, not a provider vocabulary,
                    // and filing it under one would put a fake's failure in the same
                    // bucket a retry policy reads.
                    kind: "unclassified",
                    message: `no scripted turn matched prompt: ${req.prompt.slice(0, 80)}`,
                  }),
                ]
              : [
                  ProviderEvent.SessionStarted({ id: turn.announces ?? req.sessionId }),
                  // Rising estimates, as claude reports them: the count climbs
                  // through a burst, which is why the first tick's is not the one
                  // to write down.
                  ...Array.from({ length: turn.thinks ?? 0 }, (_, i) =>
                    ProviderEvent.Thinking({ tokens: (i + 1) * 50, text: undefined }),
                  ),
                  // After the ticks rather than beside the first announcement: a real
                  // re-entry lands mid-turn, and it is what ends a burst of thinking.
                  ...Array.from({ length: turn.reannounces ?? 0 }, () =>
                    ProviderEvent.SessionStarted({ id: turn.announces ?? req.sessionId }),
                  ),
                  ...levelEvents(turn.levels),
                  ...viewEvents(turn.view),
                  ...resultsOf(turn),
                ]
          const held = turn?.hears === true ? (turn.until ?? Effect.void) : undefined
          return yield* pipes.replayed(held, req.sessionId, events)
        }),
      )

    return {
      layer: Layer.succeed(
        Provider,
        registryOf({
          name: "scripted",
          run,
          resume: { _tag: "SuppliedId" },
          // A line a person could type, so a handoff on the wire names the session.
          resumeLine: (sessionId) => `scripted --resume ${sessionId}`,
          credentials: ["SCRIPTED_TOKEN"],
          steer: pipes.steer,
          ...behind(turns, (req) =>
            Ref.update(seen, (s) => ({ ...s, attended: [...s.attended, req] })),
          ),
        }),
      ),
      log: Ref.get(seen),
    }
  })
