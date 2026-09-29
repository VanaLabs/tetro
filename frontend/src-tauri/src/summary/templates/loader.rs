use super::defaults;
use super::types::Template;
use std::path::PathBuf;
use tracing::{debug, info, warn};
use once_cell::sync::Lazy;
use std::sync::RwLock;

// Global storage for the bundled templates directory path
static BUNDLED_TEMPLATES_DIR: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// Set the bundled templates directory path (called once at app startup)
pub fn set_bundled_templates_dir(path: PathBuf) {
    info!("Bundled templates directory set to: {:?}", path);
    if let Ok(mut dir) = BUNDLED_TEMPLATES_DIR.write() {
        *dir = Some(path);
    }
}

/// Get the user's custom templates directory path
///
/// Returns the platform-specific application data directory for custom templates:
/// - macOS: ~/Library/Application Support/am.vanalabs.tetro/templates/
/// - Windows/Linux: templates/ inside Tetro's app data directory
fn get_custom_templates_dir() -> Option<PathBuf> {
    let mut path = crate::app_profile::data_dir()?;
    path.push("templates");
    Some(path)
}

/// Load a template from the bundled resources directory
///
/// # Arguments
/// * `template_id` - Template identifier (without .json extension)
///
/// # Returns
/// The template JSON content if found, None otherwise
fn load_bundled_template(template_id: &str) -> Option<String> {
    if !is_safe_template_id(template_id) { return None; }
    let bundled_dir = BUNDLED_TEMPLATES_DIR.read().ok()?.clone()?;
    let template_path = bundled_dir.join(format!("{}.json", template_id));

    debug!("Checking for bundled template at: {:?}", template_path);

    match std::fs::read_to_string(&template_path) {
        Ok(content) => {
            info!("Loaded bundled template '{}' from {:?}", template_id, template_path);
            Some(content)
        }
        Err(e) => {
            debug!("No bundled template '{}' found: {}", template_id, e);
            None
        }
    }
}

/// Load a template from the user's custom templates directory
///
/// # Arguments
/// * `template_id` - Template identifier (without .json extension)
///
/// # Returns
/// The template JSON content if found, None otherwise
fn load_custom_template(template_id: &str) -> Option<String> {
    if !is_safe_template_id(template_id) { return None; }
    let custom_dir = get_custom_templates_dir()?;
    let template_path = custom_dir.join(format!("{}.json", template_id));

    debug!("Checking for custom template at: {:?}", template_path);

    match std::fs::read_to_string(&template_path) {
        Ok(content) => {
            info!("Loaded custom template '{}' from {:?}", template_id, template_path);
            Some(content)
        }
        Err(e) => {
            debug!("No custom template '{}' found: {}", template_id, e);
            None
        }
    }
}

/// Load and parse a template by identifier
///
/// This function implements a fallback strategy:
/// 1. Check user's custom templates directory
/// 2. Check bundled resources directory (app templates)
/// 3. Fall back to built-in embedded templates
/// 4. Return error if not found in any location
///
/// # Arguments
/// * `template_id` - Template identifier (e.g., "daily_standup", "standard_meeting")
///
/// # Returns
/// Parsed and validated Template struct
pub fn get_template(template_id: &str) -> Result<Template, String> {
    if !is_safe_template_id(template_id) {
        return Err("Invalid template identifier".to_string());
    }
    info!("Loading template: {}", template_id);

    // Try custom template first, then bundled, then built-in
    let json_content = if let Some(custom_content) = load_custom_template(template_id) {
        debug!("Using custom template for '{}'", template_id);
        custom_content
    } else if let Some(bundled_content) = load_bundled_template(template_id) {
        debug!("Using bundled template for '{}'", template_id);
        bundled_content
    } else if let Some(builtin_content) = defaults::get_builtin_template(template_id) {
        debug!("Using built-in template for '{}'", template_id);
        builtin_content.to_string()
    } else {
        return Err(format!(
            "Template '{}' not found. Available templates: {}",
            template_id,
            list_template_ids().join(", ")
        ));
    };

    // Parse and validate
    validate_and_parse_template(&json_content)
}

/// Validate and parse template JSON
///
/// # Arguments
/// * `json_content` - Raw JSON string
///
/// # Returns
/// Parsed and validated Template struct
pub fn validate_and_parse_template(json_content: &str) -> Result<Template, String> {
    let template: Template = serde_json::from_str(json_content)
        .map_err(|e| format!("Failed to parse template JSON: {}", e))?;

    template.validate()?;

    Ok(template)
}

