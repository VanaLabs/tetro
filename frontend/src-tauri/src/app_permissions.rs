//! Permission status uses OS APIs, never device enumeration or saved onboarding flags.
use serde::Serialize;
use tauri::{AppHandle, Runtime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSnapshot {
    platform: &'static str,
    microphone: &'static str,
    notifications: &'static str,
}

#[cfg(target_os = "macos")]
fn microphone_status() -> &'static str {
    use cidre::av;
    match av::CaptureDevice::authorization_status_for_media_type(av::MediaType::audio()).map(|s| s as isize) {
        Ok(0) => "not_requested", Ok(1) => "restricted", Ok(2) => "denied", Ok(3) => "granted", _ => "unknown",
    }
}

#[cfg(target_os = "macos")]
async fn notification_access<R: Runtime>(app: &AppHandle<R>, request: bool) -> Result<&'static str, String> {
    // UNUserNotificationCenter requires an app bundle. Never claim granted in a bare dev binary.
    if !std::env::current_exe().map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/")).unwrap_or(false) {
        return Ok("unknown");
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        use objc::{msg_send, sel, sel_impl};
        use objc::runtime::Object;
        use std::ffi::c_void;
        let mut tx = Some(tx);
        let center = cidre::un::Center::current() as *mut _ as *mut Object;
        if request {
            let mut callback = cidre::blocks::SendBlock::<fn(bool, *mut Object)>::new2(move |granted: bool, error: *mut Object| {
                if let Some(tx) = tx.take() { let _ = tx.send(if !error.is_null() { "unknown" } else if granted { "granted" } else { "denied" }); }
            });
            let block = &mut *callback as *mut _ as *mut c_void;
            // Apple copies the escaping block; its captured sender stays alive until completion.
            unsafe { let _: () = msg_send![center, requestAuthorizationWithOptions: 7usize completionHandler: block]; }
        } else {
            let mut callback = cidre::blocks::SendBlock::<fn(&cidre::un::NotificationSettings)>::new1(move |settings: &cidre::un::NotificationSettings| {
                let status = match settings.authorization_status() as isize {
                    0 => "not_requested", 1 => "denied", 2 => "granted", 3 | 4 => "limited", _ => "unknown",
                };
                if let Some(tx) = tx.take() { let _ = tx.send(status); }
            });
            let block = &mut *callback as *mut _ as *mut c_void;
            unsafe { let _: () = msg_send![center, getNotificationSettingsWithCompletionHandler: block]; }
        }
    }).map_err(|_| "Could not check notification access".to_string())?;
    rx.await.map_err(|_| "Notification permission check did not complete".to_string())
}

#[tauri::command]
pub async fn get_app_permissions<R: Runtime>(app: AppHandle<R>) -> Result<PermissionSnapshot, String> {
    #[cfg(target_os = "macos")]
    { Ok(PermissionSnapshot { platform: "macos", microphone: microphone_status(), notifications: notification_access(&app, false).await? }) }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Ok(PermissionSnapshot { platform: std::env::consts::OS, microphone: "unknown", notifications: "unknown" }) }
}

#[tauri::command]
pub async fn request_app_permission<R: Runtime>(app: AppHandle<R>, permission: String) -> Result<&'static str, String> {
    #[cfg(target_os = "macos")]
    {
        match permission.as_str() {
            "microphone" => {
                let (tx, rx) = tokio::sync::oneshot::channel();
                app.run_on_main_thread(move || {
                    let mut tx = Some(tx);
                    let mut callback = cidre::blocks::SendBlock::new1(move |granted: bool| {
                        if let Some(tx) = tx.take() { let _ = tx.send(granted); }
                    });
                    let _ = cidre::av::CaptureDevice::request_access_for_media_type_ch(cidre::av::MediaType::audio(), &mut callback);
                }).map_err(|_| "Could not request microphone access".to_string())?;
                rx.await.map_err(|_| "Microphone permission request did not complete".to_string())?;
                Ok(microphone_status())
            }
            "notifications" => notification_access(&app, true).await,
            _ => Err("Unknown permission".into()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (app, permission); Err("Manage permissions in your operating system settings".into()) }
}

#[tauri::command]
pub async fn open_app_permission_settings(permission: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Fixed destinations: never pass an arbitrary URL or shell command from the webview.
        let url = match permission.as_str() {
            "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            "system_audio" => "x-apple.systempreferences:com.apple.preference.security",
            "notifications" => "x-apple.systempreferences:com.apple.preference.notifications",
            _ => return Err("Unknown permission".into()),
        };
        let status = std::process::Command::new("/usr/bin/open").arg(url).status().map_err(|_| "Could not open System Settings")?;
        if !status.success() { return Err("Could not open System Settings".into()); }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = permission; Err("Open your operating system's privacy settings".into()) }
}

