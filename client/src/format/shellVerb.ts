/**
 * What each shell call in a run did, read from its commands.
 *
 * Claude and Codex do nearly all their work through a shell, so a run sentence that only
 * knew the kind would say `ran commands` for reading, searching and editing alike. This
 * names each call by the effects it had — or by nothing, where the command does not say
 * clearly enough, and the caller falls back to `ran commands`.
 *
 * **It reads the run, not one call**, because two of its rules span calls: a file written
 * and later removed was scratch, and an edit the run later restores was an experiment.
 * Neither belongs in a row describing the work, and only the whole run can tell.
 *
 * **Only general-purpose tools and package-script names are recognized.** A project's own
 * CLI, a script path or a repo's check script has no verb here: client code may not know
 * what any one project's commands are, and a guess about one would be a confident wrong
 * label on every other.
 *
 * **Classified when the row is drawn, never stored**, so a log written before this file
 * changed reads with today's verbs. Pure and dependency-free for that reason.
 */

/** The verbs a shell call can earn. Anything else reads `ran commands`. */
export type ShellVerb =
  | "read"
  | "searched"
  | "listed"
  | "edited"
  | "wrote"
  | "deleted"
  | "moved"
  | "tested"
  | "checked"
  | "committed"
  | "waited"

/** A command's vote: a verb, or `other` for a command this file cannot name. */
type Vote = Exclude<ShellVerb, "waited"> | "other"

/**
 * The verbs that say a call changed or verified something. A call names every one it has;
 * the read-only verbs only speak for a call that has none, because an edit followed by a
 * confirming `grep` is still only an edit.
 */
const EFFECT_VERBS: ReadonlySet<Vote> = new Set([
  "wrote",
  "edited",
  "moved",
  "deleted",
  "committed",
  "tested",
  "checked",
])

/** The read-only verbs, weakest first: a call with only these takes its strongest one. */
const READ_ONLY: readonly ("read" | "listed" | "searched")[] = ["read", "listed", "searched"]

/** The votes a filter stage keeps: after a pipe, only a stage that changes a file counts. */
const EFFECTS: ReadonlySet<Vote> = new Set(["wrote", "edited", "moved", "deleted"])

/** One simple command, as the shell would run it. */
type Segment = {
  readonly words: readonly string[]
  /** Paths its output is redirected into. */
  readonly writes: readonly string[]
  /** Heredoc bodies it reads from — the script, for an inline `python3 - <<EOF`. */
  readonly bodies: readonly string[]
  /** Whether it reads a pipe, which makes it a filter rather than a command of its own. */
  readonly piped: boolean
}

type Builder = { words: string[]; writes: string[]; bodies: string[]; piped: boolean }

const emptySegment = (piped: boolean): Builder => ({ words: [], writes: [], bodies: [], piped })

/** Where the next word goes: an argument, a redirect target, or a heredoc delimiter. */
type Pending = "word" | "out" | "in" | "heredoc"

/**
 * A tolerant reading of a shell script into simple commands.
 *
 * It splits on unquoted `&&` `||` `;` `&` `|`, newlines and parentheses, removes quotes,
 * keeps `$(…)` and backticks whole inside a word, and collects heredoc bodies onto the
 * command that opened them. It never throws: an unbalanced quote runs to the end, which
 * is what an agent's truncated command looks like.
 */
class Lexer {
  private i = 0
  private word = ""
  private started = false
  private pending: Pending = "word"
  private current = emptySegment(false)
  private readonly done: Builder[] = []
  private readonly heredocs: { delimiter: string; into: Builder }[] = []

  private readonly src: string

  constructor(src: string) {
    this.src = src
  }

  segments(): readonly Segment[] {
    while (this.i < this.src.length) this.step()
    this.end(false)
    return this.done
  }

  private step(): void {
    const c = this.src.charAt(this.i)
    const next = this.src.charAt(this.i + 1)
    if (c === "'" || c === '"') return this.quoted(c)
    if (c === "\\") return this.escaped(next)
    if (c === "$" && next === "(") return this.literal(this.balanced(this.i + 1))
    if (c === "`") return this.literal(this.src.indexOf("`", this.i + 1))
    if (c === "#" && !this.started) return this.comment()
    if (c === " " || c === "\t") return this.blank()
    if (c === "\n") return this.newline()
    if (c === ">" || c === "<") return this.redirect(c)
    if (c === "&" && next === ">") return this.redirect(c)
    if (";&|()".includes(c)) return this.operator(c, next)
    this.append(c)
    this.i += 1
  }

  private append(text: string): void {
    this.word += text
    this.started = true
  }

