//! Beta: speaker labels. The notes model reads the transcript in windows and says who is
//! speaking each line: names mentioned in the conversation, otherwise "Speaker 1", "Speaker 2".
//! A hint from the person steers it; renaming a speaker renames every line.

use crate::state::AppState;
use crate::summary::notes_model::{json_object, NotesModel};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const WINDOW: usize = 60;

const SYSTEM: &str = r#"You label who is speaking in a meeting transcript.
Lines are numbered. Reply with one JSON object and nothing else: {"12": "Name", "13": "Name", ...} covering every line number you were given.
Rules:
- Use a person's real name only when the conversation makes it clear (they are addressed by name, introduce themselves, or someone says "thanks, Ana").
- Otherwise use "Speaker 1", "Speaker 2" and so on, consistently.
- Reuse the labels already in use when it is the same person.
- A speaker usually keeps talking for several lines; change the label only where the speaker changes.
- Follow the person's hint about who is who."#;

fn parse(reply: &str, first: usize, count: usize) -> HashMap<usize, String> {
    let Some(json) = json_object(reply) else { return HashMap::new() };
    let Ok(map) = serde_json::from_str::<HashMap<String, serde_json::Value>>(json) else { return HashMap::new() };
    map.into_iter()
        .filter_map(|(k, v)| Some((k.trim().parse::<usize>().ok()?, v.as_str()?.trim().to_string())))
        .filter(|(i, name)| *i >= first && *i < first + count && !name.is_empty() && name.chars().count() <= 40)
        .collect()
}

/// Labels every line of a meeting. Emits `speaker-progress` {done, total}. Returns how many lines got a label.
#[tauri::command]
pub async fn api_identify_speakers<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    hint: Option<String>,
) -> Result<usize, String> {
    let pool = state.db_manager.pool().clone();
    let model = NotesModel::load(&pool).await?;
    let lines = sqlx::query_as::<_, (String, String)>(
        "SELECT id, transcript FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time, timestamp",
    ).bind(&meeting_id).fetch_all(&pool).await.map_err(|e| e.to_string())?;
    if lines.is_empty() { return Ok(0); }
    let app_data_dir = app.path().app_data_dir().ok();
    let hint = hint.map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    let mut labels: Vec<Option<String>> = vec![None; lines.len()];
    let mut known: Vec<String> = Vec::new();

    for start in (0..lines.len()).step_by(WINDOW) {
        let end = (start + WINDOW).min(lines.len());
        let mut prompt = String::new();
        if let Some(h) = &hint { prompt.push_str(&format!("The person's hint about who is who: {}\n", h)); }
        if !known.is_empty() { prompt.push_str(&format!("Labels already in use: {}\n", known.join(", "))); }
        if start > 0 {
            if let Some(prev) = labels[start - 1].as_ref() { prompt.push_str(&format!("The line before this part was spoken by {}.\n", prev)); }
        }
        prompt.push_str("\nTranscript:\n");
        for (i, (_, text)) in lines[start..end].iter().enumerate() {
            prompt.push_str(&format!("{}: {}\n", start + i, text.trim()));
        }
        let reply = model.complete(app_data_dir.as_ref(), SYSTEM, &prompt, 1500).await
            .map_err(|e| format!("The model couldn't label speakers: {}", e))?;
        for (i, name) in parse(&reply, start, end - start) {
            if !known.contains(&name) { known.push(name.clone()); }
            labels[i] = Some(name);
        }
        // Lines the model skipped inherit the previous speaker.
        for i in start..end {
            if labels[i].is_none() && i > 0 { labels[i] = labels[i - 1].clone(); }
        }
        let _ = app.emit("speaker-progress", serde_json::json!({ "meetingId": meeting_id, "done": end, "total": lines.len() }));
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut labelled = 0;
    for ((id, _), label) in lines.iter().zip(labels.iter()) {
        sqlx::query("UPDATE transcripts SET speaker = ? WHERE id = ? AND meeting_id = ?")
            .bind(label).bind(id).bind(&meeting_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        if label.is_some() { labelled += 1; }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(labelled)
}

/// Renames a speaker on every line of a meeting.
#[tauri::command]
pub async fn api_rename_speaker<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    from: String,
    to: String,
) -> Result<u64, String> {
    let to = to.trim();
    if to.is_empty() { return Err("A speaker needs a name.".into()); }
    sqlx::query("UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker = ?")
        .bind(to).bind(&meeting_id).bind(&from).execute(state.db_manager.pool()).await
        .map(|r| r.rows_affected()).map_err(|e| e.to_string())
}

/// Removes all speaker labels from a meeting.
#[tauri::command]
pub async fn api_clear_speakers<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE transcripts SET speaker = NULL WHERE meeting_id = ?")
        .bind(&meeting_id).execute(state.db_manager.pool()).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn keeps_only_lines_in_this_window() {
        let got = parse("```json\n{\"10\": \"Ana\", \"11\": \"Speaker 1\", \"99\": \"Nope\", \"x\": \"Bad\", \"12\": \"\"}\n```", 10, 3);
        assert_eq!(got.len(), 2);
        assert_eq!(got[&10], "Ana");
    }
}
