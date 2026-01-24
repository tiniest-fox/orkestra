-- Initial schema: tasks and work_loops tables

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'task',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    summary TEXT,
    error TEXT,
    plan TEXT,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT,
    breakdown TEXT,
    skip_breakdown INTEGER NOT NULL DEFAULT 0,
    agent_pid INTEGER,
    branch_name TEXT,
    worktree_path TEXT,
    phase TEXT NOT NULL DEFAULT 'idle',
    depends_on TEXT DEFAULT '[]',
    work_items TEXT DEFAULT '[]',
    assigned_worker_task_id TEXT,
    pending_questions TEXT DEFAULT '[]',
    question_history TEXT DEFAULT '[]',
    FOREIGN KEY (parent_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS work_loops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    loop_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    started_from TEXT NOT NULL,
    outcome TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE(task_id, loop_number)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_work_loops_task_id ON work_loops(task_id);
