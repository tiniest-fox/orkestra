import { Context, type Effect } from "effect"
import type { Attachment } from "../domain/attachment.js"
import type { GitFailed } from "../../vcs/types/errors.js"

/**
 * A message's files, written where they go, and the uploads they came from still held.
 *
 * **`release` is the caller's to run, once the message is on the log.** A press refused
 * after its files were written — the trak became busy between the read and the drive —
 * keeps its uploads, so the same ids are sent again and placed again at the same paths.
 * Releasing at the write instead spent the files of a chat that was refused, and the
 * resend was refused as naming uploads the engine no longer held.
 */
export interface Placed {
  readonly attachments: readonly Attachment[]
  readonly release: Effect.Effect<void>
}

/**
 * The files a person sent with a new trak's request, held until its checkout is made.
 *
 * A message on a trak that already has a checkout is placed by the route that takes it;
 * a new trak has none until `SetupWorktree` makes one, so the route holds its files by
 * the trak's id and this places them there. A layer set without it holds nothing, which
 * is every test and demo that sends no file.
 *
 * **Held per project, not per machine.** A trak's id is unique in its project only, and
 * every engine on the machine shares the temporary folder, so one layer holds and settles
 * for the one project it was built for — never a file another project's trak was sent.
 */
export interface UploadsShape {
  /**
   * Hold the uploads `ids` names for `trak`, whose checkout is not made yet, and answer
   * what its log records of them — or the sentence a message naming them is refused with.
   */
  readonly hold: (
    ids: readonly string[] | undefined,
    trak: string,
  ) => Effect.Effect<Placed | string, Error>
  /**
   * Place the files held for `trak` in its checkout at `worktree`, under the paths its
   * `TrakCreated` recorded, and let go of them. Nothing where none are held — a restart
   * after they were placed, and every trak sent no file.
   */
  readonly settle: (trak: string, worktree: string) => Effect.Effect<void, GitFailed>
}

export class Uploads extends Context.Tag("workflow/Uploads")<Uploads, UploadsShape>() {}
