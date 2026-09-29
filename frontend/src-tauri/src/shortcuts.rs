//! Global keyboard shortcuts that work while Tetro is in the background:
//! start/stop recording, and mark an important moment. Changeable in Settings → Recordings.

use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Shortcuts {
    pub toggle_recording: String,
    pub mark_moment: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self { toggle_recording: if crate::app_profile::IS_DEV { "Alt+Shift+Super+R" } else { "Alt+Super+R" }.into(), mark_moment: if crate::app_profile::IS_DEV { "Alt+Shift+Super+M" } else { "Alt+Super+M" }.into() }
    }
}

static CURRENT: RwLock<Option<(Shortcut, Shortcut)>> = RwLock::new(None);
const STORE: &str = "preferences.json";
const KEY: &str = "global_shortcuts";

fn load<R: Runtime>(app: &AppHandle<R>) -> Shortcuts {
    app.store(STORE).ok()
        .and_then(|s| s.get(KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn parse(s: &str) -> Result<Shortcut, String> {
    s.parse::<Shortcut>().map_err(|_| format!("“{}” isn’t a valid shortcut", s))
}

fn apply<R: Runtime>(app: &AppHandle<R>, shortcuts: &Shortcuts) -> Result<(), String> {
    let toggle = parse(&shortcuts.toggle_recording)?;
    let mark = parse(&shortcuts.mark_moment)?;
    if toggle == mark {
        return Err("The two shortcuts must be different".into());
    }
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(toggle).map_err(|_| format!("{} is already used by another app", shortcuts.toggle_recording))?;
    if let Err(_) = gs.register(mark) {
        let _ = gs.unregister(toggle);
        return Err(format!("{} is already used by another app", shortcuts.mark_moment));
    }
    *CURRENT.write().unwrap_or_else(|e| e.into_inner()) = Some((toggle, mark));
    Ok(())
}

/// Registers the saved shortcuts at startup. Failures are logged, never fatal.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    if let Err(e) = apply(app, &load(app)) {
        log::warn!("Global shortcuts not registered: {}", e);
    }
}

/// Plugin handler: runs on key down only.
pub fn handle<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }
    let current = *CURRENT.read().unwrap_or_else(|e| e.into_inner());
    let Some((toggle, mark)) = current else { return };
    if *shortcut == toggle {
        crate::tray::toggle_recording(app, false);
    } else if *shortcut == mark {
        let _ = app.emit("mark-moment", ());
    }
}

#[tauri::command]
pub async fn api_get_shortcuts<R: Runtime>(app: AppHandle<R>) -> Result<Shortcuts, String> {
    Ok(load(&app))
}

/// Saves new shortcuts. If one can't be registered, the previous ones are restored.
#[tauri::command]
pub async fn api_set_shortcuts<R: Runtime>(app: AppHandle<R>, shortcuts: Shortcuts) -> Result<Shortcuts, String> {
    let previous = load(&app);
    if let Err(e) = apply(&app, &shortcuts) {
        let _ = apply(&app, &previous);
        return Err(e);
    }
    let store = app.store(STORE).map_err(|e| e.to_string())?;
    store.set(KEY, serde_json::to_value(&shortcuts).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(shortcuts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcuts_parse() {
        let d = Shortcuts::default();
        assert!(parse(&d.toggle_recording).is_ok());
        assert!(parse(&d.mark_moment).is_ok());
        assert!(parse("Nonsense+Key").is_err());
    }
}
