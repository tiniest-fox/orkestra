/**
 * The short word that tells one piece of a spawn from its siblings, cut from the
 * instruction the piece already carries.
 *
 * A spawn usually fans one agent across every piece, so a card headed by the agent reads
 * identically four times — the phone rounds settled that a piece's card leads with a
 * distinguishing word instead: `the engine`, `the bundle`. Nothing computes one anywhere
 * else: the wire carries the whole instruction and no projection reduces it, so the
 * client derives the word by comparing the piece's instruction against its siblings'.
 *
 * **The word is the first one an article introduces that no sibling uses.** Requiring
 * the article is what biases the pick toward a noun — instructions open on verbs
 * (`Build…`, `Serve…`, `Port…`), which are unique between siblings and name nothing.
 * Where no article-led word is unique, any unique word will do; where none is — twin
 * instructions, or none at all — the answer is `undefined` and the caller falls back to
 * the piece's title.
 *
 * Two surfaces read it — the list's spawn band and the trak page's directive block —
 * which is why it is `format/`'s rather than either feature's.
 */

const ARTICLES = new Set(["the", "a", "an"])

const tokens = (text: string): readonly string[] =>
  text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []

/**
 * @param own — this piece's instruction, whole.
 * @param siblings — the other pieces' instructions, whole. The piece's own must not be
 *   among them, or every word of it is "already used" and nothing distinguishes.
 */
export const pieceWord = (own: string, siblings: readonly string[]): string | undefined => {
  const mine = tokens(own)
  const used = new Set(siblings.flatMap((sibling) => tokens(sibling).map((t) => t.toLowerCase())))

  const unique = (t: string): boolean =>
    !ARTICLES.has(t.toLowerCase()) && !used.has(t.toLowerCase())

  const led = mine.findIndex((t, i) => unique(t) && ARTICLES.has(mine[i - 1]?.toLowerCase() ?? ""))
  if (led >= 0) {
    const article = mine[led - 1]
    const word = mine[led]
    if (article !== undefined && word !== undefined) return `${article.toLowerCase()} ${word}`
  }

  return mine.find(unique)
}
