CREATE TABLE device_tokens (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pairing_codes (
    code TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0
);
