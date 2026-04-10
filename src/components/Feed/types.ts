// Shared types for the Feed diff components.

// "all" = all changes, "uncommitted" = uncommitted changes, any other string = commit hash
export type DiffMode = "all" | "uncommitted" | (string & {});