static AUDIO_TEST: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
pub async fn test_system_audio_access() -> Result<&'static str, String> {
    probe_system_audio_access(std::time::Duration::from_secs(6)).await
}

pub(crate) async fn probe_system_audio_access(timeout: std::time::Duration) -> Result<&'static str, String> {
    let guard = AUDIO_TEST.try_lock().map_err(|_| "An audio access test is already running")?;
    if crate::audio::recording_commands::get_recording_state().await["is_active"].as_bool().unwrap_or(false) {
        return Err("Finish the recording before testing audio access".into());
    }
    #[cfg(target_os = "macos")]
    {
        run_bounded_audio_probe(guard, timeout, || {
            // Stream creation alone is not permission proof: denied taps can deliver silence.
            // Samples are inspected in memory and discarded, never saved or transcribed.
            let capture = crate::audio::capture::CoreAudioCapture::new().map_err(|_| "Could not start the audio test. Check Audio Capture in System Settings.")?;
            capture.stream().map_err(|_| "Could not start the audio test. Check Audio Capture in System Settings.".to_string())
        }).await
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (guard, timeout); Ok("unknown") }
}

// AudioDeviceStart is synchronous and can stall before any stream exists. Bound
// the caller's whole test, not just callbacks after startup. A native call cannot
// be interrupted: the worker retains the lock and drops a late stream when it
// returns, so retries cannot accumulate overlapping captures.
#[cfg(any(target_os = "macos", test))]
async fn run_bounded_audio_probe<G, F, S>(guard: G, timeout: std::time::Duration, start: F) -> Result<&'static str, String>
where
    G: Send + 'static,
    F: FnOnce() -> Result<S, String> + Send + 'static,
    S: futures_util::Stream<Item = f32> + Unpin,
{
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    struct CancelOnDrop(Arc<AtomicBool>);
    impl Drop for CancelOnDrop {
        fn drop(&mut self) { self.0.store(true, Ordering::Release); }
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel_on_drop = CancelOnDrop(cancelled.clone());
    let deadline = std::time::Instant::now() + timeout;
    let worker = tokio::task::spawn_blocking(move || {
        let _guard = guard;
        if cancelled.load(Ordering::Acquire) || std::time::Instant::now() >= deadline {
            return Ok("inconclusive");
        }
        let stream = start()?;
        if cancelled.load(Ordering::Acquire) { return Ok("inconclusive"); }
        let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
            return Ok("inconclusive");
        };
        // Stream ownership releases capture on success, timeout, or cancellation.
        tauri::async_runtime::block_on(verify_audio_stream(stream, remaining))
    });
    match tokio::time::timeout(timeout, worker).await {
        Ok(result) => result.map_err(|_| "Audio test did not complete".to_string())?,
        Err(_) => Ok("inconclusive"),
    }
}

#[tauri::command]
pub async fn check_saved_key_access(state: tauri::State<'_, crate::state::AppState>) -> Result<usize, String> {
    use crate::database::repositories::setting::SettingsRepository;
    // Read the actual Tetro entries; a new dummy entry would not prove access to old keys.
    let pool = state.db_manager.pool();
    crate::credentials::migrate_legacy(pool).await.map_err(|e| e.to_string())?;
    let mut count = 0;
    for provider in ["openai", "claude", "groq", "openrouter", "ollama", "custom-openai"] {
        if SettingsRepository::get_api_key(pool, provider).await.map_err(|e| e.to_string())?.is_some() { count += 1; }
    }
    for provider in ["localWhisper", "deepgram", "elevenLabs", "groq", "openai"] {
        if SettingsRepository::get_transcript_api_key(pool, provider).await.map_err(|e| e.to_string())?.is_some() { count += 1; }
    }
    Ok(count)
}

