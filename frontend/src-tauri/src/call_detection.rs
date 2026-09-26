//! Notices when a call probably started: another app has been using the microphone for a
//! few seconds while Tetro isn't recording. The signal is deliberately quiet: a dot next to
//! the menu-bar T within its existing icon area, a "Record this call" menu item and one notification.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

static CALL_ACTIVE: AtomicBool = AtomicBool::new(false);
const STORE: &str = "preferences.json";
const KEY: &str = "call_detection";
const POLL: Duration = Duration::from_secs(3);
/// The microphone must stay on this long before it counts (skips dictation and blips).
const SUSTAIN: u32 = 2;
/// At most one notification in this window.
const QUIET: Duration = Duration::from_secs(15 * 60);

pub fn call_active() -> bool { CALL_ACTIVE.load(Ordering::SeqCst) }

fn enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.store(STORE).ok().and_then(|s| s.get(KEY)).and_then(|v| v.as_bool()).unwrap_or(true)
}

#[cfg(target_os = "macos")]
fn mic_in_use_elsewhere() -> bool {
    use cidre::core_audio as ca;
    ca::System::default_input_device()
        .and_then(|d| d.bool_prop(&ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE.global_addr()))
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn mic_in_use_elsewhere() -> bool { false }

fn set_active<R: Runtime>(app: &AppHandle<R>, active: bool) {
    if CALL_ACTIVE.swap(active, Ordering::SeqCst) != active {
        crate::brand::call_state_changed(app);
        crate::tray::update_tray_menu(app);
    }
}

/// Starts the background watcher (macOS). Cheap: one property read every few seconds.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    if cfg!(not(target_os = "macos")) { return; }
    tauri::async_runtime::spawn(async move {
        let mut streak = 0u32;
        let mut last_notice: Option<Instant> = None;
        loop {
            tokio::time::sleep(POLL).await;
            let ours = crate::audio::recording_commands::is_recording().await || crate::audio::simple_level_monitor::is_monitoring();
            let in_use = !ours && enabled(&app) && mic_in_use_elsewhere();
            streak = if in_use { streak + 1 } else { 0 };
            if streak == SUSTAIN {
                set_active(&app, true);
                if last_notice.map_or(true, |t| t.elapsed() > QUIET) {
                    last_notice = Some(Instant::now());
                    notify(&app);
                }
            } else if streak == 0 && call_active() {
                set_active(&app, false);
            }
        }
    });
}

fn notify<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_notification::NotificationExt;
    let shortcut = app.store(STORE).ok()
        .and_then(|s| s.get("global_shortcuts"))
        .and_then(|v| v.get("toggle_recording").and_then(|t| t.as_str()).map(str::to_string))
        .unwrap_or_else(|| "Alt+Super+R".into())
        .replace("Super", "⌘").replace("Alt", "⌥").replace("Shift", "⇧").replace("Control", "⌃").replace('+', "");
    let _ = app.notification().builder()
        .title("Your microphone is on")
        .body(format!("In a call? Press {} to record it with Tetro, or use the menu-bar T.", shortcut))
        .show();
}

#[tauri::command]
pub async fn api_get_call_detection<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> { Ok(enabled(&app)) }

#[tauri::command]
pub async fn api_set_call_detection<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE).map_err(|e| e.to_string())?;
    store.set(KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|e| e.to_string())?;
    if !enabled { set_active(&app, false); }
    Ok(())
}
