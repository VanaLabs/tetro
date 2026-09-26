//! Playback access to a meeting's own audio file.
//!
//! The webview may only read files the asset protocol allows. Rather than opening whole
//! folders, this looks the meeting up by id and allows exactly its audio file.

use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const AUDIO_EXTENSIONS: &[&str] = &["mp4", "m4a", "wav", "mp3", "flac", "ogg", "webm", "mkv", "wma", "aac"];

/// The meeting's audio file: `audio.<ext>` in its folder, preferring the recorder's `audio.mp4`.
pub fn find_audio_file(folder: &Path) -> Option<PathBuf> {
    let preferred = folder.join("audio.mp4");
    if preferred.is_file() {
        return Some(preferred);
    }
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(folder).ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| p.file_stem().map(|s| s == "audio").unwrap_or(false))
        .filter(|p| p.extension().and_then(|e| e.to_str()).map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str())).unwrap_or(false))
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

/// Returns the absolute path of the meeting's audio (now readable by the webview), or None.
#[tauri::command]
pub async fn api_meeting_audio_path<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<String>, String> {
    let folder: Option<String> = sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id = ? AND deleted_at IS NULL AND audio_trashed=0")
        .bind(&meeting_id)
        .fetch_optional(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())?
        .flatten();
    let Some(folder) = folder else { return Ok(None) };
    let Some(audio) = find_audio_file(Path::new(&folder)) else { return Ok(None) };
    app.asset_protocol_scope()
        .allow_file(&audio)
        .map_err(|e| format!("Could not open the recording for playback: {}", e))?;
    Ok(Some(audio.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_recorder_audio_then_imported_audio() {
        let dir = std::env::temp_dir().join(format!("tetro-media-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("transcripts.json"), "{}").unwrap();
        std::fs::write(dir.join("audio.wav"), "x").unwrap();
        assert_eq!(find_audio_file(&dir), Some(dir.join("audio.wav")));
        std::fs::write(dir.join("audio.mp4"), "x").unwrap();
        assert_eq!(find_audio_file(&dir), Some(dir.join("audio.mp4")));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
