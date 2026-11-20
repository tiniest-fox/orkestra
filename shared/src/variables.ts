// The environment variables no secret may be, and so no `${NAME}` in `.orkestra/mcp.yaml`
// may name. The host's store refuses to keep one; the MCP file refuses to send one, since a
// reference is filled from the engine's whole environment and would otherwise hand a stdio
// server or any URL what the host set for the engine itself. One copy, here because a host
// and `src/library/` may not import each other.

/**
 * What a child's process or its commits depend on, so a stored value would change what runs
 * rather than what it authenticates as. `ORKESTRA_*` is the host's own, and includes the
 * engine key. The tokens are also the `docker` CLI's own environment, so `DOCKER_*` could send
 * a container launch to another daemon; `LD_*`, `DYLD_*` and `NODE_PATH` could load other code
 * into a local engine.
 */
const RESERVED = new Set(["PATH", "HOME", "USER", "SHELL", "NODE_OPTIONS", "NODE_PATH"])
const RESERVED_PREFIXES = ["ORKESTRA_", "GIT_AUTHOR_", "GIT_COMMITTER_", "DOCKER_", "LD_", "DYLD_"]

/** `name` is one the host and the engines it starts set themselves, never a secret. */
export const reservedVariable = (name: string): boolean =>
  RESERVED.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p))