// Own the stream so success, timeout, and early end all release capture resources.
async fn verify_audio_stream<S: futures_util::Stream<Item = f32> + Unpin>(
    mut stream: S,
    timeout: std::time::Duration,
) -> Result<&'static str, String> {
    use futures_util::StreamExt;
    let audible = tokio::time::timeout(timeout, async {
        while let Some(sample) = stream.next().await {
            if sample.is_finite() && sample.abs() > 0.00001 { return true; }
        }
        false
    }).await.unwrap_or(false);
    Ok(if audible { "verified" } else { "inconclusive" })
}

#[cfg(test)]
mod audio_access_tests {
    use super::{run_bounded_audio_probe, verify_audio_stream};
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    use std::time::Duration;

    #[tokio::test]
    async fn silent_or_invalid_samples_do_not_grant_or_deny_access() {
        let samples = futures_util::stream::iter([0.0, f32::NAN, f32::INFINITY, 0.000001]);
        assert_eq!(verify_audio_stream(samples, Duration::from_millis(20)).await.unwrap(), "inconclusive");
    }

    #[tokio::test]
    async fn actual_audio_verifies_access() {
        let samples = futures_util::stream::iter([0.0, -0.1]);
        assert_eq!(verify_audio_stream(samples, Duration::from_millis(20)).await.unwrap(), "verified");
    }

    #[tokio::test]
    async fn no_callbacks_times_out_and_releases_stream() {
        use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
        struct PendingCapture(Arc<AtomicBool>);
        impl futures_util::Stream for PendingCapture {
            type Item = f32;
            fn poll_next(self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>) -> std::task::Poll<Option<f32>> {
                std::task::Poll::Pending
            }
        }
        impl Drop for PendingCapture {
            fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); }
        }
        let dropped = Arc::new(AtomicBool::new(false));
        assert_eq!(verify_audio_stream(PendingCapture(dropped.clone()), Duration::from_millis(5)).await.unwrap(), "inconclusive");
        assert!(dropped.load(Ordering::SeqCst));
    }

    struct LateCapture { polled: Arc<AtomicBool>, dropped: Arc<AtomicBool> }
    impl futures_util::Stream for LateCapture {
        type Item = f32;
        fn poll_next(self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>) -> std::task::Poll<Option<f32>> {
            self.polled.store(true, Ordering::SeqCst);
            std::task::Poll::Ready(Some(0.1))
        }
    }
    impl Drop for LateCapture {
        fn drop(&mut self) { self.dropped.store(true, Ordering::SeqCst); }
    }

    async fn delayed_start_releases_without_polling(cancel: bool) {
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        let guard = lock.clone().lock_owned().await;
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let polled = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let capture = LateCapture { polled: polled.clone(), dropped: dropped.clone() };
        let caller = tokio::spawn(run_bounded_audio_probe(guard, if cancel { Duration::from_secs(1) } else { Duration::from_millis(30) }, move || {
            let _ = started_tx.send(());
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(capture)
        }));
        started_rx.await.unwrap();
        if cancel {
            caller.abort();
            assert!(caller.await.unwrap_err().is_cancelled());
        } else {
            assert_eq!(tokio::time::timeout(Duration::from_secs(1), caller).await.unwrap().unwrap().unwrap(), "inconclusive");
        }
        // Returning/aborting the UI request must not unlock a still-starting tap.
        assert!(lock.try_lock().is_err());
        release_tx.send(()).unwrap();
        let _released = tokio::time::timeout(Duration::from_secs(1), lock.lock()).await.unwrap();
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!polled.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn startup_timeout_keeps_lock_and_discards_late_audio() {
        delayed_start_releases_without_polling(false).await;
    }

    #[tokio::test]
    async fn cancelled_caller_keeps_lock_and_discards_late_audio() {
        delayed_start_releases_without_polling(true).await;
    }

    #[tokio::test]
    async fn bounded_probe_verifies_real_samples_and_releases_lock() {
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        let guard = lock.clone().lock_owned().await;
        assert_eq!(run_bounded_audio_probe(guard, Duration::from_secs(1), || Ok(futures_util::stream::iter([0.1]))).await.unwrap(), "verified");
        assert!(lock.try_lock().is_ok());
    }
}
