// The stream frames that say a trak moved: what it became, that it is gone, that the
// stream dropped frames, and who drives it. A slice of their own, apart from `stream.ts`,
// because the host's watcher reads only these and has no use for the rest of the stream.
// Part of the wire contract; `common.ts` says how the slices fit together.

import { Schema } from "effect"
import { EventDto } from "./log.js"
import { CustodyDto, TrakProjectionDto } from "./trak.js"

/**
 * A log event was written, and what the trak became.
 *
 * **`seq` is a line number, not a cursor.** 1-based into that trak's `log.jsonl`, so a
 * reader holding 12 that receives 15 knows it missed two and re-reads *that trak*. It
 * is deliberately not the SSE `id:`, which is daemon-global and is what a reconnect
 * resumes from — one stream carries every trak, so the two cannot be the same number.
 *
 * **The whole projection rides, not the event alone.** Applying the event to work out
 * the state would mean keeping a second copy of the state machine, which is the thing
 * `client-style` bans outright — and the same goes for every other field the engine
 * derives: a hold or a skip is spent by an event that says nothing about it, a mark is
 * stamped from the decision, a plan is re-cut by a `ComposerReturned` whose proposal is
 * not the plan. So the fields are `TrakProjectionDto`'s, spread rather than listed, and
 * a screen holding a `TrakDetailDto` replaces them wholesale on every frame. What it
 * cannot carry is what no append can: custody, which `DriveFrameDto` is for, and
 * `nextChecks`, which is the library's answer rather than the log's.
 */
export const AppendedFrameDto = Schema.TaggedStruct("Appended", {
  trak: Schema.String,
  seq: Schema.Number,
  event: EventDto,
  ...TrakProjectionDto.fields,
})
export type AppendedFrameDto = Schema.Schema.Type<typeof AppendedFrameDto>

/** The trak is gone. Forget it — re-reading would 404. */
export const RemovedFrameDto = Schema.TaggedStruct("Removed", { trak: Schema.String })
export type RemovedFrameDto = Schema.Schema.Type<typeof RemovedFrameDto>

/**
 * Frames were dropped before this subscriber caught up, so nothing it holds can be
 * trusted to be contiguous — re-read everything.
 *
 * The transport synthesises this one; it corresponds to no append. It is in the union
 * rather than beside it so a client handles the stream in one exhaustive switch, and
 * because ignoring it is exactly the bug it exists to prevent: a projection quietly
 * missing the middle looks identical to one that is right.
 */
export const ResyncFrameDto = Schema.TaggedStruct("Resync", {})
export type ResyncFrameDto = Schema.Schema.Type<typeof ResyncFrameDto>

/**
 * A drive was taken or let go — who is driving this trak, and nothing else.
 *
 * **The one frame that corresponds to no append, and the reason it has to exist.**
 * Custody is the daemon's own claim rather than anything in the log: it is taken by
 * `runs.adopt` (`src/app/drive.ts`) and released by the scope closing around it
 * (`src/workflow/adapters/runs-file.ts`), which happens *after* the drive's last log
 * line. So no `Appended` frame can ever carry the release, however wide it gets — the
 * release has not happened when the last one goes out.
 *
 * Every press on a trak's screen is gated on this (`TrakDetailPage.tsx`), so a drawer
 * that learned it only by re-reading would draw an artifact beside buttons that refuse.
 *
 * `custody` whole rather than a boolean, so a watcher replaces what it holds rather
 * than reconciling with it — the same rule the check family follows.
 */
export const DriveFrameDto = Schema.TaggedStruct("Drive", {
  trak: Schema.String,
  custody: CustodyDto,
})
export type DriveFrameDto = Schema.Schema.Type<typeof DriveFrameDto>
