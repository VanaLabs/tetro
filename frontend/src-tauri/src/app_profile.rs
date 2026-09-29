//! Explicit consumer/development identity and isolated storage paths.
use std::{path::PathBuf, sync::OnceLock};
use tauri::Manager;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
#[cfg(not(feature = "dev-profile"))]
pub const IDENTIFIER: &str = "am.vanalabs.tetro";
#[cfg(feature = "dev-profile")]
pub const IDENTIFIER: &str = "am.vanalabs.tetro.dev";
pub const IS_DEV: bool = cfg!(feature = "dev-profile");
pub const NAME: &str = if IS_DEV { "Tetro Dev" } else { "Tetro" };
pub const CREDENTIAL_SERVICE: &str = if IS_DEV { "am.vanalabs.tetro.dev.provider-keys" } else { "am.vanalabs.tetro.provider-keys" };

pub fn initialize(app: &tauri::AppHandle) -> anyhow::Result<()> {
    if app.config().identifier != IDENTIFIER {
        anyhow::bail!("Unexpected Tetro application identifier: {}", app.config().identifier);
    }
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    let _ = DATA_DIR.set(directory.clone());
    log::info!("{} profile: {}", NAME, directory.display());
    #[cfg(all(feature = "dev-profile", target_os = "macos"))]
    unsafe {
        use objc::{class, msg_send, sel, sel_impl, runtime::Object};
        let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let dock: *mut Object = msg_send![application, dockTile];
        let label: *mut Object = msg_send![class!(NSString), stringWithUTF8String: b"DEV\0".as_ptr()];
        let _: () = msg_send![dock, setBadgeLabel: label];
        let _: () = msg_send![dock, display];
    }
    #[cfg(feature = "dev-profile")]
    if std::env::var_os("TETRO_DEV_SERVER").is_some() {
        if let Some(window) = app.get_webview_window("main") {
            window.navigate("http://localhost:3118".parse()?)?;
        }
    }
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
    let result = std::process::Command::new("/usr/bin/open").arg(&directory).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&directory).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&directory).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_identity_and_credentials_agree() {
        assert_eq!(IS_DEV, IDENTIFIER.ends_with(".dev"));
        assert_eq!(CREDENTIAL_SERVICE, format!("{IDENTIFIER}.provider-keys"));
        if IS_DEV {
            assert_ne!(IDENTIFIER, "am.vanalabs.tetro");
            let recordings = crate::audio::recording_preferences::get_default_recordings_folder();
            assert!(recordings.ends_with("am.vanalabs.tetro.dev/recordings"));
        }
    }
}