  private quoted(quote: string): void {
    let j = this.i + 1
    let text = ""
    while (j < this.src.length && this.src.charAt(j) !== quote) {
      const c = this.src.charAt(j)
      if (quote === '"' && c === "\\" && '"\\$`'.includes(this.src.charAt(j + 1))) {
        text += this.src.charAt(j + 1)
        j += 2
      } else if (quote === '"' && c === "$" && this.src.charAt(j + 1) === "(") {
        const end = this.balanced(j + 1)
        text += this.src.slice(j, end + 1)
        j = end + 1
      } else {
        text += c
        j += 1
      }
    }
    this.append(text)
    this.i = j + 1
  }

  private escaped(next: string): void {
    if (next !== "\n") this.append(next)
    this.i += 2
  }

  /** Appends `src[i..end]` whole, or the rest of the script when `end` is not found. */
  private literal(end: number): void {
    const stop = end < 0 ? this.src.length : end + 1
    this.append(this.src.slice(this.i, stop))
    this.i = stop
  }

  /** The index of the `)` closing the `(` at `open`, skipping quotes inside it. */
  private balanced(open: number): number {
    let depth = 0
    for (let j = open; j < this.src.length; j += 1) {
      const c = this.src.charAt(j)
      if (c === "'" || c === '"') {
        const close = this.src.indexOf(c, j + 1)
        if (close < 0) return -1
        j = close
      } else if (c === "(") depth += 1
      else if (c === ")") depth -= 1
      if (depth === 0) return j
    }
    return -1
  }

  private comment(): void {
    const end = this.src.indexOf("\n", this.i)
    this.i = end < 0 ? this.src.length : end
  }

  private blank(): void {
    this.flush()
    this.i += 1
  }

  private newline(): void {
    this.end(false)
    this.i += 1
    for (const heredoc of this.heredocs.splice(0)) this.body(heredoc)
  }

  /** Consumes heredoc lines up to the delimiter, onto the command that opened it. */
  private body(heredoc: { delimiter: string; into: Builder }): void {
    const lines: string[] = []
    while (this.i < this.src.length) {
      const end = this.src.indexOf("\n", this.i)
      const stop = end < 0 ? this.src.length : end
      const line = this.src.slice(this.i, stop)
      this.i = stop + 1
      if (line.trim() === heredoc.delimiter) break
      lines.push(line)
    }
    heredoc.into.bodies.push(lines.join("\n"))
  }

  private redirect(c: string): void {
    // A bare file descriptor before the arrow, as in `2>`, is not a word.
    if (/^\d+$/.test(this.word)) this.word = ""
    this.flush()
    const rest = this.src.slice(this.i)
    const op = /^(<<<|<<-?|&>>|&>|>>|>\||>|<)(&[\d-])?/.exec(rest)?.[0] ?? c
    this.i += op.length
    if (op.includes("&") && /&[\d-]$/.test(op)) return
    if (op.startsWith("<<<") || op === "<") this.pending = "in"
    else if (op.startsWith("<<")) this.pending = "heredoc"
    else this.pending = "out"
  }

  private operator(c: string, next: string): void {
    const pipe = c === "|" && next !== "|"
    this.end(pipe)
    const double = (c === "&" || c === "|") && next === c
    this.i += double || (pipe && next === "&") ? 2 : 1
  }

  private flush(): void {
    if (!this.started) return
    const word = this.word
    this.word = ""
    this.started = false
    const pending = this.pending
    this.pending = "word"
    if (pending === "out") this.current.writes.push(word)
    else if (pending === "heredoc") this.heredocs.push({ delimiter: word, into: this.current })
    else if (pending === "word") this.current.words.push(word)
  }

  private end(piped: boolean): void {
    this.flush()
    const segment = this.current
    if (segment.words.length > 0 || segment.writes.length > 0) this.done.push(segment)
    this.current = emptySegment(piped)
  }
}

/** Paths a delete, move or write may touch without it counting as an effect on the work. */
const isScratch = (path: string): boolean =>
  /^(\/private)?\/(tmp|var\/folders)(\/|$)/.test(path) ||
  /^(\.\/)?tmp(\/|$)/.test(path) ||
  path.startsWith("/dev/") ||
  /^"?\$\{?TMPDIR/.test(path) ||
  /(^|\/)\.experiments(\/|$)/.test(path)

const isWorkPath = (path: string): boolean => !isScratch(path) && !path.startsWith("$")

const isFlag = (word: string): boolean => word.startsWith("-")

const operands = (words: readonly string[]): readonly string[] =>
  words.slice(1).filter((word) => !isFlag(word))

const basename = (word: string): string => word.slice(word.lastIndexOf("/") + 1)

/** Words that open a compound command, and are not the command in it. */
const KEYWORDS: ReadonlySet<string> = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
  "{",
  "}",
  "time",
  "nohup",
  "sudo",
  "command",
])

