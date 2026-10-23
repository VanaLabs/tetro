-- Keep translation recovery separate from the visible, completed summary.
ALTER TABLE summary_processes ADD COLUMN translation_checkpoint TEXT;
