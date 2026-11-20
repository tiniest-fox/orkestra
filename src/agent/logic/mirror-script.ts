// logic: the shell script that writes files into a sandbox, run there as `sh` with the
// script on stdin. The files cross as one gzipped tar inside the script, so a whole mirror
// is one exec whatever it holds; a path under the sandbox's home has to be written
// relative to a `$HOME` only the sandbox knows, so the archive holds two roots, `h/` for
// the home and `r/` for the filesystem's root, and the script moves each into place.
//
// The same script writes a record in the sandbox's home: a hash of everything it was sent,
// and every path it holds. An engine meeting the sandbox reads it, sends nothing while the
// hash matches, and deletes the paths this machine no longer lists. The home, because it
// outlives every checkout and a new sandbox starts without one.

/** Where one file sits in the sandbox. */
export interface MirroredPath {
  /**
   * Absolute where the file sits at the same path on both machines; relative to the
   * sandbox's `$HOME` where it is the agent home, whose owner may differ there.
   */
  readonly at: string
  readonly underHome: boolean
}

/** The record's path under the sandbox's `$HOME`. */
export const MIRROR_RECORD = ".orkestra-mirror"

/** What the sandbox holds: the hash of what it was last sent, and every key it holds. */
export interface MirrorRecord {
  /** `undefined` where the sandbox has no record, or one that does not parse. */
  readonly digest: string | undefined
  readonly keys: readonly string[]
}

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

const target = (file: MirroredPath): string =>
  file.underHome ? `"$HOME"/${quoted(file.at)}` : quoted(file.at)

/** Where a file sits inside the archive the script unpacks. */
export const archivePath = (file: MirroredPath): string =>
  file.underHome ? `h/${file.at}` : `r/${file.at.replace(/^\/+/u, "")}`

/** Base64 in 76-column lines, the width every `base64 -d` reads. */
const encoded = (content: Uint8Array): string =>
  (
    Buffer.from(content)
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\n")

/**
 * The record as its text: the digest on the first line, then each key as a JSON string,
 * so no key can hold a newline or end the heredoc it is written in.
 */
const recordText = (record: MirrorRecord): string =>
  [record.digest ?? "", ...record.keys.map((key) => JSON.stringify(key))].join("\n")

/**
 * What the record says the sandbox holds. A key line that does not parse is skipped: the
 * file it named is left in the sandbox rather than deleted, and the next send overwrites it.
 */
export const mirrorRecordIn = (text: string): MirrorRecord => {
  const [first = "", ...rest] = text.split("\n")
  const keys = rest.flatMap((line) => {
    try {
      const key: unknown = JSON.parse(line)
      return typeof key === "string" ? [key] : []
    } catch {
      // A partial or empty line: nothing recorded on it.
      return []
    }
  })
  return { digest: /^[0-9a-f]{64}$/u.test(first) ? first : undefined, keys }
}

/**
 * Moves every file under `$s/$1` to the same path under `$2`, making its directory first.
 * A rename where both are on one filesystem, so a command already running in the sandbox
 * reads the old file or the new one and never half of one.
 */
const PLACE = `place() {
  [ -d "$s/$1" ] || return 0
  (cd "$s/$1" && find . -type f -exec sh -c 'd=\${1%/}; shift; for f; do t="$d/\${f#./}"; mkdir -p "\${t%/*}/" && mv -f "$f" "$t" || exit 1; done' sh "$2" {} +)
}`

/**
 * `archive` — a gzipped tar laid out by `archivePath` — unpacked beside the home and moved
 * into place, then each of `removed` deleted, then `record` written over the last one.
 * Stops at the first failure, so the record never names content the sandbox lacks.
 */
export const mirrorScript = (
  archive: Uint8Array,
  removed: readonly MirroredPath[],
  record: MirrorRecord,
): string =>
  [
    "set -e",
    `s="$HOME"/${quoted(`${MIRROR_RECORD}.part`)}`,
    'rm -rf "$s" "$s.tgz"',
    'mkdir -p "$s"',
    `base64 -d > "$s.tgz" <<'ORKESTRA_MIRROR_END'`,
    encoded(archive),
    "ORKESTRA_MIRROR_END",
    'tar -x -z -m -f "$s.tgz" -C "$s"',
    PLACE,
    'place h "$HOME"',
    "place r /",
    'rm -rf "$s" "$s.tgz"',
    ...removed.map((path) => `rm -f ${target(path)}`),
    `cat > "$s.record" <<'ORKESTRA_RECORD_END'`,
    recordText(record),
    "ORKESTRA_RECORD_END",
    `mv -f "$s.record" "$HOME"/${quoted(MIRROR_RECORD)}`,
    "",
  ].join("\n")
