mod model_integrity;
mod verified_ffmpeg;
mod recording_paths;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
// Removed unused import

// Performance optimization: Conditional logging macros for hot paths
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => {
        log::debug!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};
}

#[cfg(debug_assertions)]
macro_rules! perf_trace {
    ($($arg:tt)*) => {
        log::trace!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_trace {
    ($($arg:tt)*) => {};
}

// Make these macros available to other modules
pub(crate) use perf_debug;
pub(crate) use perf_trace;

// Re-export async logging macros for external use (removed due to macro conflicts)

// Declare audio module
pub mod app_profile;
pub mod credentials;
pub mod app_permissions;
pub mod network_security;
mod app_menu;
mod startup;
pub mod api;
pub mod audio;
pub mod config;
pub mod storage_usage;
pub mod meeting_media;
pub mod meeting_preferences;
mod quit_guard;
pub mod transcript_edits;
pub mod meeting_edits;
pub mod meeting_trash;
pub mod vocabulary;
pub mod shortcuts;
pub mod meeting_marks;
pub mod action_items;
pub mod library_search;
pub mod call_detection;
pub mod speakers;
pub mod console_utils;
pub mod database;
pub mod notifications;
pub mod ollama;
pub mod onboarding;
pub mod openai;
pub mod anthropic;
pub mod groq;
pub mod openrouter;
pub mod parakeet_engine;
pub mod state;
pub mod summary;
pub mod tray;
pub mod brand;
pub mod utils;
pub mod whisper_engine;

use audio::{list_audio_devices, AudioDevice, trigger_audio_permission};
use log::{error as log_error, info as log_info};
use notifications::commands::NotificationManagerState;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::RwLock;

static RECORDING_FLAG: AtomicBool = AtomicBool::new(false);

static ONNX_RUNTIME_INIT_ERROR: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub(crate) fn ensure_onnx_runtime_available() -> anyhow::Result<()> {
    if let Some(error) = ONNX_RUNTIME_INIT_ERROR.get() {
        anyhow::bail!("{error}");
    }

    Ok(())
}

fn catch_onnx_runtime_init<F, E>(init: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), E>,
    E: std::fmt::Display,
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(init)) {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(payload) => {
            let message = payload
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown panic");
            Err(format!("ONNX Runtime initialization panicked: {message}"))
        }
    }
}

fn record_onnx_runtime_failure(error: String) {
    log::error!("{error}");
    let _ = ONNX_RUNTIME_INIT_ERROR.set(error);
}

#[cfg(test)]
mod onnx_runtime_tests {
    use super::catch_onnx_runtime_init;

    #[test]
    fn catch_onnx_runtime_init_converts_errors_and_panics() {
        assert!(catch_onnx_runtime_init(|| Ok::<(), &str>(())).is_ok());
        assert_eq!(
            catch_onnx_runtime_init(|| Err::<(), _>("initializer error")),
            Err("initializer error".to_string())
        );

        let error = catch_onnx_runtime_init(|| -> Result<(), &str> {
            panic!("synthetic loader panic");
        })
        .unwrap_err();
        assert!(error.contains("synthetic loader panic"));
    }
}

// Global language preference storage (default to "auto-translate" for automatic translation to English)
static LANGUAGE_PREFERENCE: std::sync::LazyLock<StdMutex<String>> =
    std::sync::LazyLock::new(|| StdMutex::new("auto-translate".to_string()));

#[derive(Debug, Deserialize)]
struct RecordingArgs {
    save_path: String,
}

#[derive(Debug, Serialize, Clone)]
struct TranscriptionStatus {
    chunks_in_queue: usize,
    is_processing: bool,
    last_activity_ms: u64,
}

