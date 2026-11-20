/**
 * The shiki grammar a name asks for — a file's extension, or the label on a fence.
 *
 * **Curated rather than exhaustive**, and each grammar is a chunk the build emits: a map
 * over every grammar shiki ships would be two hundred chunks to colour a repository that
 * writes five languages. A name that misses draws plain, which is what an unlabelled
 * fenced block already does — see `components/Markdown`.
 *
 * **One vocabulary for both callers.** The tokens agents write on a fence — `ts`, `sh`,
 * `yml` — are the extensions the Changes tab splits off a path, so the Changes tab and a
 * fenced block colour the same language the same way. A grammar's own name is accepted
 * too, because a fence says `typescript` as often as `ts`.
 *
 * `hooks/useTokens` keys its importers on `Grammar`: a grammar named below with no chunk
 * behind it, or a chunk nothing names, fails `tsc` rather than rendering plain with
 * nothing to say so.
 */

/** A grammar this build carries a chunk for. */
export type Grammar =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "jsonc"
  | "css"
  | "html"
  | "markdown"
  | "shell"
  | "yaml"
  | "toml"
  | "rust"
  | "python"
  | "go"
  | "sql"

const GRAMMAR: Readonly<Record<string, Grammar>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  html: "html",
  md: "markdown",
  markdown: "markdown",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shell: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  go: "go",
  sql: "sql",
}

/**
 * Case does not matter: `TS` on a fence and `.JSON` on a path both happen. `hasOwn`
 * because the map is a plain object — without it a fence labelled `constructor` would
 * come back holding a function.
 */
export const grammarOf = (name: string): Grammar | undefined => {
  const key = name.toLowerCase()
  return Object.hasOwn(GRAMMAR, key) ? GRAMMAR[key] : undefined
}
