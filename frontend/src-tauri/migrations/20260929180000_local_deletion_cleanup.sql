-- A durable receipt lets the webview remove local drafts after a crash/restart too.
CREATE TABLE local_deletion_cleanup (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    transcript_ids TEXT NOT NULL,
    parts TEXT NOT NULL
);
