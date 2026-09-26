//! Disk usage summary for Settings → Storage.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct FolderUsage {
    pub path: String,
    pub bytes: u64,
    /// Direct sub-folders (for recordings: one per meeting).
    pub items: u64,
}

#[derive(Debug, Serialize)]
pub struct StorageSummary {
    pub recordings: FolderUsage,
    pub models: FolderUsage,
    pub database_bytes: u64,
    pub meetings: u64,
    pub summaries: u64,
}

#[derive(Debug, Serialize)]
pub struct RecordingFolder {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub modified: Option<String>,
    /// Title of the meeting that uses this folder, if it still exists.
    pub meeting_title: Option<String>,
}

fn size_of(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    std::fs::read_dir(path)
        .map(|entries| entries.flatten().map(|e| size_of(&e.path())).sum())
        .unwrap_or(0)
}

fn usage(path: PathBuf) -> FolderUsage {
    let items = std::fs::read_dir(&path)
        .map(|e| e.flatten().filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.')).count() as u64)
        .unwrap_or(0);
    FolderUsage { bytes: size_of(&path), items, path: path.to_string_lossy().to_string() }
}

#[tauri::command]
pub async fn api_storage_summary(state: tauri::State<'_, crate::state::AppState>) -> Result<StorageSummary, String> {
    let pool = state.db_manager.pool();
    let meetings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meetings").fetch_one(pool).await.unwrap_or(0);
    let summaries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM summary_processes WHERE result IS NOT NULL AND result != ''").fetch_one(pool).await.unwrap_or(0);
    let (meetings, summaries) = (meetings.max(0) as u64, summaries.max(0) as u64);
    tauri::async_runtime::spawn_blocking(move || {
        let data = crate::app_profile::data_dir().ok_or("Could not locate the app data folder")?;
        let database_bytes = ["meeting_minutes.sqlite", "meeting_minutes.sqlite-wal", "meeting_minutes.sqlite-shm"]
            .iter()
            .map(|f| size_of(&data.join(f)))
            .sum();
        Ok(StorageSummary {
            recordings: usage(crate::audio::recording_preferences::get_default_recordings_folder()),
            models: usage(data.join("models")),
            database_bytes,
            meetings,
            summaries,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every folder in the recordings directory with its size, newest first.
#[tauri::command]
pub async fn api_list_recordings(state: tauri::State<'_, crate::state::AppState>) -> Result<Vec<RecordingFolder>, String> {
    let titles: std::collections::HashMap<String, String> = sqlx::query_as::<_, (Option<String>, String)>("SELECT folder_path, title FROM meetings")
        .fetch_all(state.db_manager.pool()).await.map_err(|e| e.to_string())?
        .into_iter().filter_map(|(p, t)| p.map(|p| (p, t))).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::audio::recording_preferences::get_default_recordings_folder();
        let mut list: Vec<RecordingFolder> = std::fs::read_dir(&root).map_err(|e| e.to_string())?
            .flatten()
            .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
            .map(|e| {
                let path = e.path();
                let modified = e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());
                let key = path.to_string_lossy().to_string();
                RecordingFolder { name: e.file_name().to_string_lossy().to_string(), bytes: size_of(&path), modified, meeting_title: titles.get(&key).cloned(), path: key }
            })
            .collect();
        list.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(list)
    }).await.map_err(|e| e.to_string())?
}

/// Deletes one recording folder. Only folders directly inside the recordings directory.
#[tauri::command]
pub async fn api_delete_recording(path: String) -> Result<(), String> {
    let root = crate::audio::recording_preferences::get_default_recordings_folder().canonicalize().map_err(|e| e.to_string())?;
    let target = std::path::PathBuf::from(&path).canonicalize().map_err(|_| "That recording no longer exists.".to_string())?;
    if target.parent() != Some(root.as_path()) || !target.is_dir() {
        return Err("Only recordings inside Tetro's recordings folder can be deleted here.".into());
    }
    std::fs::remove_dir_all(&target).map_err(|e| format!("Could not delete the recording: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_nested_files() {
        let dir = std::env::temp_dir().join(format!("tetro-usage-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("a/one.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("a/b/two.bin"), vec![0u8; 50]).unwrap();
        let u = usage(dir.clone());
        assert_eq!(u.bytes, 150);
        assert_eq!(u.items, 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
