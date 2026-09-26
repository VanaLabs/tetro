ALTER TABLE meetings ADD COLUMN title_source TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE meetings ADD COLUMN template_id TEXT;

-- Existing descriptive names may have been typed by the user. Never guess otherwise.
UPDATE meetings SET title_source = 'manual'
WHERE NOT (title GLOB 'Meeting [0-9]*' OR lower(title) IN ('new recording', 'new meeting', 'untitled', 'meeting'));

CREATE TABLE IF NOT EXISTS app_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_preferences (key, value) VALUES ('automatic_names', 'true');
