/**
 * Markdown flattened to one line, for the places that have no room to render it.
 *
 * **Not a parser and not a second renderer** — `components/Markdown` is the renderer, and
 * this exists for the one thing it cannot do: a collapsed section's summary is a single
 * truncated line, and rendering a table into it is not an option. The raw string is not an
 * option either, which is what this fixes — a summary reading `**What exists** - the
 * screen…` shows the reader the punctuation instead of the sentence.
 *
 * So it takes the markers out and leaves the words. It is allowed to be approximate: the
 * worst case is a stray character in a line that is already truncated, and the whole thing
 * is one click away from being rendered properly.
 */

/** A fenced block, which says nothing useful on one line. */
const FENCE = /```[\s\S]*?```/g
/** `[text](url)` — the text is the part worth keeping. */
const LINK = /\[([^\]]*)\]\([^)]*\)/g
/** What opens a block: heading hashes, a quote, a bullet, a table's leading pipe. */
const LEADER = /^[ \t]*(?:[#>|]+|[-*+]|\d+\.)[ \t]+/gm
/** What decorates a span, once the leaders are gone. */
const MARKER = /[*_`|]/g

export const plainText = (markdown: string): string =>
  markdown
    .replaceAll(FENCE, " ")
    .replaceAll(LINK, "$1")
    .replaceAll(LEADER, "")
    .replaceAll(MARKER, "")
    .replaceAll(/\s+/g, " ")
    .trim()
