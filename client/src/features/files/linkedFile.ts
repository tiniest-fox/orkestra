/**
 * Which file of the project a link in a rendered file points at, if it points at one.
 *
 * Only a relative link does: one with a scheme, a `//` host or a leading `/` names
 * something outside the checkout's tree, or a root nobody can say for certain. The query
 * and fragment are dropped, the percent escapes decoded — link text arrives encoded, so
 * `my%20notes.md` is `my notes.md` — and `.` and `..` folded against the linking file's
 * folder. A link that climbs above the root, or carries an escape that will not decode,
 * names nothing.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export const linkedFile = (from: string, href: string): string | undefined => {
  if (SCHEME.test(href) || href.startsWith("/")) return undefined
  const bare = href.split(/[?#]/, 1)[0] ?? ""
  if (bare === "") return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    return undefined
  }
  const parts = from.split("/").slice(0, -1)
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join("/")
}
