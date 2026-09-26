-- Moments the user marked as important while recording (Tetro "mark moment").
CREATE TABLE IF NOT EXISTS meeting_marks (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    at_seconds REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meeting_marks_meeting_id ON meeting_marks(meeting_id);
