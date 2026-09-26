-- Recover the template used by existing generated notes when that information was saved.
UPDATE meetings SET template_id = (
    SELECT json_extract(s.result, '$.english_cache.source.template_id')
    FROM summary_processes s WHERE s.meeting_id = meetings.id AND json_valid(s.result)
) WHERE template_id IS NULL;
