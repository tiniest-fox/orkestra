-- Unified iterations: individual turns within a stage session

CREATE TABLE IF NOT EXISTS iterations (
    task_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    data TEXT,
    outcome TEXT,
    PRIMARY KEY (task_id, stage, iteration),
    FOREIGN KEY (task_id, stage) REFERENCES stage_sessions(task_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_iterations_task_stage ON iterations(task_id, stage);
