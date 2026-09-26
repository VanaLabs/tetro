//! Library search across meeting titles, notes and transcripts. Matching is Unicode-aware
//! (works for any script), every word must appear somewhere in the meeting, and each
//! meeting is returned once with its best snippet.

use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct LibraryHit {
    pub id: String,
    pub title: String,
    pub created_at: String,
    /// "title", "notes" or "transcript": where the snippet comes from.
    pub source: String,
    pub snippet: String,
    /// Recording time of the transcript line, for jumping straight to it.
    pub audio_time: Option<f64>,
    pub hits: usize,
}

struct Doc { title: String, created_at: String, notes: String, lines: Vec<(Option<f64>, String)> }

fn terms(query: &str) -> Vec<String> {
    query.to_lowercase().split_whitespace().filter(|t| !t.is_empty()).map(str::to_string).collect()
}

/// Up to ~70 characters either side of the first term, cut on characters (never mid-codepoint).
fn snippet(text: &str, term: &str) -> String {
    let lower: Vec<char> = text.to_lowercase().chars().collect();
    let chars: Vec<char> = text.chars().collect();
    let t: Vec<char> = term.chars().collect();
    let at = (0..lower.len().saturating_sub(t.len().saturating_sub(1))).find(|&i| lower[i..].starts_with(&t)).unwrap_or(0);
    // to_lowercase can change length for a few characters; clamp to the original text.
    let at = at.min(chars.len());
    let start = at.saturating_sub(70);
    let end = (at + t.len() + 70).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{}{}{}", if start > 0 { "…" } else { "" }, s, if end < chars.len() { "…" } else { "" })
}

fn count(hay: &str, term: &str) -> usize { hay.matches(term).count() }

pub fn search(docs: &[(String, Doc)], query: &str) -> Vec<LibraryHit> {
    let terms = terms(query);
    if terms.is_empty() { return Vec::new(); }
    let phrase = terms.join(" ");
    let mut hits = Vec::new();
    for (id, d) in docs {
        let title = d.title.to_lowercase();
        let notes = d.notes.to_lowercase();
        let lines: Vec<String> = d.lines.iter().map(|(_, t)| t.to_lowercase()).collect();
        let everything = format!("{}\n{}\n{}", title, notes, lines.join("\n"));
        if !terms.iter().all(|t| everything.contains(t.as_str())) { continue; }
        let total: usize = terms.iter().map(|t| count(&everything, t)).sum();
        // Best place to quote: the whole phrase first, then the first term; title, notes, transcript.
        let needle = if everything.contains(&phrase) { phrase.as_str() } else { terms[0].as_str() };
        let (source, snip, time) = if title.contains(needle) {
            ("title", d.title.clone(), None)
        } else if notes.contains(needle) {
            ("notes", snippet(&d.notes.replace('#', "").replace("**", ""), needle), None)
        } else if let Some(i) = lines.iter().position(|l| l.contains(needle)) {
            ("transcript", snippet(&d.lines[i].1, needle), d.lines[i].0)
        } else {
            ("transcript", d.lines.first().map(|l| l.1.clone()).unwrap_or_default(), None)
        };
        hits.push(LibraryHit { id: id.clone(), title: d.title.clone(), created_at: d.created_at.clone(), source: source.into(), snippet: snip, audio_time: time, hits: total });
    }
    let rank = |s: &str| match s { "title" => 0, "notes" => 1, _ => 2 };
    hits.sort_by(|a, b| rank(&a.source).cmp(&rank(&b.source)).then(b.hits.cmp(&a.hits)).then(b.created_at.cmp(&a.created_at)));
    hits
}

fn notes_markdown(result: &str) -> String {
    serde_json::from_str::<serde_json::Value>(result).ok().and_then(|v|
        v.get("markdown").and_then(|m| m.as_str()).map(str::to_string)
            .or_else(|| v.get("english_cache").and_then(|c| c.get("markdown")).and_then(|m| m.as_str()).map(str::to_string))
    ).unwrap_or_default()
}

#[tauri::command]
pub async fn api_search_library<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<LibraryHit>, String> {
    if query.trim().is_empty() { return Ok(Vec::new()); }
    let pool = state.db_manager.pool();
    let meetings = sqlx::query_as::<_, (String, String, String, Option<String>)>(
        "SELECT m.id, m.title, m.created_at, s.result FROM meetings m LEFT JOIN summary_processes s ON s.meeting_id = m.id WHERE m.deleted_at IS NULL",
    ).fetch_all(pool).await.map_err(|e| e.to_string())?;
    let mut docs: HashMap<String, Doc> = meetings.into_iter().map(|(id, title, created_at, result)| {
        (id, Doc { title, created_at, notes: result.as_deref().map(notes_markdown).unwrap_or_default(), lines: Vec::new() })
    }).collect();
    let lines = sqlx::query_as::<_, (String, Option<f64>, String)>(
        "SELECT meeting_id, audio_start_time, transcript FROM transcripts ORDER BY meeting_id, audio_start_time",
    ).fetch_all(pool).await.map_err(|e| e.to_string())?;
    for (id, t, text) in lines {
        if let Some(d) = docs.get_mut(&id) { d.lines.push((t, text)); }
    }
    let docs: Vec<(String, Doc)> = docs.into_iter().collect();
    let mut hits = search(&docs, &query);
    hits.truncate(50);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(title: &str, notes: &str, lines: &[&str]) -> Doc {
        Doc { title: title.into(), created_at: "2026-09-01".into(), notes: notes.into(), lines: lines.iter().enumerate().map(|(i, l)| (Some(i as f64 * 10.0), l.to_string())).collect() }
    }

    #[test]
    fn one_hit_per_meeting_ranked_title_notes_transcript() {
        let docs = vec![
            ("a".into(), doc("Weekly sync", "", &["we discussed the Budget", "budget again"])),
            ("b".into(), doc("Budget review", "", &[])),
            ("c".into(), doc("Planning", "## Decisions\n- Budget approved", &[])),
        ];
        let hits = search(&docs, "budget");
        assert_eq!(hits.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["b", "c", "a"]);
        assert_eq!(hits[2].source, "transcript");
        assert_eq!(hits[2].audio_time, Some(0.0));
    }

    #[test]
    fn all_words_must_match_and_unicode_is_case_insensitive() {
        let docs = vec![("a".into(), doc("Հանդիպում", "", &["Արամը ներկայացրեց ԲՅՈՒՋԵԻ պլանը"]))];
        assert_eq!(search(&docs, "բյուջեի").len(), 1);
        assert_eq!(search(&docs, "բյուջեի missing").len(), 0);
        assert!(search(&docs, "արամը")[0].snippet.contains("Արամը"));
    }
}
