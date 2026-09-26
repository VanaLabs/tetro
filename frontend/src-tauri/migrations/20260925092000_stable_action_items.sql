CREATE TABLE meeting_action_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    canonical_text TEXT NOT NULL,
    text TEXT NOT NULL,
    owner TEXT,
    due TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    manual_edit INTEGER NOT NULL DEFAULT 0,
    source_latest INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX meeting_action_items_meeting ON meeting_action_items(meeting_id);
CREATE TABLE meeting_action_sources (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL
);