/** Words whose whole segment carries no effect, so it does not vote. */
const SILENT: ReadonlySet<string> = new Set([
  "cd",
  "pushd",
  "popd",
  "echo",
  "printf",
  "export",
  "unset",
  "set",
  "pwd",
  "which",
  "type",
  "true",
  "false",
  ":",
  "source",
  ".",
  "local",
  "wait",
  "exit",
  "return",
  "date",
  "whoami",
  "test",
  "[",
  "[[",
  "clear",
  "trap",
  "shift",
  "alias",
  "ulimit",
  "umask",
  "hash",
  "read",
  "basename",
  "dirname",
  "done",
  "fi",
  "esac",
  "for",
  "case",
])

const isAssignment = (word: string): boolean => /^[A-Za-z_]\w*=/.test(word)

/** Takes value-carrying flags into account when skipping a wrapper's options. */
const skipFlags = (words: readonly string[], valued: ReadonlySet<string>): readonly string[] => {
  let i = 0
  while (i < words.length && isFlag(words[i] ?? "")) i += valued.has(words[i] ?? "") ? 2 : 1
  return words.slice(i)
}

const XARGS_VALUED: ReadonlySet<string> = new Set(["-I", "-n", "-P", "-L", "-d", "-s", "-E"])
const NO_VALUES: ReadonlySet<string> = new Set()

/**
 * The words with the wrappers that only run another command peeled off: keywords,
 * environment assignments, `env`, `npx`, `pnpm exec`, `bundle exec`, `mise exec --`,
 * `timeout N` and `xargs`.
 */
const unwrapped = (words: readonly string[]): readonly string[] => {
  const [head = "", second = "", ...rest] = words
  if (KEYWORDS.has(head) || isAssignment(head)) return unwrapped(words.slice(1))
  if (head === "env" || head === "npx" || head === "bunx" || head === "nice") {
    return unwrapped(skipFlags(words.slice(1), NO_VALUES))
  }
  if (head === "timeout") return unwrapped(skipFlags(words.slice(1), NO_VALUES).slice(1))
  if (head === "xargs") return unwrapped(skipFlags(words.slice(1), XARGS_VALUED))
  if (head === "bundle" && second === "exec") return unwrapped(rest)
  if (head === "mise" && second === "exec") return unwrapped(rest.slice(rest.indexOf("--") + 1))
  return words
}

/** A path as a command spelled it, resolved against the call's `cd`s where those are known. */
type Target = {
  readonly text: string
  /**
   * What another command has to name for the two to be one file — `undefined` for a glob,
   * a variable, or a path under a directory nothing here could follow. **A path with no key
   * matches nothing**, so a miss leaves both commands voting rather than dropping either.
   */
  readonly key: string | undefined
  /**
   * Whether it is a path of the work rather than scratch or a variable. **Decided from the
   * path as written, and from the directory it was resolved in** — never from the joined
   * text alone, which turns `$tmp` into `/repo/$tmp` and `tmp/x` into `/repo/tmp/x` after
   * any `cd`, and both would then pass for work.
   */
  readonly work: boolean
}

type Resolve = (path: string) => Target

/** One thing a command did, with the files it did it to. */
type Act = {
  /** `none` for a command that votes nothing but still says something about a file. */
  readonly verb: Vote | "none"
  /** The files it names: written, edited, removed, created, or moved away from. */
  readonly paths: readonly Target[]
  /** Whether it brought `paths` into being: a write, a copy's destination, a `mkdir`. */
  readonly made?: boolean
  /** A delete that takes a directory with it: `rmdir`, `rm -r`. */
  readonly recursive?: boolean
  /** A copy's sources, which is how a backup and its restore find each other. */
  readonly from?: readonly Target[]
  /** The paths `git checkout -- p` or `git restore p` put back. */
  readonly restores?: readonly Target[]
  readonly sleeps?: boolean
  /** Whether it sits inside a `while` or `until` loop, which is how an agent waits. */
  readonly looped?: boolean
}

const act = (verb: Vote | "none", extra: Partial<Act> = {}): Act => ({ verb, paths: [], ...extra })

const acts = (votes: readonly Vote[]): readonly Act[] => votes.map((vote) => act(vote))

