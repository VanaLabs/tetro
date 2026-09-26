//! Marked moments: points in a recording the user flagged as important. They are shown in
//! the transcript and the notes model is told to cover each one.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

/// Transcript captured around each mark: this much before and after.
pub const BEFORE_SECONDS: f64 = 30.0;
pub const AFTER_SECONDS: f64 = 20.0;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mark {
    pub at_seconds: f64,
}

pub async fn marks_for(pool: &SqlitePool, meeting_id: &str) -> Vec<f64> {
    sqlx::query_scalar::<_, f64>("SELECT at_seconds FROM meeting_marks WHERE meeting_id = ? ORDER BY at_seconds")
        .bind(meeting_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
}

fn clock(s: f64) -> String {
    let s = s.max(0.0) as u64;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

/// Builds the notes instruction for the marked moments, from lines overlapping each window.
pub fn highlights_prompt(marks: &[f64], lines: &[(f64, f64, String)]) -> String {
    let mut sections = Vec::new();
    for &at in marks {
        let (from, to) = (at - BEFORE_SECONDS, at + AFTER_SECONDS);
        let excerpt: Vec<&str> = lines.iter()
            .filter(|(start, end, _)| *end >= from && *start <= to)
            .map(|(_, _, text)| text.trim())
            .filter(|t| !t.is_empty())
            .collect();
        if !excerpt.is_empty() {
            sections.push(format!("[{}] {}", clock(at), excerpt.join(" ")));
        }
    }
    if sections.is_empty() {
        return String::new();
    }
    format!(
        "During the meeting the user marked these moments as important. The notes MUST cover every one of them. \
Put each in the section where it fits best; if none fits, add a final section titled \"Highlights\" with one bullet per moment.\n{}",
        sections.join("\n")
    )
}

/// Highlights instruction for a saved meeting, or empty when it has no marks.
pub async fn highlights_for(pool: &SqlitePool, meeting_id: &str) -> String {
    let marks = marks_for(pool, meeting_id).await;
    if marks.is_empty() {
        return String::new();
    }
    let lines = sqlx::query_as::<_, (Option<f64>, Option<f64>, String)>(
        "SELECT audio_start_time, audio_end_time, transcript FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(s, e, t)| s.map(|s| (s, e.unwrap_or(s), t)))
    .collect::<Vec<_>>();
    highlights_prompt(&marks, &lines)
}

#[tauri::command]
pub async fn api_get_meeting_marks<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Vec<Mark>, String> {
    Ok(marks_for(state.db_manager.pool(), &meeting_id).await.into_iter().map(|at_seconds| Mark { at_seconds }).collect())
}

/// Adds marks to a meeting (used when a recording is saved).
#[tauri::command]
pub async fn api_add_meeting_marks<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    marks: Vec<Mark>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    for mark in marks {
        sqlx::query("INSERT INTO meeting_marks (id, meeting_id, at_seconds, created_at) VALUES (?, ?, ?, ?)")
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&meeting_id)
            .bind(mark.at_seconds.max(0.0))
            .bind(&now)
            .execute(state.db_manager.pool())
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn api_delete_meeting_mark<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    at_seconds: f64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM meeting_marks WHERE meeting_id = ? AND abs(at_seconds - ?) < 0.5")
        .bind(&meeting_id)
        .bind(at_seconds)
        .execute(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_lines_around_each_mark() {
        let lines = vec![
            (0.0, 10.0, "too early".to_string()),
            (95.0, 105.0, "we agreed the price".to_string()),
            (118.0, 125.0, "is final".to_string()),
            (200.0, 210.0, "unrelated".to_string()),
        ];
        let p = highlights_prompt(&[120.0], &lines);
        assert!(p.contains("[02:00] we agreed the price is final"));
        assert!(!p.contains("too early") && !p.contains("unrelated"));
        assert!(p.contains("Highlights"));
        assert_eq!(highlights_prompt(&[], &lines), "");
    }
}
