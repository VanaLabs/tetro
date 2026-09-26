-- Ticked-off state for action items collected from meeting notes.
CREATE TABLE IF NOT EXISTS action_item_state (
    item_key TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_action_item_state_meeting ON action_item_state(meeting_id);
