//! Hand corrections to saved transcripts.

use crate::state::AppState;
use serde::Deserialize;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Deserialize)]
pub struct LineEdit {
    pub id: String,
    pub text: String,
}

/// Replaces the text of the given transcript lines of one meeting, all or nothing.
/// Returns how many lines changed.
#[tauri::command]
pub async fn api_update_transcript_lines<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    edits: Vec<LineEdit>,
) -> Result<u64, String> {
    if edits.is_empty() {
        return Ok(0);
    }
    let _guard = crate::meeting_edits::EDIT_GATE.lock().await;
    let mut tx = state.db_manager.pool().begin().await.map_err(|e| e.to_string())?;
    crate::meeting_edits::snapshot(&mut tx, &meeting_id, "transcript", "Before editing transcript").await.map_err(|e| e.to_string())?;
    let mut changed = 0;
    for edit in &edits {
        let text = edit.text.trim();
        if text.is_empty() {
            return Err("A transcript line can't be empty.".into());
        }
        let original: String = sqlx::query_scalar("SELECT transcript FROM transcripts WHERE id=? AND meeting_id=?")
            .bind(&edit.id).bind(&meeting_id).fetch_one(&mut *tx).await.map_err(|_| "That line changed. Reopen it and try again.".to_string())?;
        crate::meeting_edits::remember_line(&mut tx, &meeting_id, &edit.id, &original, text).await.map_err(|e|e.to_string())?;
        changed += sqlx::query("UPDATE transcripts SET transcript = ? WHERE id = ? AND meeting_id = ?")
            .bind(text)
            .bind(&edit.id)
            .bind(&meeting_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();
    }
    sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&meeting_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    crate::meeting_preferences::changed(&app, &meeting_id);
    if let Err(error) = crate::meeting_edits::sync_transcript_file(state.db_manager.pool(), &meeting_id).await {
        // The database save succeeded. Surface the separately failed file copy.
        use tauri::Emitter;
        let _ = app.emit("tetro-file-sync-error", "Your correction is saved in Tetro, but the transcript file could not be updated. Check that the recording folder is available.");
        log::warn!("Transcript file copy failed: {}", error);
    }
    Ok(changed)
}
