//! "Names & terms": words the user wants spelled exactly. Used as Whisper's hint prompt
//! while transcribing and as a glossary in the notes prompt. Stored as JSON in the profile.

use once_cell::sync::Lazy;
use std::sync::RwLock;

const FILE: &str = "vocabulary.json";
const MAX_TERMS: usize = 200;

static TERMS: Lazy<RwLock<Option<Vec<String>>>> = Lazy::new(|| RwLock::new(None));

fn path() -> Option<std::path::PathBuf> {
    crate::app_profile::data_dir().map(|d| d.join(FILE))
}

/// Trims, drops empties and duplicates (case-insensitive), keeps order.
pub fn clean(terms: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    terms.into_iter()
        .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|t| !t.is_empty() && t.chars().count() <= 60)
        .filter(|t| seen.insert(t.to_lowercase()))
        .take(MAX_TERMS)
        .collect()
}

pub fn terms() -> Vec<String> {
    if let Some(cached) = TERMS.read().ok().and_then(|g| g.clone()) {
        return cached;
    }
    let loaded = path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .map(clean)
        .unwrap_or_default();
    if let Ok(mut g) = TERMS.write() { *g = Some(loaded.clone()); }
    loaded
}

/// Whisper hint prompt. Whisper reads roughly the last 224 tokens, so this stays short.
pub fn whisper_prompt() -> Option<String> {
    let mut prompt = String::new();
    for term in terms() {
        if prompt.len() + term.len() + 2 > 600 { break; }
        if !prompt.is_empty() { prompt.push_str(", "); }
        prompt.push_str(&term);
    }
    (!prompt.is_empty()).then(|| format!("{}.", prompt))
}

/// Line for the notes prompt, or empty.
pub fn notes_glossary() -> String {
    let t = terms();
    if t.is_empty() { String::new() } else {
        format!("Names and terms: spell these exactly as written wherever they appear: {}.", t.join(", "))
    }
}

#[tauri::command]
pub async fn api_get_vocabulary() -> Result<Vec<String>, String> {
    Ok(terms())
}

#[tauri::command]
pub async fn api_set_vocabulary(terms: Vec<String>) -> Result<Vec<String>, String> {
    let cleaned = clean(terms);
    let file = path().ok_or("Could not locate the app data folder")?;
    if let Some(dir) = file.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    std::fs::write(&file, serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if let Ok(mut g) = TERMS.write() { *g = Some(cleaned.clone()); }
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_terms() {
        let t = clean(vec![" Acme  Corp ".into(), "acme corp".into(), "".into(), "Արման".into()]);
        assert_eq!(t, vec!["Acme Corp".to_string(), "Արման".to_string()]);
    }
}
