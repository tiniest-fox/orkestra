// logic: one provider event as the entry the store keeps.

import { Match } from "effect"
import type { ProviderEvent } from "../types/provider-event.js"
import {
  ApiRetryEntry,
  BackgroundEntry,
  BackgroundStartedEntry,
  DeniedEntry,
  HookEntry,
  NoteEntry,
  ReaskEntry,
  SaidEntry,
  SessionEntry,
  SpawnedEntry,
  SubagentEntry,
  SubagentResultEntry,
  TextEntry,
  ToolEntry,
  type TranscriptEntry,
} from "../types/transcript-entry.js"
import { eventLine } from "./event-line.js"

/**
 * Spread rather than assigned everywhere below, because `undefined` is not a legal value
 * of an exact optional and absent is what a line the agent wrote itself has.
 */
const inside = (parent: string | undefined): { parent?: string } =>
  parent === undefined ? {} : { parent }

/**
 * Twelve events earn structure; the rest become the line `eventLine` already writes.
 *
 * Delegating the `Note` arm rather than restating it is what keeps one rendering of an
 * `ApiError` or a `Usage` in the codebase. `orElse` is safe here because `eventLine` is
 * exhaustive: a new `ProviderEvent` kind is a compile error there before it reaches this.
 */
export const entryOf = (event: ProviderEvent): TranscriptEntry =>
  Match.value(event).pipe(
    Match.tag("Spawned", (e) =>
      SpawnedEntry.make({
        pid: e.pid,
        ...(e.execId === undefined ? {} : { execId: e.execId }),
        ...(e.place === undefined ? {} : { place: e.place }),
      }),
    ),
    Match.tag("Reask", (e) => ReaskEntry.make({ reason: e.reason })),
    Match.tag("SessionStarted", (e) => SessionEntry.make({ id: e.id })),
    // Whole, where `eventLine` writes the length: this is the only record of what the
    // agent said, and a count of it answers nothing.
    Match.tag("TextDelta", (e) => TextEntry.make({ text: e.text, ...inside(e.parent) })),
    Match.tag("ToolUse", (e) =>
      ToolEntry.make({
        name: e.name,
        kind: e.kind,
        ...(e.detail === undefined ? {} : { detail: e.detail }),
        ...(e.command === undefined ? {} : { command: e.command }),
        // Only ever `true` on the event — absent is what an inline call has, and what
        // every call already on disk has.
        ...(e.backgrounded === undefined ? {} : { backgrounded: e.backgrounded }),
        ...(e.call === undefined ? {} : { call: e.call }),
        ...inside(e.parent),
      }),
    ),
    Match.tag("MessageDelivered", (e) => SaidEntry.make({ text: e.text })),
    Match.tag("ApiRetry", (e) =>
      ApiRetryEntry.make({
        attempt: e.attempt,
        of: e.of,
        ...(e.status === undefined ? {} : { status: e.status }),
        ...(e.waitedMs === undefined ? {} : { waitedMs: e.waitedMs }),
      }),
    ),
    Match.tag("SubagentStarted", (e) =>
      SubagentEntry.make({
        call: e.call,
        ...(e.agentType === undefined ? {} : { agentType: e.agentType }),
        ...(e.description === undefined ? {} : { description: e.description }),
        ...(e.prompt === undefined ? {} : { prompt: e.prompt }),
      }),
    ),
    Match.tag("SubagentResult", (e) =>
      SubagentResultEntry.make({
        call: e.call,
        ok: e.ok,
        ...(e.summary === undefined ? {} : { summary: e.summary }),
        ...(e.outcome === undefined ? {} : { outcome: e.outcome }),
        ...(e.taskId === undefined ? {} : { taskId: e.taskId }),
      }),
    ),
    // Element by element rather than spread, because the entry's exact optionals may not
    // hold an explicit `undefined` and the event's fields do.
    Match.tag("BackgroundTasks", (e) =>
      BackgroundEntry.make({
        tasks: e.tasks.map((t) => ({
          id: t.id,
          ...(t.taskType === undefined ? {} : { taskType: t.taskType }),
          ...(t.description === undefined ? {} : { description: t.description }),
        })),
      }),
    ),
    Match.tag("BackgroundStarted", (e) =>
      BackgroundStartedEntry.make({
        taskId: e.taskId,
        call: e.call,
        ...(e.description === undefined ? {} : { description: e.description }),
      }),
    ),
    Match.tag("HookRan", (e) =>
      HookEntry.make({
        ...(e.call === undefined ? {} : { call: e.call }),
        event: e.event,
        status: e.status,
        ...(e.durationMs === undefined ? {} : { durationMs: e.durationMs }),
        ...(e.source === undefined ? {} : { source: e.source }),
        ...(e.message === undefined ? {} : { message: e.message }),
        output: e.output.map((o) => ({ kind: o.kind, text: o.text })),
      }),
    ),
    Match.tag("PermissionDenied", (e) =>
      DeniedEntry.make({
        ...(e.call === undefined ? {} : { call: e.call }),
        tool: e.tool,
        ...(e.reason === undefined ? {} : { reason: e.reason }),
        ...(e.source === undefined ? {} : { source: e.source }),
      }),
    ),
    // A `Note` like every other, and the one that keeps both ids. `parent` because a
    // subagent's call outcomes have to travel with the subagent, or the group cannot say
    // how many of its calls failed and the parent's list grows a row per call it never
    // made; `call` because this is the answer to one of them, and a surface that had to
    // count them onto the calls above gets it wrong the moment two are open at once.
    Match.tag("ToolResult", (e) =>
      NoteEntry.make({
        text: eventLine(e),
        ...(e.call === undefined ? {} : { call: e.call }),
        ...inside(e.parent),
      }),
    ),
    Match.orElse((e) => NoteEntry.make({ text: eventLine(e) })),
  )
