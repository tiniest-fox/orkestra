/**
 * Where the page is served from, and what follows from it.
 *
 * **The page learns its prefix from `<base href>` and from nothing else.** `index.html`
 * ships `<base href="/">`; a host that serves one engine under `/p/<project>/` rewrites
 * that one tag as it forwards the page, and strips the prefix from every request before
 * the engine sees it. So the engine knows nothing of prefixes, one bundle serves any of
 * them, and with no host in front every URL is the one it always was. The tag must end in
 * `/`, or every path resolved against it loses its last segment.
 *
 * Both functions take `document.baseURI` from the caller rather than reading it, so this
 * stays kind `pure`. **Top-level rather than in a feature**, for `queryCache`'s reason:
 * the seam, the router and three features' storage all read it.
 */

/** The prefix as a path: `/` with none, `/p/x/` under one. */
export const basePath = (baseURI: string): string => new URL(baseURI).pathname

/**
 * A storage key kept to this prefix. **The origin is shared across every project a host
 * serves**, and so are `localStorage` and `sessionStorage`: unprefixed, one project's
 * remembered forge answers would draw in another's list. With no prefix the key is the
 * one this browser already holds, so nothing stored before is lost.
 */
export const storageKey = (key: string, baseURI: string): string => {
  const base = basePath(baseURI)
  return base === "/" ? key : `${base}${key}`
}