#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!("🔥 CALLED start_recording with meeting: {:?}", meeting_name);
    log_info!(
        "📋 Backend received parameters - mic: {:?}, system: {:?}, meeting: {:?}",
        mic_device_name,
        system_device_name,
        meeting_name
    );

    if is_recording().await {
        return Err("Recording already in progress".to_string());
    }

    // Call the actual audio recording system with meeting name
    match audio::recording_commands::start_recording_with_devices_and_meeting(
        app.clone(),
        mic_device_name,
        system_device_name,
        meeting_name.clone(),
    )
    .await
    {
        Ok(_) => {
            RECORDING_FLAG.store(true, Ordering::SeqCst);
            tray::update_tray_menu(&app);

            log_info!("Recording started successfully");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name.clone(),
            )
            .await
            {
                log_error!(
                    "Failed to show recording started notification: {}",
                    e
                );
            } else {
                log_info!("Successfully showed recording started notification");
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start audio recording: {}", e);
            Err(format!("Failed to start recording: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_recording<R: Runtime>(app: AppHandle<R>, args: RecordingArgs) -> Result<(), String> {
    log_info!("Attempting to stop recording...");

    // Check the actual audio recording system state instead of the flag
    if !audio::recording_commands::is_recording().await {
        log_info!("Recording is already stopped");
        return Ok(());
    }

    // Call the actual audio recording system to stop
    match audio::recording_commands::stop_recording(
        app.clone(),
        audio::recording_commands::RecordingArgs {
            save_path: args.save_path.clone(),
        },
    )
    .await
    {
        Ok(_) => {
            RECORDING_FLAG.store(false, Ordering::SeqCst);
            tray::update_tray_menu(&app);

            // Create the save directory if it doesn't exist
            if let Some(parent) = std::path::Path::new(&args.save_path).parent() {
                if !parent.exists() {
                    log_info!("Creating directory: {:?}", parent);
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        let err_msg = format!("Failed to create save directory: {}", e);
                        log_error!("{}", err_msg);
                        return Err(err_msg);
                    }
                }
            }

            // Show recording stopped notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_stopped_notification(
                &app,
                &notification_manager_state,
            )
            .await
            {
                log_error!(
                    "Failed to show recording stopped notification: {}",
                    e
                );
            } else {
                log_info!("Successfully showed recording stopped notification");
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to stop audio recording: {}", e);
            // Still update the flag even if stopping failed
            RECORDING_FLAG.store(false, Ordering::SeqCst);
            tray::update_tray_menu(&app);
            Err(format!("Failed to stop recording: {}", e))
        }
    }
}

#[tauri::command]
async fn is_recording() -> bool {
    audio::recording_commands::is_recording().await
}

#[tauri::command]
fn get_transcription_status() -> TranscriptionStatus {
    TranscriptionStatus {
        chunks_in_queue: 0,
        is_processing: false,
        last_activity_ms: 0,
    }
}

#[tauri::command]
async fn save_markdown_file<R: Runtime>(app: AppHandle<R>, file_name: String, content: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let name = std::path::Path::new(&file_name).file_name().and_then(|n| n.to_str()).unwrap_or("meeting.md");
    let name = if name.ends_with(".md") { name.to_string() } else { format!("{name}.md") };
    let Some(file) = app.dialog().file().set_file_name(&name).add_filter("Markdown", &["md"]).blocking_save_file() else { return Ok(None); };
    let path = file.into_path().map_err(|e| e.to_string())?;
    if path.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink()) { return Err("Choose a file rather than a symbolic link.".into()); }
    std::fs::write(&path, content).map_err(|e| format!("Could not export Markdown: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// Audio level monitoring commands
#[tauri::command]
fn get_default_microphone() -> Result<String, String> {
    audio::default_input_device().map(|device| device.name).map_err(|error| error.to_string())
}

#[tauri::command]
async fn print_meeting_pdf<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("The meeting window is unavailable.")?;
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        window.with_webview(move |webview| unsafe {
            use objc::{class, msg_send, sel, sel_impl, runtime::Object};
            let shared: *mut Object = msg_send![class!(NSPrintInfo), sharedPrintInfo];
            let info: *mut Object = msg_send![shared, copy];
            // AppKit defaults can clip vertically. Each export owns its settings.
            // https://developer.apple.com/documentation/appkit/nsprintinfo/verticalpagination
            let _: () = msg_send![info, setHorizontalPagination: 1usize]; // fit width
            let _: () = msg_send![info, setVerticalPagination: 0usize]; // automatic pages
            let _: () = msg_send![info, setVerticallyCentered: false];
            let _: () = msg_send![info, setTopMargin: 36.0f64];
            let _: () = msg_send![info, setBottomMargin: 36.0f64];
            let _: () = msg_send![info, setLeftMargin: 36.0f64];
            let _: () = msg_send![info, setRightMargin: 36.0f64];
            let native = webview.inner() as *mut Object;
            let operation: *mut Object = msg_send![native, printOperationWithPrintInfo: info];
            let _: () = msg_send![info, release];
            if operation.is_null() { let _ = send.send(Err("Printing is unavailable on this device.".to_string())); return; }
            let native_window: *mut Object = msg_send![native, window];
            let _: () = msg_send![operation, setCanSpawnSeparateThread: true];
            let _: () = msg_send![operation, runOperationModalForWindow: native_window delegate: std::ptr::null_mut::<Object>() didRunSelector: std::ptr::null::<std::ffi::c_void>() contextInfo: std::ptr::null_mut::<std::ffi::c_void>()];
            let _ = send.send(Ok(()));
        }).map_err(|error| error.to_string())?;
        receive.await.map_err(|_| "The print window could not be opened.".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    window.print().map_err(|e| format!("Could not open the PDF print window: {}", e))
}

#[tauri::command]
async fn start_audio_level_monitoring<R: Runtime>(
    app: AppHandle<R>,
    device_names: Vec<String>,
) -> Result<(), String> {
    log_info!(
        "Starting audio level monitoring for devices: {:?}",
        device_names
    );

    audio::simple_level_monitor::start_monitoring(app, device_names)
        .await
        .map_err(|e| format!("Failed to start audio level monitoring: {}", e))
}

#[tauri::command]
async fn stop_audio_level_monitoring() -> Result<(), String> {
    log_info!("Stopping audio level monitoring");

    audio::simple_level_monitor::stop_monitoring()
        .await
        .map_err(|e| format!("Failed to stop audio level monitoring: {}", e))
}

#[tauri::command]
async fn is_audio_level_monitoring() -> bool {
    audio::simple_level_monitor::is_monitoring()
}


// Whisper commands are now handled by whisper_engine::commands module

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    list_audio_devices()
        .await
        .map_err(|e| format!("Failed to list audio devices: {}", e))
}

#[tauri::command]
async fn trigger_microphone_permission() -> Result<bool, String> {
    trigger_audio_permission()
        .map_err(|e| format!("Failed to trigger microphone permission: {}", e))
}

#[tauri::command]
async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

#[tauri::command]
async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!("🚀 CALLED start_recording_with_devices_and_meeting - Mic: {:?}, System: {:?}, Meeting: {:?}",
             mic_device_name, system_device_name, meeting_name);

    // Clone meeting_name for notification use later
    let meeting_name_for_notification = meeting_name.clone();

    // Call the recording module functions that support meeting names
    let recording_result = match (mic_device_name.clone(), system_device_name.clone()) {
        (None, None) => {
            log_info!(
                "No devices specified, starting with defaults and meeting: {:?}",
                meeting_name
            );
            audio::recording_commands::start_recording_with_meeting_name(app.clone(), meeting_name)
                .await
        }
        _ => {
            log_info!(
                "Starting with specified devices: mic={:?}, system={:?}, meeting={:?}",
                mic_device_name,
                system_device_name,
                meeting_name
            );
            audio::recording_commands::start_recording_with_devices_and_meeting(
                app.clone(),
                mic_device_name,
                system_device_name,
                meeting_name,
            )
            .await
        }
    };

    match recording_result {
        Ok(_) => {
            log_info!("Recording started successfully via tauri command");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name_for_notification.clone(),
            )
            .await
            {
                log_error!(
                    "Failed to show recording started notification: {}",
                    e
                );
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start recording via tauri command: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
async fn set_language_preference(language: String) -> Result<(), String> {
    let mut lang_pref = LANGUAGE_PREFERENCE
        .lock()
        .map_err(|e| format!("Failed to set language preference: {}", e))?;
    log_info!("Setting language preference to: {}", language);
    *lang_pref = language;
    Ok(())
}

// Internal helper function to get language preference (for use within Rust code)
pub fn get_language_preference_internal() -> Option<String> {
    LANGUAGE_PREFERENCE.lock().ok().map(|lang| lang.clone())
}

pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    // Native blur sits behind the webview; CSS keeps the reading panes opaque.
    // Configure it before window creation and leave other platforms unchanged.
    #[cfg(target_os = "macos")]
    for window in &mut context.config_mut().app.windows {
        if window.label == "main" {
            window.transparent = true;
            window.title_bar_style = tauri::TitleBarStyle::Transparent;
            window.window_effects = Some(
                tauri::window::EffectsBuilder::new()
                    .effect(tauri::window::Effect::Sidebar)
                    .state(tauri::window::EffectState::Active)
                    .build(),
            );
        }
    }

    log::set_max_level(log::LevelFilter::Info);

    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            log_info!(
                "Second app instance requested with args: {:?}, cwd: {:?}",
                args,
                cwd
            );

            tray::focus_main_window(app);
        }));
    }

    #[cfg(not(feature = "dev-profile"))]
    { builder = builder.plugin(tauri_plugin_updater::Builder::new().build()); }

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| shortcuts::handle(app, shortcut, event.state())).build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(whisper_engine::parallel_commands::ParallelProcessorState::new())
        .manage(Arc::new(RwLock::new(
            None::<notifications::manager::NotificationManager<tauri::Wry>>,
        )) as NotificationManagerState<tauri::Wry>)
        .manage(audio::init_system_audio_state())
        .manage(summary::summary_engine::ModelManagerState(Arc::new(tokio::sync::Mutex::new(None))))
        .setup(|_app| {
            app_profile::initialize(_app.handle())?;
            app_menu::install(_app)?;
            #[cfg(not(target_os = "windows"))]
            if let Err(error) = catch_onnx_runtime_init(|| {
                ort::init().with_telemetry(false).commit().map(|_| ())
            }) {
                record_onnx_runtime_failure(format!("Failed to initialize ONNX Runtime: {error}"));
            }
            #[cfg(target_os = "windows")]
            match _app.path().resolve(
                "onnxruntime.dll",
                tauri::path::BaseDirectory::Resource,
            ) {
                Ok(runtime_path) => {
                    match catch_onnx_runtime_init(|| {
                        ort::init_from(runtime_path.to_string_lossy().into_owned())
                            .with_telemetry(false)
                            .commit()
                            .map(|_| ())
                    }) {
                        Ok(()) => log::info!(
                            "Initialized bundled ONNX Runtime from {}",
                            runtime_path.display()
                        ),
                        Err(error) => record_onnx_runtime_failure(format!(
                            "Failed to initialize bundled ONNX Runtime from {}: {}",
                            runtime_path.display(),
                            error
                        )),
                    }
                }
                Err(error) => record_onnx_runtime_failure(format!(
                    "Failed to resolve bundled ONNX Runtime resource: {}",
                    error
                )),
            };

            log::info!("Application setup complete");

            // Initialize system tray
            shortcuts::init(_app.handle());
            call_detection::start(_app.handle().clone());
            if let Err(e) = tray::create_tray(_app.handle()) {
                log::error!("Failed to create system tray: {}", e);
            }

            // Initialize notification system with proper defaults
            log::info!("Initializing notification system...");
            let app_for_notif = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let notif_state = app_for_notif.state::<NotificationManagerState<tauri::Wry>>();
                match notifications::commands::initialize_notification_manager(app_for_notif.clone()).await {
                    Ok(manager) => {
                        // Set default consent and permissions on first launch
                        if let Err(e) = manager.set_consent(true).await {
                            log::error!("Failed to set initial consent: {}", e);
                        }
                        if let Err(e) = manager.request_permission().await {
                            log::error!("Failed to request initial permission: {}", e);
                        }

                        // Store the initialized manager
                        let mut state_lock = notif_state.write().await;
                        *state_lock = Some(manager);
                        log::info!("Notification system initialized with default permissions");
                    }
                    Err(e) => {
                        log::error!("Failed to initialize notification manager: {}", e);
                    }
                }
            });

            // Set models directory to use app_data_dir (unified storage location)
            whisper_engine::commands::set_models_directory(&_app.handle());

            // Initialize Whisper engine on startup
            tauri::async_runtime::spawn(async {
                if let Err(e) = whisper_engine::commands::whisper_init().await {
                    log::error!("Failed to initialize Whisper engine on startup: {}", e);
                }
            });

            // Set Parakeet models directory
            parakeet_engine::commands::set_models_directory(&_app.handle());

            // Initialize Parakeet engine on startup
            tauri::async_runtime::spawn(async {
                if let Err(e) = parakeet_engine::commands::parakeet_init().await {
                    log::error!("Failed to initialize Parakeet engine on startup: {}", e);
                }
            });

            // Initialize ModelManager for summary engine (async, non-blocking)
            let app_handle_for_model_manager = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match summary::summary_engine::commands::init_model_manager_at_startup(&app_handle_for_model_manager).await {
                    Ok(_) => log::info!("ModelManager initialized successfully at startup"),
                    Err(e) => {
                        log::warn!("Failed to initialize ModelManager at startup: {}", e);
                        log::warn!("ModelManager will be lazy-initialized on first use");
                    }
                }
            });

            // Trigger system audio permission request on startup (similar to microphone permission)
            // #[cfg(target_os = "macos")]
            // {
            //     tauri::async_runtime::spawn(async {
            //         if let Err(e) = audio::permissions::trigger_system_audio_permission() {
            //             log::warn!("Failed to trigger system audio permission: {}", e);
            //         }
            //     });
            // }

            // Initialize database (handles first launch detection and conditional setup)
            if let Err(error) = tauri::async_runtime::block_on(async {
                database::setup::initialize_database_on_startup(&_app.handle()).await
            }) {
                log::error!("Could not open the meeting library: {}", error);
                startup::failed(error);
            }

            // Initialize bundled templates directory for dynamic template discovery
            log::info!("Initializing bundled templates directory...");
            if let Ok(resource_path) = _app.handle().path().resource_dir() {
                let templates_dir = resource_path.join("templates");
                log::info!("Setting bundled templates directory to: {:?}", templates_dir);
                summary::templates::set_bundled_templates_dir(templates_dir);
            } else {
                log::warn!("Failed to resolve resource directory for templates");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    if let Err(e) = window.hide() {
                        log::error!("Failed to hide main window on close request: {}", e);
                    } else {
                        log::info!("Main window hidden to tray on close request");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            meeting_preferences::api_get_meeting_preferences,
            quit_guard::api_recording_saved,
            quit_guard::api_finish_quit,
            quit_guard::api_stop_for_quit,
            meeting_preferences::api_set_meeting_template,
            meeting_preferences::api_get_automatic_names,
            meeting_preferences::api_set_automatic_names,
            app_profile::open_tetro_folder,
            start_recording,
            stop_recording,
            is_recording,
            get_transcription_status,
            save_markdown_file,
            startup::api_startup_issue,
            startup::api_retry_startup,
            print_meeting_pdf,
            get_default_microphone,
            whisper_engine::commands::whisper_init,
            whisper_engine::commands::whisper_get_available_models,
            whisper_engine::commands::whisper_load_model,
            whisper_engine::commands::whisper_get_current_model,
            whisper_engine::commands::whisper_is_model_loaded,
            whisper_engine::commands::whisper_has_available_models,
            whisper_engine::commands::whisper_validate_model_ready,
            whisper_engine::commands::whisper_transcribe_audio,
            whisper_engine::commands::whisper_get_models_directory,
            whisper_engine::commands::whisper_download_model,
            whisper_engine::commands::whisper_cancel_download,
            whisper_engine::commands::whisper_delete_corrupted_model,
            whisper_engine::local_models::whisper_import_model,
            // Parakeet engine commands
            parakeet_engine::commands::parakeet_init,
            parakeet_engine::commands::parakeet_get_available_models,
            parakeet_engine::commands::parakeet_load_model,
            parakeet_engine::commands::parakeet_get_current_model,
            parakeet_engine::commands::parakeet_is_model_loaded,
            parakeet_engine::commands::parakeet_has_available_models,
            parakeet_engine::commands::parakeet_validate_model_ready,
            parakeet_engine::commands::parakeet_transcribe_audio,
            parakeet_engine::commands::parakeet_get_models_directory,
            parakeet_engine::commands::parakeet_download_model,
            parakeet_engine::commands::parakeet_retry_download,
            parakeet_engine::commands::parakeet_cancel_download,
            parakeet_engine::commands::parakeet_delete_corrupted_model,
            parakeet_engine::commands::open_parakeet_models_folder,
            // Parallel processing commands
            whisper_engine::parallel_commands::initialize_parallel_processor,
            whisper_engine::parallel_commands::start_parallel_processing,
            whisper_engine::parallel_commands::pause_parallel_processing,
            whisper_engine::parallel_commands::resume_parallel_processing,
            whisper_engine::parallel_commands::stop_parallel_processing,
            whisper_engine::parallel_commands::get_parallel_processing_status,
            whisper_engine::parallel_commands::get_system_resources,
            whisper_engine::parallel_commands::check_resource_constraints,
            whisper_engine::parallel_commands::calculate_optimal_workers,
            whisper_engine::parallel_commands::prepare_audio_chunks,
            whisper_engine::parallel_commands::test_parallel_processing_setup,
            get_audio_devices,
            trigger_microphone_permission,
            app_permissions::get_app_permissions,
            app_permissions::request_app_permission,
            app_permissions::open_app_permission_settings,
            app_permissions::test_system_audio_access,
            app_permissions::check_saved_key_access,
            start_recording_with_devices,
            start_recording_with_devices_and_meeting,
            start_audio_level_monitoring,
            stop_audio_level_monitoring,
            is_audio_level_monitoring,
            // Recording pause/resume commands
            audio::recording_commands::pause_recording,
            audio::recording_commands::resume_recording,
            audio::recording_commands::is_recording_paused,
            audio::recording_commands::get_recording_state,
            audio::input_controls::get_recording_inputs,
            audio::input_controls::set_recording_input_muted,
            audio::recording_commands::get_meeting_folder_path,
            // Reload sync commands (retrieve transcript history and meeting name)
            audio::recording_commands::get_transcript_history,
            audio::recording_commands::get_recording_meeting_name,
            // Playback device detection (Bluetooth warning)
            audio::recording_commands::get_active_audio_output,
            // Audio recovery commands (for transcript recovery feature)
            audio::incremental_saver::recover_audio_from_checkpoints,
            audio::incremental_saver::cleanup_checkpoints,
            audio::incremental_saver::has_audio_checkpoints,
            console_utils::show_console,
            console_utils::hide_console,
            console_utils::toggle_console,
            ollama::get_ollama_models,
            ollama::pull_ollama_model,
            ollama::delete_ollama_model,
            ollama::get_ollama_model_context,
            openai::openai::get_openai_models,
            anthropic::anthropic::get_anthropic_models,
            groq::groq::get_groq_models,
            api::api_get_meetings,
            api::api_search_transcripts,
            api::api_get_model_config,
            api::api_save_model_config,
            api::api_get_api_key,
            api::api_save_api_key,
            api::api_delete_api_key,
            // api::api_get_auto_generate_setting,
            // api::api_save_auto_generate_setting,
            api::api_get_transcript_config,
            api::api_save_transcript_config,
            api::api_get_transcript_api_key,
            api::api_delete_meeting,
            api::api_get_meeting,
            api::api_get_meeting_metadata,
            api::api_get_meeting_transcripts,
            api::api_save_meeting_title,
            api::api_save_transcript,
            api::open_meeting_folder,
            api::open_external_url,
            // Custom OpenAI commands
            api::api_save_custom_openai_config,
            api::api_get_custom_openai_config,
            api::api_test_custom_openai_connection,
            // Summary commands
            summary::commands::api_process_transcript,
            summary::commands::api_get_summary,
            summary::commands::api_save_meeting_summary,
            summary::commands::api_get_meeting_summary_language,
            summary::commands::api_save_meeting_summary_language,
            summary::commands::api_get_meeting_detected_summary_language,
            summary::commands::api_save_meeting_detected_summary_language,
            summary::commands::api_detect_transcript_summary_language,
            summary::commands::api_cancel_summary,
            // Template commands
            summary::template_commands::api_list_templates,
            summary::template_commands::api_get_template_details,
            summary::template_commands::api_validate_template,
            summary::template_builder::api_get_template_full,
            summary::template_builder::api_save_custom_template,
            summary::template_builder::api_delete_custom_template,
            summary::template_builder::api_draft_template,
            summary::draft_jobs::api_cancel_template_draft,
            summary::template_builder::api_import_template,
            summary::template_builder::api_export_template,
            storage_usage::api_storage_summary,
            storage_usage::api_list_recordings,
            storage_usage::api_delete_recording,
            meeting_media::api_meeting_audio_path,
            transcript_edits::api_update_transcript_lines,
            meeting_edits::api_get_meeting_edits,
            meeting_trash::api_pending_local_cleanup,
            meeting_trash::api_ack_local_cleanup,
            meeting_trash::api_move_to_trash,
            meeting_trash::api_list_trash,
            meeting_trash::api_restore_trash,
            meeting_trash::api_delete_trash_permanently,
            meeting_edits::api_correct_meeting_term,
            meeting_edits::api_get_meeting_versions,
            meeting_edits::api_preview_meeting_version,
            meeting_edits::api_restore_meeting_version,
            vocabulary::api_get_vocabulary,
            vocabulary::api_set_vocabulary,
            shortcuts::api_get_shortcuts,
            shortcuts::api_set_shortcuts,
            meeting_marks::api_get_meeting_marks,
            meeting_marks::api_add_meeting_marks,
            meeting_marks::api_delete_meeting_mark,
            action_items::api_list_action_items,
            action_items::api_set_action_item_done,
            action_items::api_edit_action_item,
            library_search::api_search_library,
            call_detection::api_get_call_detection,
            call_detection::api_set_call_detection,
            speakers::api_identify_speakers,
            speakers::api_rename_speaker,
            speakers::api_clear_speakers,
            // Built-in AI commands
            summary::summary_engine::commands::builtin_ai_list_models,
            summary::summary_engine::commands::builtin_ai_get_model_info,
            summary::summary_engine::commands::builtin_ai_download_model,
            summary::summary_engine::commands::builtin_ai_cancel_download,
            summary::summary_engine::commands::builtin_ai_delete_model,
            summary::summary_engine::commands::builtin_ai_is_model_ready,
            summary::summary_engine::commands::builtin_ai_get_available_summary_model,
            summary::summary_engine::commands::builtin_ai_get_recommended_model,
            openrouter::get_openrouter_models,
            audio::recording_preferences::get_recording_preferences,
            audio::recording_preferences::set_recording_preferences,
            audio::recording_preferences::get_default_recordings_folder_path,
            audio::recording_preferences::open_recordings_folder,
            audio::recording_preferences::select_recording_folder,
            audio::recording_preferences::get_available_audio_backends,
            audio::recording_preferences::get_current_audio_backend,
            audio::recording_preferences::set_audio_backend,
            audio::recording_preferences::get_audio_backend_info,
            // Language preference commands
            set_language_preference,
            // Notification system commands
            notifications::commands::get_notification_settings,
            notifications::commands::set_notification_settings,
            notifications::commands::request_notification_permission,
            notifications::commands::show_notification,
            notifications::commands::show_test_notification,
            notifications::commands::is_dnd_active,
            notifications::commands::get_system_dnd_status,
            notifications::commands::set_manual_dnd,
            notifications::commands::set_notification_consent,
            notifications::commands::clear_notifications,
            notifications::commands::is_notification_system_ready,
            notifications::commands::initialize_notification_manager_manual,
            notifications::commands::test_notification_with_auto_consent,
            notifications::commands::get_notification_stats,
            // System audio capture commands
            audio::system_audio_commands::start_system_audio_capture_command,
            audio::system_audio_commands::list_system_audio_devices_command,
            audio::system_audio_commands::check_system_audio_permissions_command,
            audio::system_audio_commands::start_system_audio_monitoring,
            audio::system_audio_commands::stop_system_audio_monitoring,
            audio::system_audio_commands::get_system_audio_monitoring_status,
            // Screen Recording permission commands
            audio::permissions::check_screen_recording_permission_command,
            audio::permissions::request_screen_recording_permission_command,
            audio::permissions::trigger_system_audio_permission_command,
            // Database import commands
            database::commands::check_first_launch,
            database::commands::select_legacy_database_path,
            database::commands::detect_legacy_database,
            database::commands::check_default_legacy_database,
            database::commands::check_homebrew_database,
            database::commands::import_and_initialize_database,
            database::commands::initialize_fresh_database,
            // Database and Models path commands
            database::commands::get_database_directory,
            database::commands::open_database_folder,
            whisper_engine::commands::open_models_folder,
            // Onboarding commands
            onboarding::get_onboarding_status,
            onboarding::save_onboarding_status_cmd,
            onboarding::reset_onboarding_status_cmd,
            onboarding::complete_onboarding,
            // System settings commands
            #[cfg(target_os = "macos")]
            utils::open_system_settings,
            // Retranscription commands
            audio::retranscription::start_retranscription_command,
            audio::retranscription::cancel_retranscription_command,
            audio::retranscription::is_retranscription_in_progress_command,
            // Import audio commands
            audio::import::select_and_validate_audio_command,
            audio::import::validate_audio_file_command,
            audio::import::start_import_audio_command,
            audio::import::cancel_import_command,
            audio::import::is_import_in_progress_command,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } if quit_guard::needs_save() && !quit_guard::allow_exit() => {
                    api.prevent_exit();
                    quit_guard::request(_app_handle);
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    tray::focus_main_window(_app_handle);
                }
                tauri::RunEvent::Exit => {
                    log::info!("Application exiting, cleaning up resources...");
                    tauri::async_runtime::block_on(async {
                        // Clean up database connection and checkpoint WAL
                        if let Some(app_state) = _app_handle.try_state::<state::AppState>() {
                            log::info!("Starting database cleanup...");
                            if let Err(e) = app_state.db_manager.cleanup().await {
                                log::error!("Failed to cleanup database: {}", e);
                            } else {
                                log::info!("Database cleanup completed successfully");
                            }
                        } else {
                            log::warn!("AppState not available for database cleanup (likely first launch)");
                        }

                        // Clean up sidecar
                        log::info!("Cleaning up sidecar...");
                        if let Err(e) = summary::summary_engine::force_shutdown_sidecar().await {
                            log::error!("Failed to force shutdown sidecar: {}", e);
                        }
                    });
                    log::info!("Application cleanup complete");
                }
                _ => {}
            }
        });
}
