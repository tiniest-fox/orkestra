/**
 * One stream frame applied to a trak we already hold, or nothing.
 *
 * **Patching rather than refetching is only safe because `seq` says so.** A frame
 * carries the line number it occupies in the trak's own file, so a client can tell the
 * next line from a later one — and applying a later one would leave a log with a hole
 * in it that reads exactly like a complete log. `undefined` is that case, and the
 * caller's answer to it is to ask the server again.
 *
 * **It does not reach the cache, and that is the whole reason it is a separate file.**
 * A reducer that also invalidated queries could only be exercised through React; this
 * one is a function from a value and a frame to a value, so the rule it exists to get
 * right is a tier-1 test.
 *
 * Kind `pure` in `client-style`'s admission table: a `.ts` outside `api/` importing
 * nothing but the contract's types.
 */

import type {
  AppendedFrameDto,
  CliUsagesDto,
  EngineFrameDto,
  HostedProcessDto,
  ProcessFrameDto,
  ProcessOutputFrameDto,
  TrakDetailDto,
  TrakProjectionDto,
  UsageFrameDto,
} from "./api/types"

/**
 * The projection as the frame carries it, and nothing else off the frame.
 *
 * Named field by field rather than spread, because a spread of the frame would put its
 * `_tag`, `trak`, `seq` and `event` on the detail. The return type is what keeps the
 * list honest: a required field added to `TrakProjectionDto` fails to compile here until
 * it is copied across — an optional one does not, so each is named here by hand.
 * `plan`, `worktree`, `waiting` and `landed` are assigned even when absent, so the frame
 * is authoritative for them too rather than leaving a held value standing: a wait that
 * passed takes `waiting` off the frame, and a held value would keep drawing a block for
 * a step that is now running.
 */
const projectionOf = (frame: AppendedFrameDto): TrakProjectionDto => ({
  mode: frame.mode,
  holding: frame.holding,
  skippingChecks: frame.skippingChecks,
  messages: frame.messages,
  returned: frame.returned,
  state: frame.state,
  plan: frame.plan,
  worktree: frame.worktree,
  waiting: frame.waiting,
  landed: frame.landed,
  decisions: frame.decisions,
  marks: frame.marks,
})

export const applyFrame = (
  cached: TrakDetailDto,
  frame: EngineFrameDto,
): TrakDetailDto | undefined => {
  switch (frame._tag) {
    case "Appended":
      // Every derived field is taken from the frame rather than worked out from the
      // event: deriving the state would mean a second copy of the engine's state
      // machine in the client, which is the one thing `client-style` bans outright,
      // and the same holds for a hold or a skip spent, a mark stamped or a plan re-cut.
      // The frame carries the whole of `TrakProjectionDto`, so **nothing the log
      // derives waits for a re-read** — and it must not, because writing a frame into
      // the cache re-arms the poll, which therefore never fires while a turn is busy.
      //
      // What is left as held is what no append can say: `custody`, which arrives on a
      // `Drive` frame; `check`, which the check family replaces; and `nextChecks`,
      // which the library answers and the log does not, so it alone waits for the poll
      // while the `plan` it is read from arrives here.
      return frame.seq === cached.log.length + 1
        ? {
            ...cached,
            log: [...cached.log, frame.event],
            ...projectionOf(frame),
          }
        : undefined
    case "Activity":
      return frame.seq === cached.transcript.length + 1
        ? { ...cached, transcript: [...cached.transcript, frame.entry] }
        : undefined
    // A run replaces whatever was held, rather than being reconciled with it: it names
    // its own position and carries its own output, so an earlier run at an earlier
    // position has nothing to contribute to it.
    case "CheckStarted":
    case "CheckEnded":
      return { ...cached, check: frame.run }
    case "CheckOutput":
      // The same rule the two appends follow, over the one count this family has: a
      // chunk that is not the next one means something was missed, and appending it
      // would leave a console with a hole in it that reads as complete. A chunk for a
      // position we are not holding a run for is the same answer — ask the server,
      // which is where a run lives at all.
      return cached.check !== undefined &&
        cached.check.step === frame.step &&
        frame.seq === cached.check.chunks + 1
        ? {
            ...cached,
            check: {
              ...cached.check,
              output: cached.check.output + frame.chunk,
              chunks: frame.seq,
            },
          }
        : undefined
    // Neither is a change to a trak we hold. `Removed` says to forget it — re-reading
    // would 404 — and `Resync` says nothing held is known to be contiguous. Both are
    // the caller's to act on, and both are `undefined` here for the same reason a gap
    // is: this function's answer is only ever *the new value, if there is one*.
    case "Removed":
    case "Resync":
      return undefined
    // Custody whole, off the frame, for the reason the check family is: it is the
    // daemon's own claim rather than anything the log says, so there is nothing held to
    // reconcile it with. The release is what every press on the screen waits for.
    case "Drive":
      return { ...cached, custody: frame.custody }
    // The record's turn whole, for `Drive`'s reason: it is daemon memory rather than
    // anything the log says. The release is a frame with no `turn`, and it takes the
    // field off rather than leaving a held value standing — the ending's own figure is on
    // the log by then, and a meter still overlaying the record would count it twice.
    case "InFlight": {
      const { inFlight: _dropped, ...rest } = cached
      return frame.turn === undefined ? rest : { ...rest, inFlight: frame.turn }
    }
    // The preparation whole, for `Drive`'s reason, and taken off where none is running.
    case "Preparing": {
      const { preparing: _ended, ...rest } = cached
      return frame.preparing === undefined ? rest : { ...rest, preparing: frame.preparing }
    }
    // The action at the seam whole, for `Drive`'s reason, and taken off once it ends.
    case "SeamStatus": {
      const { seam: _ended, ...rest } = cached
      return frame.seam === undefined ? rest : { ...rest, seam: frame.seam }
    }
    // Not part of the detail: a hosted process is read off its own route, so nothing the
    // detail holds moves with one, and re-reading the trak for it would be a fetch per
    // chunk of a dev server's log.
    case "Process":
    case "ProcessOutput":
      return cached
    // About a goal rather than any trak, so nothing a trak's detail holds moves with it.
    // A CLI's plan usage is about no trak either.
    case "Goal":
    case "Usage":
      return cached
  }
}

