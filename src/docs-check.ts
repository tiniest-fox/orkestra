// `pnpm docs:check` — the gate for claims a machine can verify.
//
// **Reference documents only.** `README.md`, `CLAUDE.md`, `references/` and this repo's
// skills cite things by name, and each name is a claim about something that either exists
// or does not. Until this existed nothing checked, and three shipped false in one commit.
// Everything under `notes/` is a working document that owes no such truth (see the
// `writing-docs` skill), so nothing here reads it as a source — but a pointer *into*
// `notes/` from anywhere else is a claim like any other.
//
// Five checks:
//
//   1. paths         — every `src/…`-shaped reference names a file that exists
//   2. line cites    — a cited line number is within the file
//   3. notes         — every `notes/…/<name>.md` pointer, a `todo/` entry or a dated note,
//                      names a file that exists, and nothing names `notes/` at all in a
//                      tree without one. The target is a working document; the *pointer*
//                      lives in reference prose, a comment or a script, and that is what
//                      this keeps honest — in `client/`, `desktop/` and `.orkestra/` too
//   4. coverage      — every workspace package and every `src/` module is inside the
//                      gates and classified in the lint config (default-deny: a new
//                      directory starts with no rules, which is how `src/app/` and
//                      `shared/` each escaped every boundary they should have had)
//   5. total mappers — see below
//
// Checks 4 and 5 are not about prose at all; they live here because this is the only
// gate that reads the repository as a whole.
//
// Not checked, deliberately: what a sentence *says* about the thing it names. That
// is review's job. This only catches the cheaper failure — the name being wrong.
//
// `pnpm docs:check --changed-since <ref>` is the other half of that job's evidence: it
// runs none of the checks, and instead prints every file changed since `<ref>` with the
// reference documents that name its exact path, so a reviewer can read each cited
// sentence against the diff. It always exits 0 — it is a listing, not a gate.

// oxlint-disable-next-line eslint/no-restricted-imports -- a repository script, not the engine
import { spawnSync } from "node:child_process"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// ============================================================================
// Config
// ============================================================================

/**
 * Directories whose `.md` and `.ts` files carry claims worth checking.
 *
 * The skills are named at `.agents/skills`, their real home, not at the `.claude/skills`
 * symlink beside it. Both reach the same files, and the symlink is the one that can go:
 * a missing directory walks to nothing, so pointing at it would leave this gate passing
 * green over zero skills the day somebody decided the compatibility link was redundant.
 */
const REFERENCE_DIRS = [".agents/skills", "references"]
const SCANNED = [...REFERENCE_DIRS, "src", "test", "shared"]
const SCANNED_FILES = ["README.md", "CLAUDE.md"]

/**
 * Skills vendored from elsewhere, whose examples are about someone else's repository.
 * `atelier` names `src/ui/Button.tsx` thirteen times and means nothing by it.
 *
 * A new vendored skill fails this gate until it is listed here, which is the safe
 * direction — the alternative, deriving our skills from `CLAUDE.md`'s table, stops
 * checking every skill the moment that table is reformatted.
 */
const VENDORED_SKILLS = ["atelier", "atelier-proof", "stillroom", "walkdown"]

/**
 * Paths allowed not to exist. Everything else must exist.
 *
 * **An entry here is a hole, so keep it no wider than the unbuilt work** — a prefix
 * broader than that silently stops checking files that do exist.
 *
 * Empty, and left in place: the client-UI epic emptied it one line per phase as each
 * one landed, and the next document that plans a file before writing it needs the same
 * escape hatch. An entry is a promise, not a decoration — delete it when the thing it
 * names exists.
 */
const PLANNED_PREFIXES: readonly string[] = []

/** Where a `src/` module's rules are declared. Default-deny is checked against it. */
const LINT_CONFIG = ".oxlintrc.json"

// ============================================================================
// Walking
// ============================================================================

const EXTENSIONS = [".md", ".ts"]
const SKIP_DIRS = new Set(["node_modules", ".git", "logs", "fixtures", ".database"])

/**
 * This file. Its own comments show the shapes it matches on, which would otherwise
 * be read as claims — a checker cannot be its own test case.
 */
const SELF = join("src", "docs-check.ts")

/**
 * Opt out one line, with a reason, when a path-shaped or finding-shaped token is
 * not a claim about this repo: fake compiler output in a fixture, a path in another
 * repository, an example. Same spirit as `oxlint-disable-next-line` — per-site and
 * visible, never a whole file.
 *
 *     trigger: Triggers.checkFailure("verify", "2 errors in src/foo.ts"), // docs-check-ignore: fake output
 */
const IGNORE = "docs-check-ignore"

const walk = (dir: string): readonly string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

const isVendored = (file: string): boolean =>
  VENDORED_SKILLS.some((s) => file.startsWith(join(".agents", "skills", s) + "/"))

