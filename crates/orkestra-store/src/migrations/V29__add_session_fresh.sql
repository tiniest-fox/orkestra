-- Add session_fresh column to assistant_sessions.
-- Tracks whether the next agent spawn is a post-loss recovery that should not
-- increment spawn_count, preventing the resume-retry cycle after session loss.
ALTER TABLE assistant_sessions ADD COLUMN session_fresh INTEGER NOT NULL DEFAULT 0;
