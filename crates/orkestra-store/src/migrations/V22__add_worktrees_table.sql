CREATE TABLE worktrees (
    task_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    base_branch TEXT,
    worktree_path TEXT,
    created_at TEXT NOT NULL
);