const sourcesUnder = (dirs: readonly string[]): readonly string[] =>
  [...SCANNED_FILES.filter((f) => existsSync(f)), ...dirs.flatMap(walk)].filter(
    (f) => f !== SELF && !isVendored(f),
  )

const sources = (): readonly string[] => sourcesUnder(SCANNED)

/**
 * The reference documents alone — the ones `writing-docs` holds to the same-change
 * rule. `src/`, `test/` and `shared/` are scanned by the gate because a comment's path
 * can go stale too, but a comment is not a document the rule reaches, and listing every
 * comment that names a changed path would bury the documents under the code.
 */
const referenceSources = (): readonly string[] => sourcesUnder(REFERENCE_DIRS)

// ============================================================================
// Problems
// ============================================================================

interface Problem {
  readonly file: string
  readonly line: number
  readonly message: string
}

const problems: Problem[] = []
const report = (file: string, line: number, message: string): void => {
  problems.push({ file, line, message })
}

/**
 * Lines carrying the opt-out are not claims — on the line itself or on the one
 * before it, so a long line does not have to grow a trailing comment. Same
 * next-line habit as `oxlint-disable-next-line`.
 */
const claims = (lines: readonly string[]): readonly { text: string; line: number }[] =>
  lines
    .map((text, i) => ({ text, line: i + 1, previous: lines[i - 1] ?? "" }))
    .filter(({ text, previous }) => !text.includes(IGNORE) && !previous.includes(IGNORE))
    .map(({ text, line }) => ({ text, line }))

// ============================================================================
// 1 · Path references
// ============================================================================

// A path-shaped token: a known root, then segments, ending in a file extension.
// Requires the extension so prose like "src/app/ holds the mapping" is not read as
// a file claim — a directory reference is checked separately and loosely.
//
// **Longest extension first, and `tsx` before `ts`.** Alternation is ordered and
// nothing anchors the end of the match, so `ts|tsx` makes `client/src/main.tsx` match
// as `client/src/main.ts` — a file that does not exist, reported against a line that
// was correct. It cost a false failure the first time this repo had a `.tsx` to name.
const PATH_RE =
  /(?<![\w./-])((?:src|test|shared|client|docs|epics|scripts)\/[\w./$*-]*\.(?:tsx|ts|md|jsonl|json|css|sh))/g

const isPlanned = (path: string): boolean => PLANNED_PREFIXES.some((p) => path.startsWith(p))

/** A glob or a template placeholder is a pattern, not a path. */
const isPattern = (path: string): boolean =>
  path.includes("*") || path.includes("$") || path.includes("<")

const checkPaths = (file: string, lines: readonly string[]): void => {
  claims(lines).forEach(({ text, line }) => {
    for (const match of text.matchAll(PATH_RE)) {
      const path = match[1]
      if (path === undefined || isPattern(path) || isPlanned(path)) continue
      if (!existsSync(path)) report(file, line, `names \`${path}\`, which does not exist`)
    }
  })
}

// ============================================================================
// 2 · Line-number citations — the file must at least be that long
// ============================================================================

// `tsx` before `ts` for the same reason as `PATH_RE` above: ordered alternation.
const LINE_CITE_RE = /(?<![\w./-])((?:src|test|shared|docs)\/[\w./-]+\.(?:tsx|ts|md)):(\d+)/g

const checkLineCitations = (file: string, lines: readonly string[]): void => {
  claims(lines).forEach(({ text, line }) => {
    for (const match of text.matchAll(LINE_CITE_RE)) {
      const [, path, num] = match
      if (path === undefined || num === undefined || !existsSync(path)) continue
      const length = readFileSync(path, "utf8").split("\n").length
      if (Number(num) > length) {
        report(file, line, `cites \`${path}:${num}\`, but that file has ${length} lines`)
      }
    }
  })
}

// ============================================================================
// 3 · notes/ pointers
// ============================================================================

/**
 * A pointer at a note is a path — `notes/todo/<slug>.md`, `notes/YYYY-MM/<slug>.md` — and
 * the claim is that the file exists: a `todo/` entry is deleted the day its work lands, and
 * a tree can ship without the notes its code cites. Separate from `PATH_RE` because
 * `notes/` is not a root there, and because these pointers sit in places the path check
 * does not read.
 */
const NOTE_RE = /(?<![\w./-])(notes\/[\w./-]+\.md)(?![\w/-])/g
const NOTES_DIR_RE = /(?<![\w./-])notes\//

/**
 * Where a pointer into `notes/` can sit: the gate's own roots, plus the client, the
 * desktop shell and the project's agents, checks and scripts. Dot-directories under them
 * are skipped, which keeps `.orkestra/`'s live state and every checkout under
 * `.orkestra/.worktrees/` out of the walk.
 */
