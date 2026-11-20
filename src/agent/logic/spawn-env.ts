// logic: the environment a spawned process is given.
//
// Inheriting the parent's environment is the point — a check has to find the tools a
// developer would find, and `claude` has to find its own auth. What may not be inherited
// is **the engine's knowledge of which engine it is**, and one credential that would
// change who pays.

/**
 * Variables the engine uses to tell its own halves apart, and the one thing a process it
 * spawns must never be handed.
 *
 * `ORKESTRA_PROJECT_DIR` names the project a daemon serves and `ORKESTRA_API_PORT` /
 * `ORKESTRA_CLIENT_PORT` name the pair it holds. Inherited into a turn running in a
 * worktree, they make that worktree's `pnpm ork` resolve the *person's* project and find
 * the *person's* engine — and `src/cli/http.ts` calls that comparison "the only thing
 * standing between one worktree's `ork` and another's traks". The same inheritance
 * reaches a check: a check that runs the browser tier boots Playwright, whose `webServer`
 * spawns `pnpm ui:both`, and a `pnpm serve` under it that resolved the person's project would bind a
 * second daemon over their live `.orkestra/.database/` without going through the
 * refusal that exists to stop exactly that.
 *
 * A prefix rather than the three names: they are one channel, they leak identically, and
 * a fourth variable added to it would otherwise regress this silently.
 */
const ENGINE_PREFIX = "ORKESTRA_"

/**
 * How the desktop shell runs the engine on Electron's own Node: set in the engine's
 * environment, it tells the Electron binary to behave as `node`. A child that inherits
 * it and reaches an Electron binary — the shell itself, or anything an agent builds on
 * one — boots headless as Node instead of as the app it named, with nothing saying why.
 * The `PATH` the shell resolved from the login shell is inherited on purpose; only the
 * switch is removed.
 */
const ELECTRON_AS_NODE = "ELECTRON_RUN_AS_NODE"

/**
 * An OpenAI API key in the engine's environment reaches `codex` untouched and switches
 * it, silently, from the person's ChatGPT subscription to per-token API billing: the
 * key outranks `~/.codex/auth.json` and nothing on the stream says which paid. A person
 * who exports one for other work is not choosing that for every Codex turn. Stripped
 * with the same rule as the engine's own variables, and for the same reason it reaches
 * `capturedEnv` too — a tool manager re-exporting the shell it was launched from puts
 * it straight back.
 */
const OPENAI_KEY = "OPENAI_API_KEY"

/**
 * The Claude CLI's two credentials, which a host blanks in an engine's environment to mean
 * none: from two host users each spawn is handed its owner's alone. An empty one is dropped
 * rather than inherited, so no child reads a blank as a credential that was set.
 */
const BLANKED = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"])

const isBlanked = (key: string, value: string): boolean => value === "" && BLANKED.has(key)

/**
 * The parent environment with the engine's own variables, Electron's run-as-Node
 * switch and whatever the caller withholds removed, then the caller's overrides on top.
 *
 * **The strip is on the inherited base, never on the result.** An explicit entry is
 * something a caller decided to send, and a caller that means to hand a child an
 * `ORKESTRA_` variable is not the accident this guards against — `pnpm ui` telling the
 * two halves it spawns which project and which ports they have is that case, and it does
 * not come through here.
 *
 * Unset keys are dropped because `process.env` types every value as possibly
 * `undefined`, and `node:child_process` wants a string map.
 */
export const spawnEnv = (
  parent: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string>>,
  withheld: readonly string[] = [],
): Record<string, string> => {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (
      value === undefined ||
      withheld.includes(key) ||
      key.startsWith(ENGINE_PREFIX) ||
      key === ELECTRON_AS_NODE ||
      key === OPENAI_KEY ||
      isBlanked(key, value)
    ) {
      continue
    }
    base[key] = value
  }
  return { ...base, ...overrides }
}

/**
 * The variables a project's env script left exported, read back from `env -0` and made
 * safe to lay over a spawn.
 *
 * NUL-separated records, because a value may hold a newline — an exported bash function
 * does — and the only byte an environment value cannot hold is NUL. The first `=` ends
 * the name; a record without one is not a variable and is dropped.
 *
 * **Stripped by the same rule as the inherited base**, and for the same reason. The
 * script runs in a child that already lost the engine's variables, so the only way one
 * comes back is the script exporting it — `mise` re-exporting the shell it was launched
 * from, or a person's `.envrc` carrying an `ORKESTRA_PROJECT_DIR` they set once. Either
 * way the result is a caller handing a child a variable no caller decided to send, which
 * is exactly what `spawnEnv` refuses on the base and cannot see in an override.
 */
export const capturedEnv = (dump: string): Record<string, string> => {
  const parsed: Record<string, string> = {}
  for (const record of dump.split("\0")) {
    const at = record.indexOf("=")
    if (at <= 0) continue
    parsed[record.slice(0, at)] = record.slice(at + 1)
  }
  return spawnEnv(parsed, {})
}

/**
 * What a spawn in a sandbox is handed: its own explicit `env`, and of the engine's
 * environment only the `names` given — the runner's `pass:` and the spawn's
 * credentials. Everything else comes from the sandbox's own login environment, because
 * the engine's `PATH` and `HOME` name this machine, and every other value it holds is a
 * secret nobody chose to send. An explicit entry wins over an inherited one.
 */
export const sandboxEnv = (
  parent: Readonly<Record<string, string | undefined>>,
  explicit: Readonly<Record<string, string>>,
  names: readonly string[],
): Record<string, string> => {
  const picked: Record<string, string> = {}
  for (const name of names) {
    const value = parent[name]
    if (value !== undefined && !isBlanked(name, value)) picked[name] = value
  }
  return { ...picked, ...explicit }
}

/**
 * An environment as the block the runner's wrapper reads off stdin ahead of the
 * command's own input: one `NAME=value` record per variable, each ended by a NUL, then
 * an empty record. NUL because it is the one byte a value cannot hold; the empty record
 * because the wrapper has to stop reading exactly where the command's input begins.
 */
export const environmentBlock = (env: Readonly<Record<string, string>>): string =>
  `${Object.entries(env)
    .map(([name, value]) => `${name}=${value}\0`)
    .join("")}\0`
