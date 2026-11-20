/**
 * The one agent the engine ships, spelled here because nothing on the wire marks it out.
 *
 * **`GET /api/agents` carries it like any other**, `start: true` among them — and no
 * field says *this is the engine's own*, because there is no picker for such a field to
 * filter. Two screens name it, which is why it is in `format/` rather than beside one of
 * them: the ask door on a trak at rest, where `POST /reenter` refuses every other name,
 * and New Chat, which opens a trak with it. Each screen and its route agree by both
 * naming the same one rather than by negotiating.
 *
 * It is a name and not a glyph: what mark it wears comes off the wire through
 * `agentGlyph`, for the reason `format/glyph.ts` carries at length.
 */
export const GENERIC_AGENT = "generic"
