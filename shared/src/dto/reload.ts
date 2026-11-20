// A reload's answer, kept apart from `fleet.ts` so the host, which asks an engine to
// reload, need not import the fleet. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

/**
 * `POST /api/reload` read the project's files and they would not load. `reason` is the
 * loader's own line, naming the file. The files loaded before still serve. Not a
 * refusal: it is the answer to a person's press, read by the menu that sent it.
 */
export const ReloadFailedDto = Schema.TaggedStruct("ReloadFailed", { reason: Schema.String })
export type ReloadFailedDto = Schema.Schema.Type<typeof ReloadFailedDto>
