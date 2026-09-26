//! One profile root for Tetro data. Development never shares Meetily's storage.
use std::{path::PathBuf, sync::OnceLock};
use tauri::Manager;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static DEVELOPMENT: OnceLock<bool> = OnceLock::new();

pub fn initialize(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let identifier = &app.config().identifier;
    if !matches!(identifier.as_str(), "am.vanalabs.tetro" | "am.vanalabs.tetro.dev") {
        anyhow::bail!("Unexpected Tetro application identifier: {}", identifier);
    }
    if let Ok(expected) = std::env::var("TETRO_EXPECTED_IDENTIFIER") {
        if identifier != &expected {
            anyhow::bail!("Development profile mismatch: expected {}", expected);
        }
    }
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    let _ = DEVELOPMENT.set(identifier.ends_with(".dev"));
    let _ = DATA_DIR.set(directory.clone());
    log::info!("Tetro profile: {} ({})", directory.display(), identifier);
    Ok(())
}

pub fn is_development() -> bool {
    DEVELOPMENT.get().copied().unwrap_or(cfg!(debug_assertions))
}

pub fn data_dir() -> Option<PathBuf> {
    DATA_DIR.get().cloned().or_else(|| {
        dirs::data_dir().map(|root| root.join(if is_development() {
            "am.vanalabs.tetro.dev"
        } else {
            "am.vanalabs.tetro"
        }))
    })
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

#[cfg(debug_assertions)]
pub fn add_development_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, Submenu};
    if !is_development() { return Ok(()); }
    let menu = match app.menu() { Some(menu) => menu, None => Menu::default(app.handle())? };
    let inspector = MenuItem::with_id(app, "tetro-inspector", "Inspect Interface", true, Some("CmdOrCtrl+Alt+I"))?;
    let reload = MenuItem::with_id(app, "tetro-reload", "Reload Interface", true, Some("CmdOrCtrl+R"))?;
    let profile = MenuItem::with_id(app, "tetro-profile", "Open Development Data", true, None::<&str>)?;
    menu.append(&Submenu::with_items(app, "Developer", true, &[&inspector, &reload, &profile])?)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(window) = app.get_webview_window("main") {
            match event.id.as_ref() {
                "tetro-inspector" => { if window.is_devtools_open() { window.close_devtools(); } else { window.open_devtools(); } },
                "tetro-reload" => { let _ = window.eval("window.location.reload()"); },
                "tetro-profile" => { let _ = open_tetro_folder("profile".into()); },
                _ => {},
            }
        }
    });
    Ok(())
}
