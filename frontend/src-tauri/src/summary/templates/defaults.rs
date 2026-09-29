/// Embedded default templates using compile-time inclusion
///
/// These templates are bundled into the binary and serve as fallbacks
/// when custom templates are not available.

/// Bundled templates are embedded so they remain available if resource lookup fails.
pub const DAILY_STANDUP: &str = include_str!("../../../templates/daily_standup.json");
pub const STANDARD_MEETING: &str = include_str!("../../../templates/standard_meeting.json");
pub const PLAN: &str = include_str!("../../../templates/plan.json");
pub const IDEAS_AND_NOTES: &str = include_str!("../../../templates/ideas_and_notes.json");
pub const TEAM_MEETING: &str = include_str!("../../../templates/team_meeting.json");
pub const INTERVIEW: &str = include_str!("../../../templates/interview.json");
pub const PROJECT_SYNC: &str = include_str!("../../../templates/project_sync.json");
pub const RETROSPECTIVE: &str = include_str!("../../../templates/retrospective.json");
pub const CLIENT_SALES: &str = include_str!("../../../templates/sales_marketing_client_call.json");
pub const PODCAST: &str = include_str!("../../../templates/podcast_pre_interview.json");
pub const THERAPY_VISIT: &str = include_str!("../../../templates/psychatric_session.json");

/// Registry of all built-in templates
///
/// Maps template identifiers to their embedded JSON content
pub fn get_builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        ("daily_standup", DAILY_STANDUP),
        ("plan", PLAN),
        ("standard_meeting", STANDARD_MEETING),
        ("ideas_and_notes", IDEAS_AND_NOTES),
        ("team_meeting", TEAM_MEETING),
        ("interview", INTERVIEW),
        ("project_sync", PROJECT_SYNC),
        ("retrospective", RETROSPECTIVE),
        ("sales_marketing_client_call", CLIENT_SALES),
        ("podcast_pre_interview", PODCAST),
        ("psychatric_session", THERAPY_VISIT),
    ]
}

/// Get a built-in template by identifier
///
/// # Arguments
/// * `id` - Template identifier (e.g., "daily_standup", "standard_meeting")
///
/// # Returns
/// The template JSON content if found, None otherwise
pub fn get_builtin_template(id: &str) -> Option<&'static str> {
    match id {
        "daily_standup" => Some(DAILY_STANDUP),
        "plan" => Some(PLAN),
        "standard_meeting" => Some(STANDARD_MEETING),
        "ideas_and_notes" => Some(IDEAS_AND_NOTES),
        "team_meeting" => Some(TEAM_MEETING),
        "interview" => Some(INTERVIEW),
        "project_sync" => Some(PROJECT_SYNC),
        "retrospective" => Some(RETROSPECTIVE),
        "sales_marketing_client_call" => Some(CLIENT_SALES),
        "podcast_pre_interview" => Some(PODCAST),
        "psychatric_session" => Some(THERAPY_VISIT),
        _ => None,
    }
}

/// List all built-in template identifiers
pub fn list_builtin_template_ids() -> Vec<&'static str> {
    vec![
        "daily_standup", "plan", "standard_meeting", "ideas_and_notes",
        "team_meeting", "interview", "project_sync", "retrospective",
        "sales_marketing_client_call", "podcast_pre_interview", "psychatric_session",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_templates_valid_json() {
        for (id, content) in get_builtin_templates() {
            let result = serde_json::from_str::<serde_json::Value>(content);
            assert!(
                result.is_ok(),
                "Built-in template '{}' contains invalid JSON: {:?}",
                id,
                result.err()
            );
        }
    }

    #[test]
    fn test_get_builtin_template() {
        assert!(get_builtin_template("daily_standup").is_some());
        assert!(get_builtin_template("plan").is_some());
        assert!(get_builtin_template("standard_meeting").is_some());
        assert!(get_builtin_template("nonexistent").is_none());
    }
}
