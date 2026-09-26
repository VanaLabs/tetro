//! Storage paths for the consumer Tetro application.
use std::{path::PathBuf, sync::OnceLock};
use tauri::Manager;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
const IDENTIFIER: &str = "am.vanalabs.tetro";

pub fn initialize(app: &tauri::AppHandle) -> anyhow::Result<()> {
    if app.config().identifier != IDENTIFIER {
        anyhow::bail!("Unexpected Tetro application identifier: {}", app.config().identifier);
    }
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    let _ = DATA_DIR.set(directory.clone());
    log::info!("Tetro profile: {}", directory.display());
    Ok(())
}

pub fn data_dir() -> Option<PathBuf> {
    DATA_DIR.get().cloned().or_else(|| dirs::data_dir().map(|root| root.join(IDENTIFIER)))
}

/// Only expose known profile folders, never arbitrary filesystem destinations.
#[tauri::command]
pub fn open_tetro_folder(kind: String) -> Result<(), String> {
    let mut directory = data_dir().ok_or("Tetro profile is unavailable")?;
    match kind.as_str() {
        "templates" => directory.push("templates"),
        "recordings" => directory.push("recordings"),
        "profile" => {},
        _ => return Err("Unknown Tetro folder".to_string()),
    }
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&directory).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&directory).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&directory).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}
