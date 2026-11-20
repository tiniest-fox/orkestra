// types: the reasoning-effort levels each CLI accepts — the one copy, read by the
// library loader when it validates an `effort:` and by nothing else.
//
// Checked at load and never at spawn, because a CLI does not refuse a level it does
// not know: `claude --effort bogus` warns on stderr, runs at its default and exits 0,
// and that stderr is read only when a turn exits non-zero. A wrong level that reaches
// the command line is invisible for the life of the trak.
//
// **Per CLI, never per model.** Codex keeps the levels each of its models supports in
// its own catalog, which the engine cannot read, so a level Codex knows but one model
// does not reaches the CLI and fails there — that failure is Codex's to report.

/** What `claude --effort` takes. */
export const CLAUDE_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"]

/** What `codex -c model_reasoning_effort=` takes, across every model in its catalog. */
export const CODEX_EFFORTS: readonly string[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "persistent",
]

/**
 * Every CLI this build can spawn, by the qualifier a model name carries for it, and the
 * levels its effort flag takes. The keys are the group names `models.yaml` may use and
 * the names the provider specs register under; `argv.test.ts` in each bundle pins the
 * two together.
 */
export const CLI_EFFORTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["claude", CLAUDE_EFFORTS],
  ["codex", CODEX_EFFORTS],
])

/**
 * The CLI a bare model name runs on — `opus`, with no qualifier. The registry answers a
 * bare name with its first adapter, and the loader keeps this group's names bare so the
 * two facts keep agreeing: an entry under this group reaches the registry unqualified,
 * and one under any other reaches it as `<cli>/<name>`.
 */
export const BARE_CLI = "claude"