const NOTE_ROOTS = [...SCANNED, "client", "desktop", ".orkestra"]
const NOTE_EXTENSIONS = [".md", ".ts", ".tsx", ".css", ".html", ".sh", ".yaml"]
/** `SKIP_DIRS` without `fixtures`: a fixture script cites notes like any other source. */
const NOTE_SKIP_DIRS = new Set([...SKIP_DIRS].filter((d) => d !== "fixtures"))

const walkForNotes = (dir: string): readonly string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (NOTE_SKIP_DIRS.has(entry) || entry === "dist" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkForNotes(full))
    else if (NOTE_EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

const noteSources = (): readonly string[] =>
  [...SCANNED_FILES.filter((f) => existsSync(f)), ...NOTE_ROOTS.flatMap(walkForNotes)].filter(
    (f) => f !== SELF && !isVendored(f),
  )

const checkNotePointers = (file: string, lines: readonly string[]): void => {
  const hasNotes = existsSync("notes")
  claims(lines).forEach(({ text, line }) => {
    if (!hasNotes && NOTES_DIR_RE.test(text)) {
      report(file, line, "names `notes/`, which this tree does not have")
      return
    }
    for (const match of text.matchAll(NOTE_RE)) {
      const path = match[1]
      if (path === undefined || existsSync(path)) continue
      report(file, line, `points at \`${path}\`, which is not a note`)
    }
  })
}

// ============================================================================
// 4 · Coverage — default-deny for packages and modules
// ============================================================================

/**
 * `package.json`'s scripts, narrowed entry by entry rather than asserted. The house
 * rule bans `as`, and here it would also be wrong: this reads a file on disk, so the
 * shape is a claim to check, not one to declare.
 */
const packageScripts = (): ReadonlyMap<string, string> => {
  const parsed: unknown = JSON.parse(readFileSync("package.json", "utf8"))
  const out = new Map<string, string>()
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) return out
  const scripts: unknown = parsed.scripts
  if (typeof scripts !== "object" || scripts === null) return out
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body === "string") out.set(name, body)
  }
  return out
}

/** The list under `packages:` only — the file's other keys hold lists too. */
const workspacePackages = (): readonly string[] => {
  if (!existsSync("pnpm-workspace.yaml")) return []
  const lines = readFileSync("pnpm-workspace.yaml", "utf8").split("\n")
  const start = lines.findIndex((l) => l.trimEnd() === "packages:")
  if (start === -1) return []
  const block = lines.slice(start + 1)
  const end = block.findIndex((l) => l.length > 0 && !l.startsWith(" "))
  return (end === -1 ? block : block.slice(0, end))
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
}

/**
 * Every workspace package must be reachable by `lint` and `fmt:check` — either
 * named in their path lists, or behind its own `verify` the root chains. A package
 * no gate reaches is how four unformatted files survived a green `pnpm verify`.
 */
const checkPackageCoverage = (scripts: ReadonlyMap<string, string>): void => {
  const verify = scripts.get("verify") ?? ""
  for (const name of workspacePackages()) {
    const chained = verify.includes(`--filter ${name}`)
    for (const gate of ["lint", "fmt:check"]) {
      const cmd = scripts.get(gate) ?? ""
      if (!cmd.split(/\s+/).includes(name) && !chained) {
        report(
          "package.json",
          1,
          `workspace package \`${name}\` is not covered by \`${gate}\` and has no chained verify`,
        )
      }
    }
  }
}

/**
 * Default-deny for modules: every directory under `src/` must be named in the lint
 * config, so a new module cannot start life with no boundary rules. `src/app/` did
 * exactly that — it inherited nothing, and the injected-time rule, the import
 * boundaries and the purity rules all silently skipped it.
 */
const checkModuleCoverage = (): void => {
  if (!existsSync(LINT_CONFIG)) return
  const config = readFileSync(LINT_CONFIG, "utf8")
  for (const entry of readdirSync("src")) {
    if (!statSync(join("src", entry)).isDirectory()) continue
    if (!config.includes(`src/${entry}/`)) {
      report(
        LINT_CONFIG,
        1,
        `\`src/${entry}/\` is not classified in the lint config — a new module must ` +
          `declare its boundaries before code lands in it (see the new-module skill)`,
      )
    }
  }
}

// ============================================================================
// 5 · Total mappers
// ============================================================================

/**
 * Files that map a request onto a domain constructor, and must do it without a
 * runtime guard. A `throw` here means the Schema upstream is too weak: the empty
 * `answers` list that `Actions.answer` rejects was guarded with a `throw`, which
 * reached the client as a 500 instead of the 400 a `NonEmptyArray` in the Schema
 * gives for free.
 *
 * Enforced here rather than in oxlint because oxlint implements no
 * `no-restricted-syntax`, and a convention with no gate is how the last one went.
 */
const TOTAL_MAPPERS = ["src/app/dto.ts"]

