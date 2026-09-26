-- Remove the previously added, unused decision-provider key from existing profiles.
ALTER TABLE settings DROP COLUMN typesafeApiKey;
