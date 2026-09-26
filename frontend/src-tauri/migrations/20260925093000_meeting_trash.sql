ALTER TABLE meetings ADD COLUMN deleted_at TEXT;
ALTER TABLE meetings ADD COLUMN audio_trashed INTEGER NOT NULL DEFAULT 0;
CREATE TABLE meeting_trash (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    parts TEXT NOT NULL,
    version_id TEXT,
    tasks TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX meeting_trash_meeting ON meeting_trash(meeting_id);