const checkTotalMappers = (): void => {
  for (const file of TOTAL_MAPPERS) {
    if (!existsSync(file)) continue
    claims(readFileSync(file, "utf8").split("\n")).forEach(({ text, line }) => {
      if (/^\s*(?:throw |.*\bthrow new )/.test(text)) {
        report(
          file,
          line,
          "a mapper must be total — a `throw` here means the request Schema is too " +
            "weak; state the constraint in the Schema instead, where the boundary " +
            "answers 400 rather than 500",
        )
      }
    })
  }
}

// ============================================================================
// Listing — which reference documents name a changed file
// ============================================================================

const CHANGED_SINCE = "--changed-since"

/**
 * Every path changed between `ref` and the working tree — committed or not, so a builder
 * can run it before committing and a reviewer gets the same answer for the same diff. A
 * deleted file is included on purpose: a document naming it is the stalest kind.
 *
 * A ref git does not know is `undefined`, never an empty list: a listing of nothing
 * would read as "no document to check".
 */
const changedSince = (ref: string): readonly string[] | undefined => {
  // `--no-renames`: a move is a deletion and an addition, so the old path is listed and
  // a document still naming it is found. Detected, git would list the new path alone.
  const git = spawnSync("git", ["diff", "--name-only", "--no-renames", ref], {
    encoding: "utf8",
  })
  if (git.status !== 0) {
    console.error(git.stderr.trim())
    return undefined
  }
  return git.stdout.split("\n").filter((line) => line.length > 0)
}

/**
 * The changed path as a literal, bounded by non-path characters on both sides — not
 * `PATH_RE`, whose roots and extensions are the gate's allowlist of what must exist.
 * A citation can name anything: `references/hosting.md`, `.orkestra/COMPOSITION.md`,
 * `package.json`. A directory containing the file is still not a citation, since
 * `src/app/` is named in most skills and the list would then say nothing.
 *
 * A full stop after the path is the end of a sentence, not part of a longer path, so
 * only a dot followed by a word character blocks the match.
 */
const literally = (path: string): RegExp =>
  new RegExp(`(?<![\\w./-])${path.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-]|\\.\\w)`)

/** The lines of a reference document that name one of `paths` exactly. */
const citations = (
  file: string,
  paths: readonly { path: string; matcher: RegExp }[],
): readonly { path: string; line: number }[] =>
  claims(readFileSync(file, "utf8").split("\n")).flatMap(({ text, line }) =>
    paths.filter(({ matcher }) => matcher.test(text)).map(({ path }) => ({ path, line })),
  )

/** True when the listing ran; false when `ref` could not be diffed. */
const listCitedBy = (ref: string): boolean => {
  const changed = changedSince(ref)
  if (changed === undefined) return false
  const wanted = changed.map((path) => ({ path, matcher: literally(path) }))
  const byPath = new Map<string, string[]>(changed.map((path) => [path, []]))
  for (const file of referenceSources()) {
    for (const { path, line } of citations(file, wanted)) {
      byPath.get(path)?.push(`${file}:${String(line)}`)
    }
  }
  let cited = 0
  for (const path of changed) {
    const sites = byPath.get(path) ?? []
    if (sites.length > 0) cited += 1
    console.log(path)
    for (const site of sites) console.log(`  ${site}`)
  }
  console.log(
    `\ndocs:check — ${String(cited)} of ${String(changed.length)} changed file(s) named in a reference document`,
  )
  return true
}

// ============================================================================
// Run
// ============================================================================

const flagAt = process.argv.indexOf(CHANGED_SINCE)
const ref = flagAt === -1 ? undefined : process.argv[flagAt + 1]

if (flagAt !== -1 && ref === undefined) {
  // A missing ref is a usage error, not an empty listing. This and a ref git rejects are
  // the only ways the listing exits non-zero: a listing that ran exits 0 whatever it found.
  console.error(`usage: pnpm docs:check ${CHANGED_SINCE} <ref>`)
  process.exitCode = 1
} else if (ref !== undefined) {
  if (!listCitedBy(ref)) process.exitCode = 1
} else {
  for (const file of sources()) {
    const lines = readFileSync(file, "utf8").split("\n")
    checkPaths(file, lines)
    checkLineCitations(file, lines)
  }
  for (const file of noteSources()) checkNotePointers(file, readFileSync(file, "utf8").split("\n"))

  checkPackageCoverage(packageScripts())
  checkModuleCoverage()
  checkTotalMappers()

  if (problems.length === 0) {
    console.log(`docs:check — ${String(sources().length)} files, no broken references`)
  } else {
    for (const p of problems) console.error(`${p.file}:${String(p.line)}: ${p.message}`)
    console.error(`\ndocs:check — ${String(problems.length)} broken reference(s)`)
    process.exitCode = 1
  }
}
