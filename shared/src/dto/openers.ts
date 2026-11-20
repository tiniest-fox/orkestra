// A shell in, or an editor on, a checkout, and a sandbox's shell and rebuild. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// Openers — a shell in, or an editor on, a trak's checkout, macOS only
// ============================================================================

/**
 * What an opener opens a checkout as: a shell in it, or an editor window on it. The
 * two are one vocabulary because everything about them but the claim the engine's
 * scan keeps them for is the same — one sweep, one icon read, one stored pick each.
 */
export const OpenerKindDto = Schema.Literal("terminal", "editor")
export type OpenerKindDto = Schema.Schema.Type<typeof OpenerKindDto>

/**
 * One application installed on the engine's machine that can open a checkout, from
 * `GET /api/openers`.
 *
 * The machine is the engine's, not the one showing the client: opening a terminal or
 * an editor lands on the engine's own window session, which a phone or a tunnelled
 * browser cannot be. That is why the scan happens engine-side at all.
 */
export const OpenerDto = Schema.Struct({
  /** The bundle identifier — `com.mitchellh.ghostty`. What `open -b` is handed. */
  id: Schema.String,
  /** The application's own display name — `Ghostty`. */
  name: Schema.String,
  /**
   * The application's icon as a `data:image/png;base64,…` URL, or absent where the
   * bundle ships none the engine can read. Inline rather than behind a second
   * route, so the list and its icons arrive in one response.
   */
  icon: Schema.optional(Schema.String),
})
export type OpenerDto = Schema.Schema.Type<typeof OpenerDto>

/** One kind's half of the listing: the openers of that kind, and the one bound. */
export const OpenerListDto = Schema.Struct({
  apps: Schema.Array(OpenerDto),
  /**
   * The bundle identifier a press opens right now: the stored pick where it still
   * names an installed app of this kind, else the engine's guess. Absent when the
   * scan found nothing. A guess is never written down, so installing a new app
   * changes this answer with nothing to clear.
   */
  chosen: Schema.optional(Schema.String),
})
export type OpenerListDto = Schema.Schema.Type<typeof OpenerListDto>

/**
 * `GET /api/openers` — the terminals and the editors this machine has, and which of
 * each a press on its control would open. One request rather than one per kind,
 * because one scan answers both and the two lists are one fact about one machine.
 * The route answers an empty 204 on any platform but macOS, where nothing is detected — a
 * surface hides both controls on that answer.
 */
export const OpenersDto = Schema.Struct({
  terminal: OpenerListDto,
  editor: OpenerListDto,
})
export type OpenersDto = Schema.Schema.Type<typeof OpenersDto>

/**
 * `POST /api/openers` — an explicit pick for one kind, stored once per machine and
 * shared by every project an engine is pointed at. The only thing that ever writes
 * the preference. 400 for an identifier the scan did not return under that kind: the
 * dropdown only ever offers what `GET /api/openers` listed, so any other id is a
 * hand-written request.
 */
export const ChooseOpenerRequestDto = Schema.Struct({ kind: OpenerKindDto, id: Schema.String })
export type ChooseOpenerRequestDto = Schema.Schema.Type<typeof ChooseOpenerRequestDto>

/** `POST /api/traks/:id/open` — which kind of opener to open the checkout with. */
export const OpenCheckoutRequestDto = Schema.Struct({ kind: OpenerKindDto })
export type OpenCheckoutRequestDto = Schema.Schema.Type<typeof OpenCheckoutRequestDto>

/** `POST /api/traks/:id/sandbox/rebuild` — where the Rebuild stands once the press is taken. */
export const SandboxRebuildDto = Schema.Struct({
  rebuild: Schema.Literal("waiting", "rebuilding"),
})
export type SandboxRebuildDto = Schema.Schema.Type<typeof SandboxRebuildDto>

/**
 * `GET /api/traks/:id/shell` — what starts a person's shell in a sandboxed trak's sandbox,
 * for `pnpm host shell <project> <trak>` to run. Nothing secret crosses: `env` is handed
 * to the command as written, and each name in `inherited` is valued by whoever runs it
 * from the secrets it already holds.
 */
export const SandboxShellDto = Schema.Struct({
  command: Schema.NonEmptyArray(Schema.String),
  env: Schema.Record({ key: Schema.String, value: Schema.String }),
  inherited: Schema.Array(Schema.String),
})
export type SandboxShellDto = Schema.Schema.Type<typeof SandboxShellDto>
