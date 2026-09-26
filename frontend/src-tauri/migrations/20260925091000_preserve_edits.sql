CREATE TABLE meeting_edits (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    anchor TEXT NOT NULL,
    original_text TEXT NOT NULL,
    replacement_text TEXT NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (meeting_id, kind, anchor)
);
CREATE TABLE meeting_versions (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX meeting_versions_by_meeting ON meeting_versions(meeting_id, created_at DESC);