/**
 * The most of one run's log held here, kept from the end — the engine's own bound, so a
 * log patched chunk by chunk and one read whole off the route are the same text.
 */
const LOG_KEPT = 64 * 1024

/**
 * A `Usage` frame applied to the usage we hold: the CLI's entry replaced whole. Nothing to
 * reconcile — the frame carries everything the engine remembers about that CLI.
 *
 * **A frame for a CLI the list does not hold changes nothing.** `GET /api/usage` lists only
 * the CLIs some agent names, but a turn on a model a person picked runs on its CLI anyway
 * and the engine publishes that CLI's frames. Added here, its row would appear on each
 * frame and vanish on each poll. Only the route's answer adds a CLI.
 */
export const applyUsageFrame = (held: CliUsagesDto, frame: UsageFrameDto): CliUsagesDto => ({
  clis: held.clis.map((entry) => (entry.cli === frame.usage.cli ? frame.usage : entry)),
})

/**
 * One hosted-process frame applied to the trak's process list we hold, or nothing — the
 * check family's rules over `["processes", id]` rather than the detail.
 *
 * `Process` carries the process whole and replaces the one of that name. A name the list
 * does not have is `undefined`: the declarations change only on a boot or a reload, so a
 * stranger means the list held here is not the engine's, and only a re-read can say what is.
 * `ProcessOutput` appends only when it is the next chunk of the run held, for `applyFrame`'s
 * reason — a skipped chunk would leave a log with a hole in it that reads as complete.
 */
export const applyProcessFrame = (
  held: readonly HostedProcessDto[],
  frame: ProcessFrameDto | ProcessOutputFrameDto,
): readonly HostedProcessDto[] | undefined => {
  const name = frame._tag === "Process" ? frame.process.name : frame.name
  const at = held.findIndex((process) => process.name === name)
  const process = held[at]
  if (process === undefined) return undefined
  if (frame._tag === "Process") return held.with(at, frame.process)
  if (frame.run !== process.run || frame.seq !== process.chunks + 1) return undefined
  const log = process.log + frame.chunk
  return held.with(at, {
    ...process,
    log: log.length <= LOG_KEPT ? log : log.slice(log.length - LOG_KEPT),
    chunks: frame.seq,
  })
}