const UNMATCHABLE = /[*?[{$~`]/

const normalized = (path: string): string => {
  const parts: string[] = []
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop()
    else parts.push(part)
  }
  return (path.startsWith("/") ? "/" : "") + parts.join("/")
}

const joined = (cwd: string, path: string): string =>
  normalized(path.startsWith("/") || cwd === "" ? path : `${cwd}/${path}`)

/** Resolves paths against `cwd`: `""` is wherever the call started, `undefined` unknown. */
const resolver =
  (cwd: string | undefined): Resolve =>
  (path) => {
    if (cwd === undefined && !path.startsWith("/")) {
      return { text: path, key: undefined, work: isWorkPath(path) }
    }
    const text = joined(cwd ?? "", path)
    const work = isWorkPath(path) && isWorkPath(text)
    return { text, key: UNMATCHABLE.test(text) ? undefined : text, work }
  }

/** A variable at the start of a path, as in `$D/x` or `${D}`. */
const LEADING_VARIABLE = /^\$\{?(\w+)\}?/

/**
 * Where a `cd` leaves the call, given the literal values the call assigned (`W=/repo`).
 *
 * **A directory held in a variable is kept as spelled**, as a scratch one is, so a relative
 * path under it resolves to `$D/x` and is judged as the variable it is. Forgetting it
 * instead would let `x` pass for work: `cd "$D" && rm -rf x` after `D=$(mktemp -d)` is the
 * usual shape of an agent's scratch directory. A variable the call assigned a literal is
 * that literal, so `W=/repo; cd $W` still lands in the work, and `$(git rev-parse
 * --show-toplevel)` is the checkout's root. `~` and `-` stay unknown.
 */
const movedTo = (
  cwd: string | undefined,
  spelled: string | undefined,
  values: ReadonlyMap<string, string>,
): string | undefined => {
  if (spelled === undefined || spelled === "-") return undefined
  const name = LEADING_VARIABLE.exec(spelled)?.[1] ?? ""
  const value = values.get(name)
  const target = value === undefined ? spelled : spelled.replace(LEADING_VARIABLE, value)
  // The checkout's own root, which is where an agent's command starts anyway.
  const root = /^\$\(git rev-parse --show-toplevel\)\/?([^$`]*)$/.exec(target)
  if (root !== null) return normalized(root[1] ?? "")
  if (isScratch(target)) return target
  if (/[$`]/.test(target)) return target
  if (UNMATCHABLE.test(target)) return undefined
  if (cwd === undefined && !target.startsWith("/")) return undefined
  return joined(cwd ?? "", target)
}

/**
 * A command that touches files votes only when it names a path of the work. **A path held
 * in a variable says nothing either way** — `D=$(mktemp -d); rm -rf $D` is the usual shape —
 * so it does not count as one.
 */
const touching = (verb: Vote, checked: readonly Target[], extra: Partial<Act> = {}): Act =>
  act(checked.length > 0 && !checked.some((path) => path.work) ? "none" : verb, {
    paths: checked,
    ...extra,
  })

const TEST_SCRIPTS: ReadonlySet<string> = new Set(["test"])
const CHECK_SCRIPTS: ReadonlySet<string> = new Set(["lint", "check", "typecheck", "format:check"])
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["pnpm", "npm", "yarn", "bun"])
const PACKAGE_VALUED: ReadonlySet<string> = new Set([
  "--filter",
  "-F",
  "-C",
  "--dir",
  "--prefix",
  "--workspace",
  "--cwd",
])

/** `pnpm --filter x test`, `npm run lint`, `yarn workspace w check`, `pnpm vitest run`. */
const packageActs = (words: readonly string[], resolve: Resolve): readonly Act[] => {
  let rest = skipFlags(words.slice(1), PACKAGE_VALUED)
  if (rest[0] === "workspace") rest = skipFlags(rest.slice(2), PACKAGE_VALUED)
  if (rest[0] === "run" || rest[0] === "run-script") rest = skipFlags(rest.slice(1), NO_VALUES)
  const [script = ""] = rest
  if (script === "exec" || script === "dlx") return commandActs(rest.slice(1), [], resolve)
  if (TEST_SCRIPTS.has(script)) return acts(["tested"])
  if (CHECK_SCRIPTS.has(script)) return acts(["checked"])
  return script === "" ? acts(["other"]) : commandActs(rest, [], resolve)
}

const TEST_RUNNERS: ReadonlySet<string> = new Set(["vitest", "jest", "mocha", "pytest", "rspec"])
const CHECKERS: ReadonlySet<string> = new Set([
  "tsc",
  "eslint",
  "oxlint",
  "rubocop",
  "brakeman",
  "mypy",
  "ruff",
])
const SUBCOMMANDS: Readonly<Record<string, Readonly<Record<string, Vote>>>> = {
  rails: { test: "tested" },
  go: { test: "tested", vet: "checked" },
  cargo: { test: "tested", check: "checked", clippy: "checked" },
  mix: { test: "tested" },
}

/** Git subcommands that change nothing: they inform the agent and do not vote. */
const GIT_QUIET: ReadonlySet<string> = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "merge-base",
  "blame",
  "describe",
  "reflog",
  "shortlog",
  "rev-list",
  "cat-file",
  "ls-remote",
  "for-each-ref",
  "symbolic-ref",
  "name-rev",
  "whatchanged",
])

const GIT_VALUED: ReadonlySet<string> = new Set(["-C", "-c", "--git-dir", "--work-tree"])
const RESTORE_VALUED: ReadonlySet<string> = new Set(["-s", "--source"])

/** Whether a `git branch`, `tag`, `stash`, `remote`, `worktree` or `config` only lists. */
const gitLists = (sub: string, args: readonly string[]): boolean => {
  const [first = "", ...more] = args
  if (sub === "stash" || sub === "worktree") return first === "list" || first === "show"
  if (sub === "remote") return first === "" || first === "-v" || first === "get-url"
  if (sub === "config") return first === "--get" || first === "--list" || first === "-l"
  if (sub === "tag") return first === "" || first === "-l" || first === "--list"
  if (sub !== "branch") return false
  return [first, ...more].every(
    (arg) => arg === "" || (isFlag(arg) && !/^-(d|D|m|M|c|C|f)$|^--(delete|move|copy)/.test(arg)),
  )
}

/** The paths after a `--`, or every operand where there is none. */
const pathArgs = (args: readonly string[], valued: ReadonlySet<string>): readonly string[] => {
  const dashes = args.indexOf("--")
  if (dashes >= 0) return args.slice(dashes + 1)
  const rest: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ""
    if (valued.has(arg)) i += 1
    else if (!isFlag(arg)) rest.push(arg)
  }
  return rest
}

const gitActs = (words: readonly string[], resolve: Resolve): readonly Act[] => {
  const [sub = "", ...args] = skipFlags(words.slice(1), GIT_VALUED)
  if (sub === "show" && args.some((arg) => !isFlag(arg) && arg.includes(":"))) return acts(["read"])
  if (GIT_QUIET.has(sub) || gitLists(sub, args)) return []
  if (sub === "grep") return acts(["searched"])
  if (sub === "ls-files") return acts(["listed"])
  if (sub === "commit") return acts(["committed"])
  // Staging changes nothing in the work tree; it is the commit's first half, and voting
  // `other` for it would put `ran commands` beside every commit.
  if (sub === "add") return []
  const named = pathArgs(args, NO_VALUES).map(resolve)
  if (sub === "rm") return [act("deleted", { paths: named })]
  if (sub === "mv") return [act("moved", { paths: named.slice(0, -1) })]
  // Only with `--`: `git checkout name` alone is as likely a branch as a file.
  if (sub === "checkout" && args.includes("--")) {
    return [act("other", { restores: pathArgs(args, NO_VALUES).map(resolve) })]
  }
  if (sub === "restore")
    return [act("other", { restores: pathArgs(args, RESTORE_VALUED).map(resolve) })]
  return acts(["other"])
}

const FIND_SEARCHES = /^-(i?name|i?path|i?regex|wholename|iwholename)$/

/** Where a `find` starts: the words before its first test, or the current directory. */
const findRoots = (words: readonly string[]): readonly string[] => {
  const end = words.findIndex((word, i) => i > 0 && /^[-(!]/.test(word))
  const roots = words.slice(1, end < 0 ? undefined : end)
  return roots.length > 0 ? roots : ["."]
}

const findActs = (words: readonly string[], resolve: Resolve): readonly Act[] => {
  // Judged by its roots, as `rm` is by its operands. The roots stay off the act's paths:
  // a filtered `find` removes only what matched, so it must not count as removing a write
  // that sits under the same root.
  if (words.includes("-delete")) {
    return [act(touching("deleted", findRoots(words).map(resolve)).verb)]
  }
  const exec = words.findIndex((word) => /^-(exec|execdir|ok)$/.test(word))
  const inner = exec < 0 ? [] : words.slice(exec + 1, words.indexOf(";", exec) >>> 0)
  const own: Vote = words.some((word) => FIND_SEARCHES.test(word)) ? "searched" : "listed"
  return [act(own), ...(inner.length > 0 ? commandActs(inner, [], resolve) : [])]
}

/** A script's text, judged by whether it reads and writes files. */
const WRITES =
  /open\([^)]*,\s*(mode=)?["'][wax]b?\+?["']|\.write_text\(|\.write_bytes\(|writeFileSync\(|writeFile\(|File\.write\(|File\.open\([^)]*["'][wa]/
const READS =
  /\.read\(\)|\.read_text\(|\.readlines\(|readFileSync\(|readFile\(|File\.read\(|File\.readlines\(|open\([^),]*\)/

/**
 * The files a script writes, where it spells them: a literal, or a name assigned one
 * literal (`p='src/a.ts'; … open(p,'w')`, which is how agents write an edit).
 */
const scriptPaths = (script: string): readonly string[] => {
  const assigned = new Map<string, string>()
  for (const [, name = "", value = ""] of script.matchAll(/\b(\w+)\s*=\s*["']([^"'\n]+)["']/g)) {
    assigned.set(name, value)
  }
  const written =
    /(?:open|Path|writeFileSync|writeFile|File\.write)\(\s*(?:["']([^"'\n]+)["']|(\w+))\s*[,)]/g
  const paths: string[] = []
  for (const [whole, literal, name] of script.matchAll(written)) {
    const writes = !whole.startsWith("open(") || WRITES.test(script)
    const path = literal ?? assigned.get(name ?? "")
    if (writes && path !== undefined) paths.push(path)
  }
  return paths
}

const scriptAct = (script: string, resolve: Resolve): Act => {
  if (!WRITES.test(script)) return act("other")
  const verb: Vote = READS.test(script) ? "edited" : "wrote"
  return touching(verb, scriptPaths(script).map(resolve), { made: verb === "wrote" })
}

const INTERPRETERS: ReadonlySet<string> = new Set(["python", "python3", "node", "ruby", "perl"])
const INLINE_FLAGS: ReadonlySet<string> = new Set(["-c", "-e", "-p", "-pe", "-ne", "--eval"])
const SCRIPT_FLAGS: ReadonlySet<string> = new Set(["-e", "-f", "--expression", "--file"])

/**
 * The files an in-place `sed` or `perl` edits: its operands, less the script — the first
 * operand, or the value of each `-e`. An empty operand is macOS's `-i ''`.
 */
const editedPaths = (words: readonly string[]): readonly string[] => {
  const rest: string[] = []
  let scripted = false
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i] ?? ""
    if (SCRIPT_FLAGS.has(word) || /^-[a-z]*e$/.test(word)) {
      scripted = true
      i += 1
    } else if (!isFlag(word) && word !== "") rest.push(word)
  }
  return scripted ? rest : rest.slice(1)
}

/** `python3 - <<EOF`, `node -e '…'`, `perl -pi -e`, `python -m pytest`. */
const interpreterActs = (
  words: readonly string[],
  bodies: readonly string[],
  resolve: Resolve,
): readonly Act[] => {
  const [, flag = "", module = ""] = words
  if (flag === "-m" && module === "pytest") return acts(["tested"])
  if (flag === "-m" && CHECKERS.has(module)) return acts(["checked"])
  const inPlace = words.some((word) => /^-[a-z]*i/.test(word) && !word.startsWith("--"))
  if (basename(words[0] ?? "") === "perl" && inPlace) {
    return [touching("edited", editedPaths(words).map(resolve))]
  }
  const inline = words.findIndex((word) => INLINE_FLAGS.has(word))
  const script = [...bodies, ...(inline < 0 ? [] : [words[inline + 1] ?? ""])].join("\n")
  return script === "" ? acts(["other"]) : [scriptAct(script, resolve)]
}

const sedActs = (words: readonly string[], resolve: Resolve): readonly Act[] => {
  const flags = words.slice(1).filter(isFlag)
  if (flags.some((flag) => flag === "--in-place" || /^-[a-zA-Z]*i/.test(flag))) {
    return [touching("edited", editedPaths(words).map(resolve))]
  }
  // A `sed` that prints a file, transformed or not, has read it; one fed by a pipe is a filter.
  const prints = flags.some((flag) => /^-[a-zA-Z]*n/.test(flag)) || editedPaths(words).length > 0
  return acts([prints ? "read" : "other"])
}

const isRecursive = (words: readonly string[]): boolean =>
  words.some((word) => /^-[a-zA-Z]*[rR]/.test(word) || word === "--recursive")

const FILE_ACTS: Readonly<
  Record<string, (words: readonly string[], resolve: Resolve) => readonly Act[]>
> = {
  rm: (words, resolve) => [
    touching("deleted", operands(words).map(resolve), { recursive: isRecursive(words) }),
  ],
  rmdir: (words, resolve) => [
    touching("deleted", operands(words).map(resolve), { recursive: true }),
  ],
  unlink: (words, resolve) => [touching("deleted", operands(words).map(resolve))],
  mv: (words, resolve) => {
    const named = operands(words).map(resolve)
    return [act(touching("moved", named).verb, { paths: named.slice(0, -1) })]
  },
  cp: (words, resolve) => {
    const named = operands(words).map(resolve)
    return [touching("wrote", named.slice(-1), { made: true, from: named.slice(0, -1) })]
  },
  touch: (words, resolve) => [touching("wrote", operands(words).map(resolve), { made: true })],
  tee: (words, resolve) => [touching("wrote", operands(words).map(resolve), { made: true })],
  mkdir: (words, resolve) => [act("none", { paths: operands(words).map(resolve), made: true })],
  sleep: () => [act("none", { sleeps: true })],
  cat: (words) => acts(operands(words).length > 0 ? ["read"] : []),
}

const READERS: ReadonlySet<string> = new Set(["head", "tail", "nl", "less", "more", "bat", "wc"])
const SEARCHERS: ReadonlySet<string> = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "fd"])
const LISTERS: ReadonlySet<string> = new Set(["ls", "tree", "eza", "exa"])

/** What a command whose wrappers are peeled off did. */
const commandActs = (
  raw: readonly string[],
  bodies: readonly string[],
  resolve: Resolve,
): readonly Act[] => {
  const words = unwrapped(raw)
  const [first = "", second = ""] = words
  const head = basename(first)
  const file = FILE_ACTS[head]
  if (file !== undefined) return file(words, resolve)
  if (head === "" || SILENT.has(head)) return []
  if (/^(ba|z|da)?sh$/.test(head) && /^-[a-z]*c[a-z]*$/.test(second)) return actsOf(words[2] ?? "")
  if (READERS.has(head)) return acts(["read"])
  if (SEARCHERS.has(head)) return acts(["searched"])
  if (LISTERS.has(head)) return acts(["listed"])
  if (head === "find") return findActs(words, resolve)
  if (head === "sed") return sedActs(words, resolve)
  if (head === "git") return gitActs(words, resolve)
  if (PACKAGE_MANAGERS.has(head)) return packageActs(words, resolve)
  if (INTERPRETERS.has(head)) return interpreterActs(words, bodies, resolve)
  if (TEST_RUNNERS.has(head)) return acts(["tested"])
  if (CHECKERS.has(head)) return acts(["checked"])
  if (head === "prettier" || head === "oxfmt") {
    return acts([words.includes("--check") || words.includes("-c") ? "checked" : "other"])
  }
  return acts([SUBCOMMANDS[head]?.[second] ?? "other"])
}

/** `x=$(cmd)` on its own: the command substituted is what ran. */
const substituted = (words: readonly string[]): readonly Act[] =>
  words.flatMap((word) => {
    const inner = /^[A-Za-z_]\w*=\$\(([\s\S]*)\)$/.exec(word)?.[1]
    return inner === undefined ? [] : actsOf(inner)
  })

const segmentActs = (segment: Segment, resolve: Resolve): readonly Act[] => {
  const effective = unwrapped(segment.words)
  const own =
    effective.length === 0
      ? substituted(segment.words)
      : commandActs(effective, segment.bodies, resolve)
  const targets = segment.writes.map(resolve)
  const redirected = targets.length === 0 ? [] : [touching("wrote", targets, { made: true })]
  const all = [...own, ...redirected]
  return segment.piped ? all.filter((each) => each.verb !== "none" && EFFECTS.has(each.verb)) : all
}

/**
 * A segment once for each value of a `for` loop's variable it names, so `git mv $f dir/`
 * inside `for f in a b` names `a` and `b`. Each copy is one run of the loop's body.
 */
const expanded = (
  segment: Segment,
  bound: ReadonlyMap<string, readonly string[]>,
): readonly Segment[] => {
  for (const [name, items] of bound) {
    const reference = new RegExp(`\\$\\{?${name}\\b\\}?`, "g")
    if (!segment.words.some((word) => reference.test(word))) continue
    return items.flatMap((item) =>
      expanded(
        { ...segment, words: segment.words.map((word) => word.replace(reference, item)) },
        new Map([...bound].filter(([other]) => other !== name)),
      ),
    )
  }
  return [segment]
}

/** The state a call carries from one segment to the next. */
type Walk = {
  cwd: string | undefined
  readonly loops: ("wait" | "for")[]
  readonly bound: Map<string, readonly string[]>
  /** Variables the call assigned a literal, which a `cd` can follow. */
  readonly values: Map<string, string>
}

/** Follows loops, `for` bindings and `cd`; true where the segment is only loop syntax. */
const followed = (walk: Walk, words: readonly string[]): boolean => {
  const [first = "", name = "", keyword = "", ...items] = words
  if (first === "done") {
    walk.loops.pop()
    return true
  }
  if (first === "for" || first === "select") {
    if (keyword === "in") walk.bound.set(name, items)
    walk.loops.push("for")
    return true
  }
  if (first === "while" || first === "until") walk.loops.push("wait")
  return false
}

/**
 * Records `NAME=value` assignments: a literal value is kept, and anything else — a command
 * substitution, another variable — forgets the name, since its value cannot be known here.
 */
const assigned = (values: Map<string, string>, words: readonly string[]): void => {
  for (const word of words) {
    const [, name, value = ""] = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(word) ?? []
    if (name === undefined) return
    if (UNMATCHABLE.test(value) || value.includes("`")) values.delete(name)
    else values.set(name, value)
  }
}

/** Everything one command string did, in the order it did it. */
const actsOf = (command: string): readonly Act[] => {
  const walk: Walk = { cwd: "", loops: [], bound: new Map(), values: new Map() }
  const done: Act[] = []
  for (const segment of new Lexer(command).segments()) {
    if (followed(walk, segment.words)) continue
    const looped = walk.loops.includes("wait")
    for (const copy of expanded(segment, walk.bound)) {
      const own = segmentActs(copy, resolver(walk.cwd))
      done.push(...(looped ? own.map((each) => ({ ...each, looped })) : own))
      const [head = "", target] = unwrapped(copy.words).filter((word) => !isFlag(word))
      if (head === "cd" || head === "pushd") walk.cwd = movedTo(walk.cwd, target, walk.values)
      assigned(walk.values, copy.words)
    }
  }
  return done
}

/** One act, placed in the run: which call it came from and where among all of them. */
type Placed = { readonly act: Act; readonly call: number }

const keys = (paths: readonly Target[]): readonly (string | undefined)[] =>
  paths.map((path) => path.key)

/** Whether a delete removed `key`, by naming it or a directory holding it. */
const removes = (deleted: Act, key: string): boolean =>
  deleted.paths.some(
    (path) =>
      path.key !== undefined &&
      (path.key === key || (deleted.recursive === true && key.startsWith(`${path.key}/`))),
  )

/**
 * Scratch: a file the run made and then removed counts for nothing, and neither does the
 * remove. Nor does removing a directory that the same call emptied by moving files out.
 */
const dropScratch = (placed: readonly Placed[], dropped: Set<Act>): void => {
  placed.forEach(({ act: made }, i) => {
    if (made.made !== true || made.paths.length === 0) return
    const later = placed.slice(i + 1).filter(({ act: each }) => each.verb === "deleted")
    const gone = keys(made.paths).every(
      (key) => key !== undefined && later.some(({ act: each }) => removes(each, key)),
    )
    if (gone) dropped.add(made)
  })
  placed.forEach(({ act: deleted, call }, j) => {
    if (deleted.verb !== "deleted" || deleted.paths.length === 0) return
    const before = placed.slice(0, j)
    const accounted = deleted.paths.every(({ key, text }) => {
      if (key === undefined) return false
      const madeHere = before.some(
        ({ act: each }) => each.made === true && keys(each.paths).includes(key),
      )
      const emptied =
        deleted.recursive === true &&
        before.some(
          ({ act: each, call: at }) =>
            at === call &&
            each.verb === "moved" &&
            each.paths.some((from) => from.text.startsWith(`${text}/`)),
        )
      return madeHere || emptied
    })
    if (accounted) dropped.add(deleted)
  })
}

/** The paths an act puts back: a `git checkout --`, or a copy back from a backup. */
const restored = (placed: readonly Placed[], j: number): readonly (string | undefined)[] => {
  const { act: each } = placed[j] ?? { act: act("none") }
  if (each.restores !== undefined) return keys(each.restores)
  const [source] = each.from ?? []
  const [target] = each.paths
  if (each.from?.length !== 1 || source?.key === undefined || target?.key === undefined) return []
  const backedUp = placed
    .slice(0, j)
    .some(
      ({ act: copy }) => copy.from?.[0]?.key === target.key && copy.paths[0]?.key === source.key,
    )
  return backedUp ? [target.key] : []
}

/** An edit the run later puts back counts for nothing, and neither does putting it back. */
const dropUndone = (placed: readonly Placed[], dropped: Set<Act>): void => {
  placed.forEach((_, j) => {
    const back = restored(placed, j)
    if (back.length === 0 || back.includes(undefined)) return
    const edits = placed
      .slice(0, j)
      .map(({ act: each }) => each)
      .filter(
        (each) =>
          (each.verb === "edited" || each.verb === "wrote") &&
          each.paths.length > 0 &&
          keys(each.paths).every((key) => back.includes(key)),
      )
    const undoneAll = back.every((key) => edits.some((each) => keys(each.paths).includes(key)))
    for (const each of edits) dropped.add(each)
    if (undoneAll) dropped.add(placed[j]?.act ?? act("none"))
  })
}

/** A call made only of `sleep`, and loops around it, was the agent waiting. */
const waited = (done: readonly Act[]): boolean =>
  done.some((each) => each.sleeps === true) &&
  done.every(
    (each) => each.verb === "none" || (each.looped === true && !EFFECT_VERBS.has(each.verb)),
  )

/** What one call says, once the run has settled which of its acts count. */
const verbsOf = (done: readonly Act[]): readonly (ShellVerb | undefined)[] => {
  if (waited(done)) return ["waited"]
  const votes = done.flatMap((each) => (each.verb === "none" ? [] : [each.verb]))
  const loud = [...new Set(votes.filter((vote) => vote === "other" || EFFECT_VERBS.has(vote)))]
  if (loud.some((vote) => vote !== "other")) {
    return loud.map((vote) => (vote === "other" ? undefined : vote))
  }
  if (loud.length > 0) return [undefined]
  return [READ_ONLY.findLast((vote) => votes.includes(vote))]
}

/**
 * What each shell call of a run did: one list per command, in order, each holding the
 * call's verbs in the order it did them. `undefined` in a list is `ran commands` — a
 * command nothing here can name, or a call where nothing voted.
 *
 * A call names **every distinct effect** — `git mv a b && rm c` moved and deleted — and a
 * read-only verb only when it has no effect, its strongest: searched, then listed, then read.
 */
export const shellVerbs = (
  commands: readonly string[],
): readonly (readonly (ShellVerb | undefined)[])[] => {
  const calls = commands.map(actsOf)
  const placed = calls.flatMap((done, call) => done.map((each) => ({ act: each, call })))
  const dropped = new Set<Act>()
  dropScratch(placed, dropped)
  dropUndone(placed, dropped)
  return calls.map((done) => verbsOf(done.filter((each) => !dropped.has(each))))
}
