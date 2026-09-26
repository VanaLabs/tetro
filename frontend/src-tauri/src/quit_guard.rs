//! Quit waits for the audio file and the meeting record to be saved.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

static NEEDS_SAVE: AtomicBool = AtomicBool::new(false);
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
pub fn recording_started() { NEEDS_SAVE.store(true, Ordering::SeqCst); }
pub fn allow_exit() -> bool { ALLOW_EXIT.load(Ordering::SeqCst) }
pub fn needs_save() -> bool { NEEDS_SAVE.load(Ordering::SeqCst) }

pub fn request<R: Runtime>(app: &AppHandle<R>) {
    crate::tray::focus_main_window(app);
    let _ = app.emit("tetro-quit-requested", serde_json::json!({ "pendingSave": NEEDS_SAVE.load(Ordering::SeqCst) }));
}

#[tauri::command]
pub async fn api_recording_saved() -> Result<(), String> {
    if crate::audio::recording_commands::is_recording().await { return Err("Recording is still running.".into()); }
    NEEDS_SAVE.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn api_finish_quit<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if NEEDS_SAVE.load(Ordering::SeqCst) || crate::audio::recording_commands::is_recording().await {
        return Err("Your recording still needs to be saved.".into());
    }
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn api_stop_for_quit<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if crate::audio::recording_commands::is_recording().await {
        let save_path = app.path().app_data_dir().map_err(|e| e.to_string())?
            .join(format!("recording-{}.wav", chrono::Local::now().format("%Y-%m-%dT%H-%M-%S")));
        crate::audio::recording_commands::stop_recording(app.clone(), crate::audio::recording_commands::RecordingArgs {
            save_path: save_path.to_string_lossy().into_owned(),
        }).await?;
    }
    app.emit("recording-stop-complete", true).map_err(|e| e.to_string())
}

// macOS Dock Quit calls NSApplication.terminate directly; it does not pass
// through Tauri's ExitRequested event. Cover that route as well as the menu.
#[cfg(target_os = "macos")]
pub fn install_native_guard(app: &tauri::App) {
    use objc::{class, msg_send, sel, sel_impl, runtime::{Class, Object, Sel}};
    use std::{ffi::{c_char, c_void}, sync::OnceLock};
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    extern "C" fn should_terminate(_: &Object, _: Sel, _: *mut Object) -> usize {
        if needs_save() && !allow_exit() {
            if let Some(app) = APP.get() { request(app); }
            0 // NSTerminateCancel; the UI will quit after the saved acknowledgement.
        } else { 1 } // NSTerminateNow
    }
    unsafe extern "C" {
        fn class_addMethod(cls: *const Class, name: Sel, imp: *const c_void, types: *const c_char) -> bool;
    }
    let _ = APP.set(app.handle().clone());
    unsafe {
        let native_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut Object = msg_send![native_app, delegate];
        if !delegate.is_null() {
            let added = class_addMethod((*delegate).class(), sel!(applicationShouldTerminate:), should_terminate as *const c_void, c"Q@:@".as_ptr());
            if !added { log::warn!("A native termination delegate already exists; application menu and tray quit remain guarded."); }
        }
    }
}
#[cfg(not(target_os = "macos"))]
pub fn install_native_guard(_: &tauri::App) {}
