//! Preserve human edits and recoverable versions. Audio-relative marks are never
//! deleted or moved by text regeneration or restoration.
use crate::{api::TranscriptSegment, state::AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use tauri::{AppHandle, Runtime};

pub static EDIT_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn snapshot(tx: &mut Transaction<'_, Sqlite>, meeting: &str, kind: &str, label: &str) -> Result<String, sqlx::Error> {
    let transcripts: String = sqlx::query_scalar("SELECT json_group_array(json_object('id',id,'text',transcript,'timestamp',timestamp,'audio_start_time',audio_start_time,'audio_end_time',audio_end_time,'duration',duration,'speaker',speaker,'summary',summary,'action_items',action_items,'key_points',key_points)) FROM (SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time, rowid)")
        .bind(meeting).fetch_one(&mut **tx).await?;
    let summary: Option<String> = sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id = ?").bind(meeting).fetch_optional(&mut **tx).await?.flatten();
    let edits: String = sqlx::query_scalar("SELECT json_group_array(json_object('kind',kind,'anchor',anchor,'original_text',original_text,'replacement_text',replacement_text,'needs_review',needs_review)) FROM meeting_edits WHERE meeting_id = ?")
        .bind(meeting).fetch_one(&mut **tx).await?;
    let payload = json!({ "transcripts": serde_json::from_str::<Value>(&transcripts).unwrap_or(json!([])), "summary": summary, "edits": serde_json::from_str::<Value>(&edits).unwrap_or(json!([])) });
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO meeting_versions(id,meeting_id,kind,label,created_at,payload) VALUES(?,?,?,?,?,?)")
        .bind(&id).bind(meeting).bind(kind).bind(label).bind(chrono::Utc::now().to_rfc3339()).bind(payload.to_string()).execute(&mut **tx).await?;
    Ok(id)
}

pub async fn save_version(pool: &SqlitePool, meeting: &str, kind: &str, label: &str) -> Result<(), sqlx::Error> {
    let _guard = EDIT_GATE.lock().await;
    let mut tx = pool.begin().await?;
    snapshot(&mut tx, meeting, kind, label).await?;
    tx.commit().await
}

#[derive(Serialize, Deserialize, sqlx::FromRow, Debug, Clone)]
pub struct SavedEdit { pub kind: String, pub anchor: String, pub original_text: String, pub replacement_text: String, pub needs_review: bool }

#[tauri::command]
pub async fn api_get_meeting_edits(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<Vec<SavedEdit>, String> {
    sqlx::query_as("SELECT kind,anchor,original_text,replacement_text,needs_review FROM meeting_edits WHERE meeting_id = ?")
        .bind(meeting_id).fetch_all(state.db_manager.pool()).await.map_err(|e| e.to_string())
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Version { id: String, kind: String, label: String, created_at: String }
#[tauri::command]
pub async fn api_get_meeting_versions(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<Vec<Version>, String> {
    sqlx::query_as("SELECT id,kind,label,created_at FROM meeting_versions WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 100")
        .bind(meeting_id).fetch_all(state.db_manager.pool()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_preview_meeting_version(state: tauri::State<'_, AppState>, meeting_id: String, version_id: String, kind: String) -> Result<String, String> {
    let payload: String = sqlx::query_scalar("SELECT payload FROM meeting_versions WHERE meeting_id=? AND id=?")
        .bind(meeting_id).bind(version_id).fetch_one(state.db_manager.pool()).await.map_err(|e|e.to_string())?;
    let value: Value = serde_json::from_str(&payload).map_err(|e|e.to_string())?;
    if kind == "transcript" {
        return Ok(value["transcripts"].as_array().map(|lines| lines.iter().filter_map(|l| l["text"].as_str()).collect::<Vec<_>>().join("\n\n")).unwrap_or_default());
    }
    let summary: Value = serde_json::from_str(value["summary"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
    Ok(summary["markdown"].as_str().unwrap_or("No notes in this version.").to_string())
}

pub async fn remember_line(tx: &mut Transaction<'_, Sqlite>, meeting: &str, id: &str, original: &str, replacement: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO meeting_edits(meeting_id,kind,anchor,original_text,replacement_text) VALUES(?,'transcript',?,?,?) ON CONFLICT(meeting_id,kind,anchor) DO UPDATE SET replacement_text=excluded.replacement_text, needs_review=0")
        .bind(meeting).bind(id).bind(original).bind(replacement).execute(&mut **tx).await?;
    Ok(())
}

// Sections give manual edits a stable home even when generated paragraphs change.
// Duplicate headings receive their own occurrence key.
pub fn section_title(line: &str) -> Option<&str> {
    let line = line.trim();
    if line.starts_with('#') && line.trim_start_matches('#').starts_with(' ') {
        return Some(line.trim_start_matches('#').trim().trim_matches('*').trim());
    }
    // Templates also use bold labels. BlockNote joins a following paragraph to
    // the label, so accept both "**Summary**\nText" and "**Summary** Text".
    for marker in ["**", "__"] {
        if let Some(rest) = line.strip_prefix(marker) {
            if let Some((title, tail)) = rest.split_once(marker) {
                if !title.is_empty() && title.len() <= 120 && (tail.is_empty() || tail.starts_with(' ')) && !tail.trim_start().starts_with('|') {
                    return Some(title.trim());
                }
            }
        }
    }
    None
}

// Ignore serializer-only changes (list indentation, table alignment and blank
// lines), while retaining the words, numbers and punctuation a person changed.
fn comparable_section(text: &str) -> String {
    text.lines().filter_map(|line| {
        let line = line.trim();
        if line.starts_with('|') && line.chars().all(|c| matches!(c, '|' | '-' | ':' | ' ')) { return None; }
        let line = line.trim_start_matches('#').trim();
        let line = line.strip_prefix("* ").or_else(|| line.strip_prefix("- ")).unwrap_or(line).trim();
        Some(line.replace("**", "").replace("__", "").replace('|', " "))
    }).collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn sections(markdown: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen = std::collections::HashMap::<String, usize>::new();
    let mut fence: Option<&str> = None;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") { Some("```") } else if trimmed.starts_with("~~~") { Some("~~~") } else { None };
        let in_code = fence.is_some();
        if marker.is_some() && (fence.is_none() || marker == fence) { fence = if fence.is_some() { None } else { marker }; }
        if let Some(title) = (!in_code && marker.is_none()).then(|| section_title(trimmed)).flatten() {
            let title = title.to_lowercase();
            let count = seen.entry(title.clone()).or_default(); *count += 1;
            out.push((format!("{}:{}", title, count), String::new()));
        }
        if out.is_empty() { out.push(("__intro:1".into(), String::new())); }
        let body = &mut out.last_mut().unwrap().1;
        body.push_str(line); body.push('\n');
    }
    for (_, text) in &mut out { *text = text.trim().to_string(); }
    out
}

pub async fn remember_summary(tx: &mut Transaction<'_, Sqlite>, meeting: &str, before: &str, after: &str) -> Result<(), sqlx::Error> {
    let old = sections(before);
    let new = sections(after);
    for (key, text) in &new {
        let original = old.iter().find(|(k,_)| k == key).map(|(_,t)| t.as_str()).unwrap_or("");
        if comparable_section(original) != comparable_section(text) {
            sqlx::query("INSERT INTO meeting_edits(meeting_id,kind,anchor,original_text,replacement_text) VALUES(?,'summary',?,?,?) ON CONFLICT(meeting_id,kind,anchor) DO UPDATE SET replacement_text=excluded.replacement_text")
                .bind(meeting).bind(key).bind(original).bind(text).execute(&mut **tx).await?;
        }
    }
    for (key, text) in old.iter().filter(|(k,_)| !new.iter().any(|(n,_)| n == k)) {
        sqlx::query("INSERT INTO meeting_edits(meeting_id,kind,anchor,original_text,replacement_text) VALUES(?,'summary',?,?,'') ON CONFLICT(meeting_id,kind,anchor) DO UPDATE SET replacement_text=''")
            .bind(meeting).bind(key).bind(text).execute(&mut **tx).await?;
    }
    Ok(())
}

pub fn merge_summary(markdown: &str, edits: &[SavedEdit]) -> String {
    let mut parts = sections(markdown);
    let mut unmatched = Vec::new();
    let mut expanded = Vec::new();
    for edit in edits.iter().filter(|e| e.kind == "summary") {
        // Recover protection written by an older parser that considered bold
        // headings one giant intro. Split it without changing saved history.
        let old = sections(&edit.original_text);
        let new = sections(&edit.replacement_text);
        if edit.anchor == "__intro:1" && new.iter().any(|(key, _)| key != "__intro:1") {
            for (key, text) in &new {
                let original = old.iter().find(|(k,_)| k == key).map(|(_,v)|v.as_str()).unwrap_or("");
                if comparable_section(original) != comparable_section(text) {
                    expanded.push(SavedEdit { anchor: key.clone(), original_text: original.into(), replacement_text: text.clone(), ..edit.clone() });
                }
            }
            for (key, text) in old.iter().filter(|(key,_)| !new.iter().any(|(k,_)| k == key)) {
                expanded.push(SavedEdit { anchor: key.clone(), original_text: text.clone(), replacement_text: String::new(), ..edit.clone() });
            }
        } else { expanded.push(edit.clone()); }
    }
    for edit in &expanded {
        if let Some((_, body)) = parts.iter_mut().find(|(k,_)| k == &edit.anchor) { *body = edit.replacement_text.clone(); }
        else if !edit.replacement_text.is_empty() { unmatched.push(edit.replacement_text.clone()); }
    }
    if !unmatched.is_empty() { parts.push(("__kept".into(), format!("## Your edits\n\n{}", unmatched.join("\n\n")))); }
    parts.into_iter().map(|(_,t)| t).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n")
}

pub async fn preserve_summary(pool: &SqlitePool, meeting: &str, markdown: &str) -> Result<String, sqlx::Error> {
    let edits = sqlx::query_as::<_, SavedEdit>("SELECT kind,anchor,original_text,replacement_text,needs_review FROM meeting_edits WHERE meeting_id=? AND kind='summary'")
        .bind(meeting).fetch_all(pool).await?;
    Ok(merge_summary(markdown, &edits))
}

fn rich_text(value: &Value) -> String {
    if let Some(text) = value.as_str() { return text.into(); }
    if let Some(items) = value.as_array() { return items.iter().map(rich_text).collect::<Vec<_>>().join(""); }
    if let Some(text) = value.get("text").and_then(Value::as_str) { return text.into(); }
    value.get("content").map(rich_text).unwrap_or_default()
}
fn markdown_of(value: &Value) -> String {
    if let Some(markdown) = value.get("markdown").and_then(Value::as_str) { return markdown.into(); }
    if let Some(blocks) = value.get("summary_json").and_then(Value::as_array) {
        return blocks.iter().map(|block| {
            let text = rich_text(block);
            if block["type"] == "heading" { format!("{} {}", "#".repeat(block["props"]["level"].as_u64().unwrap_or(2).clamp(1,6) as usize), text) }
            else if block["type"] == "bulletListItem" { format!("- {}",text) } else { text }
        }).collect::<Vec<_>>().join("\n\n");
    }
    // Older saved summaries use named sections with text blocks.
    let Some(object) = value.as_object() else { return String::new() };
    let keys: Vec<String> = value.get("_section_order").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect()).unwrap_or_else(|| object.keys().cloned().collect());
    keys.iter().filter_map(|key| {
        let section = &value[key];
        let blocks = section.get("blocks")?.as_array()?;
        Some(format!("## {}\n\n{}", section.get("title").and_then(Value::as_str).unwrap_or(key), blocks.iter().map(rich_text).collect::<Vec<_>>().join("\n\n")))
    }).collect::<Vec<_>>().join("\n\n")
}

pub async fn save_manual_summary(pool: &SqlitePool, meeting: &str, summary: &Value) -> Result<bool, sqlx::Error> {
    let _guard = EDIT_GATE.lock().await;
    let mut tx = pool.begin().await?;
    let previous: Option<String> = sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id=?").bind(meeting).fetch_optional(&mut *tx).await?.flatten();
    let Some(previous) = previous else { return Ok(false) };
    snapshot(&mut tx, meeting, "summary", "Before editing notes").await?;
    let old: Value = serde_json::from_str(&previous).unwrap_or(json!({}));
    // The editor supplies both markdown and rich blocks. Refuse an ambiguous save
    // rather than silently lose protection for manually edited text.
    let after = markdown_of(summary);
    if after.trim().is_empty() { return Err(sqlx::Error::Protocol("Could not read the edited notes. Please try saving again.".into())); }
    let mut summary = summary.clone(); summary["markdown"] = json!(after);
    remember_summary(&mut tx, meeting, &markdown_of(&old), &after).await?;
    sqlx::query("UPDATE summary_processes SET result=?,result_backup=CASE WHEN LOWER(status)='pending' THEN ? ELSE result_backup END,updated_at=? WHERE meeting_id=?")
        .bind(summary.to_string()).bind(summary.to_string()).bind(chrono::Utc::now().to_rfc3339()).bind(meeting).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

// Small decoder differences (e.g. planned/plan) must not duplicate a whole
// manually edited line. Only use this for one near-identical, same-time segment.
fn nearly_same_words(a: &str, b: &str) -> bool {
    let words = |text: &str| text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect::<Vec<_>>();
    let a = words(a); let b = words(b);
    a.len() >= 8 && a.len() == b.len() && a.iter().zip(&b).filter(|(a,b)| a != b).count() * 20 <= a.len()
}

/// Keep an exact correction inside the new segment when it can be located.
/// Otherwise retain the original corrected line alongside the new text for review.
pub async fn preserve_transcript(tx: &mut Transaction<'_, Sqlite>, meeting: &str, segments: &mut Vec<TranscriptSegment>) -> Result<(), sqlx::Error> {
    let rows = sqlx::query("SELECT t.*,e.original_text,e.replacement_text FROM transcripts t JOIN meeting_edits e ON e.meeting_id=t.meeting_id AND e.anchor=t.id AND e.kind='transcript' WHERE t.meeting_id=? ORDER BY t.audio_start_time")
        .bind(meeting).fetch_all(&mut **tx).await?;
    for row in rows {
        let id: String = row.get("id");
        let original: String = row.get("original_text");
        let corrected: String = row.get("replacement_text");
        let start: Option<f64> = row.get("audio_start_time");
        let end: Option<f64> = row.get("audio_end_time");
        let exact = segments.iter().position(|s| start.is_some() && s.audio_start_time.unwrap_or(0.) <= end.unwrap_or(start.unwrap_or(0.)) + 1. && s.audio_end_time.unwrap_or(f64::MAX) >= start.unwrap_or(0.) - 1. && ((!original.is_empty() && s.text.contains(&original)) || (!corrected.is_empty() && s.text.contains(&corrected))));
        let near = if exact.is_none() {
            let candidates = segments.iter().enumerate().filter(|(_,s)| {
                matches!((start,end,s.audio_start_time,s.audio_end_time), (Some(a),Some(b),Some(c),Some(d)) if (a-c).abs() <= 1. && (b-d).abs() <= 1.)
                    && (nearly_same_words(&s.text,&original) || nearly_same_words(&s.text,&corrected))
            }).map(|(i,_)| i).collect::<Vec<_>>();
            (candidates.len() == 1).then(|| candidates[0])
        } else { None };
        if let Some(index) = exact.or(near) {
            let segment = &mut segments[index];
            let original_segment = if !corrected.is_empty() && segment.text.contains(&corrected) { segment.text.replacen(&corrected, &original, 1) } else { segment.text.clone() };
            if near.is_some() { segment.text = corrected.clone(); }
            else if !original.is_empty() && segment.text.contains(&original) { segment.text = segment.text.replacen(&original, &corrected, 1); }
            // Preserve the oldest pre-edit text, since that is what a future model
            // may transcribe again. The row id changes when segment boundaries do.
            sqlx::query("DELETE FROM meeting_edits WHERE meeting_id=? AND kind='transcript' AND anchor=?")
                .bind(meeting).bind(&id).execute(&mut **tx).await?;
            remember_line(tx, meeting, &segment.id, &original_segment, &segment.text).await?;
        } else {
            segments.push(TranscriptSegment { id: id.clone(), text: corrected, timestamp: row.get("timestamp"), audio_start_time: start, audio_end_time: end, duration: row.get("duration") });
            sqlx::query("UPDATE meeting_edits SET needs_review=1 WHERE meeting_id=? AND kind='transcript' AND anchor=?").bind(meeting).bind(id).execute(&mut **tx).await?;
        }
    }
    segments.sort_by(|a,b| a.audio_start_time.unwrap_or(0.).total_cmp(&b.audio_start_time.unwrap_or(0.)));
    Ok(())
}

pub async fn sync_transcript_file(pool: &SqlitePool, meeting: &str) -> Result<(), String> {
    let folder: Option<String> = sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id=?").bind(meeting).fetch_optional(pool).await.map_err(|e|e.to_string())?.flatten();
    if let Some(folder) = folder {
        let rows = sqlx::query("SELECT id,transcript,timestamp,audio_start_time,audio_end_time,duration FROM transcripts WHERE meeting_id=? ORDER BY audio_start_time,rowid").bind(meeting).fetch_all(pool).await.map_err(|e|e.to_string())?;
        let segments = rows.iter().map(|r| TranscriptSegment { id:r.get("id"),text:r.get("transcript"),timestamp:r.get("timestamp"),audio_start_time:r.get("audio_start_time"),audio_end_time:r.get("audio_end_time"),duration:r.get("duration") }).collect::<Vec<_>>();
        crate::audio::common::write_transcripts_json(std::path::Path::new(&folder), &segments).map_err(|e|e.to_string())?;
    }
    Ok(())
}

/// The database is already committed. A failed companion file is a warning,
/// never a failed edit that invites the person to repeat a completed operation.
pub async fn sync_transcript_with_warning<R: Runtime>(app: &AppHandle<R>, pool: &SqlitePool, meeting: &str) {
    if let Err(error) = sync_transcript_file(pool, meeting).await {
        log::warn!("Transcript companion file: {}", error);
        use tauri::Emitter;
        let _ = app.emit("tetro-file-sync-error", "Your change is saved in Tetro, but the transcript file could not be updated. Check that the recording folder is available.");
    }
}

#[tauri::command]
pub async fn api_restore_meeting_version<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, AppState>, meeting_id: String, version_id: String) -> Result<(), String> {
    let _guard = EDIT_GATE.lock().await;
    let pool = state.db_manager.pool();
    let mut tx = pool.begin().await.map_err(|e|e.to_string())?;
    let row: (String,String) = sqlx::query_as("SELECT kind,payload FROM meeting_versions WHERE meeting_id=? AND id=?").bind(&meeting_id).bind(version_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM summary_processes WHERE meeting_id=? AND LOWER(status)='pending')").bind(&meeting_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    if pending || crate::audio::retranscription::is_retranscription_in_progress() { return Err("Stop the current job before restoring a version.".into()); }
    restore(&mut tx, &meeting_id, &row.0, &row.1).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    crate::meeting_preferences::changed(&app, &meeting_id);
    if row.0 != "summary" { sync_transcript_with_warning(&app, pool, &meeting_id).await; }
    Ok(())
}

pub async fn restore(tx: &mut Transaction<'_, Sqlite>, meeting: &str, kind: &str, payload: &str) -> Result<(), sqlx::Error> {
    snapshot(tx, meeting, kind, "Before restoring a version").await?;
    if kind != "summary" {
        sqlx::query("DELETE FROM transcripts WHERE meeting_id=?").bind(meeting).execute(&mut **tx).await?;
        sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp,audio_start_time,audio_end_time,duration,speaker,summary,action_items,key_points) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.text'),json_extract(value,'$.timestamp'),json_extract(value,'$.audio_start_time'),json_extract(value,'$.audio_end_time'),json_extract(value,'$.duration'),json_extract(value,'$.speaker'),json_extract(value,'$.summary'),json_extract(value,'$.action_items'),json_extract(value,'$.key_points') FROM json_each(?, '$.transcripts')")
            .bind(meeting).bind(payload).execute(&mut **tx).await?;
    }
    if kind != "transcript" {
        sqlx::query("UPDATE summary_processes SET result=json_extract(?,'$.summary'),status='completed',error=NULL,result_backup=NULL,updated_at=? WHERE meeting_id=?")
            .bind(payload).bind(chrono::Utc::now().to_rfc3339()).bind(meeting).execute(&mut **tx).await?;
    }
    for edit_kind in ["transcript", "summary"] {
        if kind != "correction" && kind != edit_kind { continue; }
        sqlx::query("DELETE FROM meeting_edits WHERE meeting_id=? AND kind=?").bind(meeting).bind(edit_kind).execute(&mut **tx).await?;
        sqlx::query("INSERT INTO meeting_edits(meeting_id,kind,anchor,original_text,replacement_text,needs_review) SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.anchor'),json_extract(value,'$.original_text'),json_extract(value,'$.replacement_text'),json_extract(value,'$.needs_review') FROM json_each(?,'$.edits') WHERE json_extract(value,'$.kind')=?")
            .bind(meeting).bind(payload).bind(edit_kind).execute(&mut **tx).await?;
    }
    Ok(())
}

/// Literal, case-sensitive whole-word replacement, including Armenian and other
/// scripts. Never changes a substring inside an unrelated word.
pub fn replace_term(text: &str, from: &str, to: &str) -> (String, usize) {
    static WORD: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"[\p{L}\p{N}\p{M}]").unwrap());
    let word = |c: Option<char>| c.is_some_and(|c| WORD.is_match(&c.to_string()));
    let mut out = String::new(); let mut cursor = 0; let mut count = 0;
    if from.is_empty() { return (text.into(), 0); }
    for (start, _) in text.match_indices(from) {
        let end = start + from.len();
        if word(text[..start].chars().next_back()) || word(text[end..].chars().next()) { continue; }
        out.push_str(&text[cursor..start]); out.push_str(to); cursor = end; count += 1;
    }
    out.push_str(&text[cursor..]); (out, count)
}

fn replace_rich_text(value: &mut Value, from: &str, to: &str) {
    match value {
        Value::Array(items) => for item in items { replace_rich_text(item, from, to); },
        Value::Object(object) => for (key, item) in object {
            if matches!(key.as_str(), "text" | "content") && item.is_string() {
                *item = Value::String(replace_term(item.as_str().unwrap(), from, to).0);
            } else if matches!(key.as_str(), "content" | "children" | "blocks") { replace_rich_text(item, from, to); }
        },
        _ => {},
    }
}

#[derive(Serialize)]
pub struct CorrectionResult { pub count: usize, pub version_id: Option<String> }

#[tauri::command]
pub async fn api_correct_meeting_term<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, AppState>, meeting_id: String, from: String, to: String) -> Result<CorrectionResult, String> {
    if from.trim().is_empty() || to.trim().is_empty() || from.len()>160 || to.len()>160 { return Err("Choose a name or short phrase to correct.".into()); }
    let _guard = EDIT_GATE.lock().await;
    let pool = state.db_manager.pool();
    let mut tx = pool.begin().await.map_err(|e|e.to_string())?;
    let version = snapshot(&mut tx, &meeting_id, "correction", &format!("Before changing {} to {}", from, to)).await.map_err(|e|e.to_string())?;
    let rows: Vec<(String,String)> = sqlx::query_as("SELECT id,transcript FROM transcripts WHERE meeting_id=?").bind(&meeting_id).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let mut count = 0;
    for (id, original) in rows {
        let (text,n) = replace_term(&original, &from, &to); if n == 0 { continue; } count += n;
        remember_line(&mut tx, &meeting_id, &id, &original, &text).await.map_err(|e|e.to_string())?;
        sqlx::query("UPDATE transcripts SET transcript=? WHERE id=? AND meeting_id=?").bind(text).bind(id).bind(&meeting_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    let raw: Option<String> = sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id=?").bind(&meeting_id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?.flatten();
    if let Some(raw) = raw {
        let mut summary: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let original = markdown_of(&summary);
        let (markdown,n) = replace_term(&original, &from, &to);
        if n > 0 {
            count += n;
            remember_summary(&mut tx, &meeting_id, &original, &markdown).await.map_err(|e|e.to_string())?;
            summary["markdown"] = json!(markdown);
            if let Some(blocks) = summary.get_mut("summary_json") { replace_rich_text(blocks, &from, &to); }
            if let Some(object) = summary.as_object_mut() { object.remove("english_cache"); }
            sqlx::query("UPDATE summary_processes SET result=?,result_backup=CASE WHEN LOWER(status)='pending' THEN ? ELSE result_backup END WHERE meeting_id=?")
                .bind(summary.to_string()).bind(summary.to_string()).bind(&meeting_id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
    }
    if count == 0 { return Ok(CorrectionResult { count, version_id: None }); }
    tx.commit().await.map_err(|e|e.to_string())?;
    crate::meeting_preferences::changed(&app, &meeting_id);
    if let Err(error) = sync_transcript_file(pool, &meeting_id).await { log::warn!("Corrected transcript file: {}", error); }
    Ok(CorrectionResult { count, version_id: Some(version) })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20250916100000_initial_schema.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql("ALTER TABLE meetings ADD COLUMN folder_path TEXT; ALTER TABLE transcripts ADD COLUMN audio_start_time REAL; ALTER TABLE transcripts ADD COLUMN audio_end_time REAL; ALTER TABLE transcripts ADD COLUMN duration REAL; ALTER TABLE transcripts ADD COLUMN speaker TEXT; ALTER TABLE summary_processes ADD COLUMN result_backup TEXT;").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260925091000_preserve_edits.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260923120000_add_meeting_marks.sql")).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at) VALUES('m','Test','2026-09-25T00:00:00Z','2026-09-25T00:00:00Z')").execute(&pool).await.unwrap();
        pool
    }
    fn edit(anchor: &str, replacement: &str) -> SavedEdit { SavedEdit { kind: "summary".into(), anchor: anchor.into(), original_text: "old".into(), replacement_text: replacement.into(), needs_review: false } }

    #[test]
    fn keeps_changed_sections_and_unmatched_edits_without_losing_new_sections() {
        let merged = merge_summary("# New title\n\n## Decisions\nNew wording\n\n## Tasks\nNew task", &[edit("decisions:1", "## Decisions\nMy correction"), edit("attendees:1", "## Attendees\nArman")]);
        assert!(merged.contains("My correction")); assert!(!merged.contains("New wording"));
        assert!(merged.contains("New task")); assert!(merged.contains("## Your edits\n\n## Attendees\nArman"));
        let removed = merge_summary("## Empty\nNone\n\n## Tasks\nShip", &[edit("empty:1", "")]);
        assert_eq!(removed, "## Tasks\nShip");
    }

    #[tokio::test]
    async fn tiny_decoder_changes_do_not_duplicate_a_manually_edited_line() {
        let pool = pool().await;
        let mut tx = pool.begin().await.unwrap();
        let original = "Today we planned the community garden opening. Norah will order seeds by Friday and Daniel will send the budget tomorrow.";
        let corrected = original.replace("Norah", "Nora");
        sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp,audio_start_time,audio_end_time) VALUES('a','m',?,'',0,22)").bind(&corrected).execute(&mut *tx).await.unwrap();
        remember_line(&mut tx,"m","a",original,&corrected).await.unwrap();
        let mut segments = vec![TranscriptSegment { id:"new".into(), text:original.replace("planned", "plan"), timestamp:"".into(), audio_start_time:Some(0.),audio_end_time:Some(22.),duration:Some(22.) }];
        preserve_transcript(&mut tx,"m",&mut segments).await.unwrap();
        assert_eq!(segments.len(),1);
        assert_eq!(segments[0].text,corrected);
        assert!(!nearly_same_words(original,"A different discussion about a completely unrelated topic with different decisions"));
    }

    #[tokio::test]
    async fn bold_template_headings_survive_editor_serialization_without_duplicating_notes() {
        let before = "**Summary**\nGarden opening.\n\n**Key Decisions**\n*   Open Saturday.\n\n**Action Items**\n| Owner | Task |\n| --- | --- |\n| Nora | Seeds |";
        let after = "**Summary** Garden opening.\n\n**Key Decisions**\n\n* Open Saturday. Arrival: 9 AM.\n\n**Action Items**\n| **Owner** | Task |\n| -------- | ---- |\n| Nora | Seeds |";
        let pool = pool().await;
        let mut tx = pool.begin().await.unwrap();
        remember_summary(&mut tx, "m", before, after).await.unwrap(); tx.commit().await.unwrap();
        let edits = sqlx::query_as::<_, SavedEdit>("SELECT kind,anchor,original_text,replacement_text,needs_review FROM meeting_edits").fetch_all(&pool).await.unwrap();
        assert_eq!(edits.len(), 1); assert_eq!(edits[0].anchor, "key decisions:1");
        let fresh = "# Garden\n\n## Summary\nFresh summary.\n\n## Key Decisions\nOpen Saturday.\n\n## Action Items\nFresh tasks.";
        let merged = merge_summary(fresh, &edits);
        assert!(merged.contains("Arrival: 9 AM.")); assert!(merged.contains("Fresh summary.")); assert!(merged.contains("Fresh tasks.")); assert!(!merged.contains("Your edits"));
        let legacy = SavedEdit { original_text: before.into(), ..edit("__intro:1", after) };
        assert_eq!(merge_summary(fresh, &[legacy]), merged);
        assert_eq!(sections("## Code\n```\n**not a title**\n```" ).len(), 1);
    }

    #[test]
    fn corrections_match_exact_words_across_scripts() {
        assert_eq!(replace_term("Jonh, Jonhson and Jonh", "Jonh", "John"), ("John, Jonhson and John".into(), 2));
        assert_eq!(replace_term("Արամ, Արամը", "Արամ", "Արման"), ("Արման, Արամը".into(), 1));
        assert_eq!(replace_term("Acme Labs / Acme Labs2", "Acme Labs", "Vana Labs"), ("Vana Labs / Acme Labs2".into(), 1));
    }

    #[tokio::test]
    async fn two_corrected_lines_can_merge_into_one_new_segment() {
        let pool = pool().await; let mut tx = pool.begin().await.unwrap();
        for (id,before,after,start) in [("a","Jonh called.","John called.",0.),("b","Acmee replied.","Acme replied.",1.)] {
            sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp,audio_start_time,audio_end_time) VALUES(?,'m',?,'',?,?)").bind(id).bind(after).bind(start).bind(start+1.).execute(&mut *tx).await.unwrap();
            remember_line(&mut tx,"m",id,before,after).await.unwrap();
        }
        let mut segments = vec![TranscriptSegment { id:"new".into(),text:"Jonh called. Acmee replied.".into(),timestamp:"".into(),audio_start_time:Some(0.),audio_end_time:Some(2.),duration:Some(2.) }];
        preserve_transcript(&mut tx,"m",&mut segments).await.unwrap();
        assert_eq!(segments.len(),1); assert_eq!(segments[0].text,"John called. Acme replied.");
        let edits: Vec<(String,String)> = sqlx::query_as("SELECT original_text,replacement_text FROM meeting_edits").fetch_all(&mut *tx).await.unwrap();
        assert_eq!(edits, vec![("Jonh called. Acmee replied.".into(),"John called. Acme replied.".into())]);
    }

    #[tokio::test]
    async fn unmatched_corrections_remain_and_restoration_keeps_marks() {
        let pool = pool().await; let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp,audio_start_time,audio_end_time,speaker) VALUES('a','m','John called.','',2,3,'John')").execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO meeting_marks VALUES('mark','m',2.5,'')").execute(&mut *tx).await.unwrap();
        remember_line(&mut tx,"m","a","Jonh called.","John called.").await.unwrap();
        let id = snapshot(&mut tx,"m","transcript","Before retry").await.unwrap();
        let mut segments = vec![TranscriptSegment { id:"new".into(),text:"A completely different transcription".into(),timestamp:"".into(),audio_start_time:Some(2.),audio_end_time:Some(3.),duration:Some(1.) }];
        preserve_transcript(&mut tx,"m",&mut segments).await.unwrap();
        assert_eq!(segments.len(),2); assert!(segments.iter().any(|s|s.text=="John called."));
        assert!(sqlx::query_scalar::<_,bool>("SELECT needs_review FROM meeting_edits").fetch_one(&mut *tx).await.unwrap());
        sqlx::query("UPDATE transcripts SET transcript='new generated text'").execute(&mut *tx).await.unwrap();
        let payload: String = sqlx::query_scalar("SELECT payload FROM meeting_versions WHERE id=?").bind(id).fetch_one(&mut *tx).await.unwrap();
        restore(&mut tx,"m","transcript",&payload).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT transcript FROM transcripts").fetch_one(&mut *tx).await.unwrap(),"John called.");
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT speaker FROM transcripts").fetch_one(&mut *tx).await.unwrap(),"John");
        assert_eq!(sqlx::query_scalar::<_,f64>("SELECT at_seconds FROM meeting_marks").fetch_one(&mut *tx).await.unwrap(),2.5);
        assert!(!sqlx::query_scalar::<_,bool>("SELECT needs_review FROM meeting_edits").fetch_one(&mut *tx).await.unwrap());
    }
}