/// List all available template identifiers
///
/// Returns a combined list of:
/// - Built-in template IDs
/// - Bundled template IDs (from app resources)
/// - Custom template IDs (from user's data directory)
pub fn list_template_ids() -> Vec<String> {
    let mut ids: Vec<String> = defaults::list_builtin_template_ids()
        .into_iter()
        .map(|s| s.to_string())
        .collect();

    // Add bundled templates if directory is set
    if let Ok(bundled_dir_lock) = BUNDLED_TEMPLATES_DIR.read() {
        if let Some(bundled_dir) = bundled_dir_lock.as_ref() {
            if bundled_dir.exists() {
                match std::fs::read_dir(bundled_dir) {
                    Ok(entries) => {
                        for entry in entries.flatten() {
                            if let Some(filename) = entry.file_name().to_str() {
                                if filename.ends_with(".json") {
                                    let id = filename.trim_end_matches(".json").to_string();
                                    if !ids.contains(&id) {
                                        ids.push(id);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to read bundled templates directory: {}", e);
                    }
                }
            }
        }
    }

    // Add custom templates if directory exists
    if let Some(custom_dir) = get_custom_templates_dir() {
        if custom_dir.exists() {
            match std::fs::read_dir(&custom_dir) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        if let Some(filename) = entry.file_name().to_str() {
                            if filename.ends_with(".json") {
                                let id = filename.trim_end_matches(".json").to_string();
                                if !ids.contains(&id) {
                                    ids.push(id);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to read custom templates directory: {}", e);
                }
            }
        }
    }

    ids.sort();
    ids
}

/// List all available templates with their metadata
///
/// Returns a list of (id, name, description) tuples
pub fn list_templates() -> Vec<(String, String, String)> {
    let mut templates = Vec::new();

    for id in list_template_ids() {
        match get_template(&id) {
            Ok(template) => {
                templates.push((id, template.name, template.description));
            }
            Err(e) => {
                warn!("Failed to load template '{}': {}", id, e);
            }
        }
    }

    templates
}

/// True when a template with this id exists in the user's custom templates folder.
pub fn is_custom_template(template_id: &str) -> bool {
    if !is_safe_template_id(template_id) { return false; }
    get_custom_templates_dir()
        .map(|dir| dir.join(format!("{}.json", template_id)).is_file())
        .unwrap_or(false)
}

/// True when a built-in or bundled template exists with this id (ignoring custom overrides).
pub fn has_original_template(template_id: &str) -> bool {
    defaults::get_builtin_template(template_id).is_some() || load_bundled_template(template_id).is_some()
}

/// Only lowercase letters, digits, `_` and `-` are allowed in template ids (they become file names).
fn is_safe_template_id(template_id: &str) -> bool {
    !template_id.is_empty()
        && template_id.len() <= 64
        && template_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// Writes a validated template to the custom templates folder.
///
/// Saving under a built-in id overrides that built-in; deleting the file restores it.
pub fn save_custom_template(template_id: &str, template: &Template) -> Result<PathBuf, String> {
    if !is_safe_template_id(template_id) {
        return Err(format!("Invalid template id '{}'", template_id));
    }
    template.validate()?;
    let dir = get_custom_templates_dir().ok_or("Could not locate the custom templates folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create templates folder: {}", e))?;
    let path = dir.join(format!("{}.json", template_id));
    let json = serde_json::to_string_pretty(template).map_err(|e| format!("Could not encode template: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Could not save template: {}", e))?;
    info!("Saved custom template '{}' to {:?}", template_id, path);
    Ok(path)
}

/// Removes a custom template file. Built-in templates cannot be removed.
pub fn delete_custom_template(template_id: &str) -> Result<(), String> {
    if !is_safe_template_id(template_id) {
        return Err(format!("Invalid template id '{}'", template_id));
    }
    let dir = get_custom_templates_dir().ok_or("Could not locate the custom templates folder")?;
    let path = dir.join(format!("{}.json", template_id));
    if !path.is_file() {
        return Err("Only templates you created or customized can be deleted".to_string());
    }
    std::fs::remove_file(&path).map_err(|e| format!("Could not delete template: {}", e))?;
    info!("Deleted custom template '{}'", template_id);
    Ok(())
}

/// Turns a template name into an unused file-safe id, e.g. "Client Kick-off" -> "client_kick_off".
pub fn unique_template_id(name: &str) -> String {
    let mut base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    while base.contains("__") {
        base = base.replace("__", "_");
    }
    let base = base.trim_matches('_').chars().take(48).collect::<String>();
    let base = if base.is_empty() { "custom_template".to_string() } else { base };
    let existing = list_template_ids();
    if !existing.contains(&base) {
        return base;
    }
    (2..).map(|n| format!("{}_{}", base, n)).find(|id| !existing.contains(id)).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_reads_reject_paths() {
        for id in ["../config", "/tmp/template", "..\\config", "", "a/b"] {
            assert!(get_template(id).is_err());
            assert!(!is_custom_template(id));
            assert!(!has_original_template(id));
        }
    }

    #[test]
    fn test_get_builtin_template() {
        let template = get_template("daily_standup");
        assert!(template.is_ok());

        let template = template.unwrap();
        assert_eq!(template.name, "Daily Standup");
        assert!(!template.sections.is_empty());
    }

    #[test]
    fn test_get_nonexistent_template() {
        let result = get_template("nonexistent_template");
        assert!(result.is_err());
    }

    #[test]
    fn test_list_template_ids() {
        let ids = list_template_ids();
        assert!(ids.contains(&"daily_standup".to_string()));
        assert!(ids.contains(&"standard_meeting".to_string()));
    }

    #[test]
    fn test_validate_invalid_json() {
        let result = validate_and_parse_template("invalid json");
        assert!(result.is_err());
    }
}
