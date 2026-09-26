//! The letter T identity across the menu bar and macOS Dock.
//! Recording uses measured audio energy; processing uses a bounded opacity sequence.
//! A generation token cancels queued frames immediately when state or motion preference changes.
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager, Runtime};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Mode { Idle, Starting, Recording, Paused, Working }

static BACKEND: AtomicU8 = AtomicU8::new(Mode::Idle as u8);
static FRONTEND_BUSY: AtomicBool = AtomicBool::new(false);
static REDUCE_MOTION: AtomicBool = AtomicBool::new(false);
static LEVEL: AtomicU32 = AtomicU32::new(0);
static GENERATION: AtomicU64 = AtomicU64::new(0);

const LIVE: [&[u8]; 8] = [
    include_bytes!("../icons/letter/recording-0.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-1.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-2.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-3.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-4.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-5.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-6.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-7.rgba").as_slice()
];
const WORKING: [&[u8]; 12] = [
    include_bytes!("../icons/letter/working-0.rgba").as_slice(),
    include_bytes!("../icons/letter/working-1.rgba").as_slice(),
    include_bytes!("../icons/letter/working-2.rgba").as_slice(),
    include_bytes!("../icons/letter/working-3.rgba").as_slice(),
    include_bytes!("../icons/letter/working-4.rgba").as_slice(),
    include_bytes!("../icons/letter/working-5.rgba").as_slice(),
    include_bytes!("../icons/letter/working-6.rgba").as_slice(),
    include_bytes!("../icons/letter/working-7.rgba").as_slice(),
    include_bytes!("../icons/letter/working-8.rgba").as_slice(),
    include_bytes!("../icons/letter/working-9.rgba").as_slice(),
    include_bytes!("../icons/letter/working-10.rgba").as_slice(),
    include_bytes!("../icons/letter/working-11.rgba").as_slice()
];
#[cfg(target_os = "macos")]
const DOCK: [&[u8]; 22] = [
    include_bytes!("../icons/letter/dock-idle.png").as_slice(),
    include_bytes!("../icons/letter/dock-paused.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-0.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-1.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-2.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-3.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-4.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-5.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-6.png").as_slice(),
    include_bytes!("../icons/letter/dock-recording-7.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-0.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-1.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-2.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-3.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-4.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-5.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-6.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-7.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-8.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-9.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-10.png").as_slice(),
    include_bytes!("../icons/letter/dock-working-11.png").as_slice()
];

fn mode_from(value: u8) -> Mode {
    match value { 1 => Mode::Starting, 2 => Mode::Recording, 3 => Mode::Paused, 4 => Mode::Working, _ => Mode::Idle }
}

fn visual_mode(backend: Mode, busy: bool) -> Mode {
    if backend == Mode::Idle && busy { Mode::Working } else { backend }
}

fn meter(peak: f32) -> f32 {
    if !peak.is_finite() || peak <= 0.0 { 0.0 } else { ((20.0 * peak.log10() + 54.0) / 54.0).clamp(0.0, 1.0) }
}

fn frame(mode: Mode, step: usize, level: f32) -> (&'static [u8], usize) {
    match mode {
        Mode::Idle => (include_bytes!("../icons/letter/idle.rgba"), 0),
        Mode::Paused => (include_bytes!("../icons/letter/paused.rgba"), 1),
        Mode::Recording => {
            let index = (level.clamp(0.0, 1.0) * 7.0).round() as usize;
            (LIVE[index], 2 + index)
        }
        Mode::Starting | Mode::Working => {
            let index = step % WORKING.len();
            (WORKING[index], 10 + index)
        }
    }
}

fn tray_frame(mode: Mode, step: usize, level: f32, call: bool) -> (&'static [u8], usize) {
    let (rgba, dock) = frame(mode, step, level);
    if mode == Mode::Idle && call {
        (include_bytes!("../icons/letter/idle-call.rgba"), dock)
    } else {
        (rgba, dock)
    }
}

pub fn call_state_changed<R: Runtime>(app: &AppHandle<R>) { refresh(app); }

#[derive(Deserialize)]
struct Levels { mic: f32, system: f32 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiState { processing: bool, reduced_motion: bool }

pub fn initialize<R: Runtime>(app: &AppHandle<R>) {
    REDUCE_MOTION.store(native_reduced_motion(), Ordering::SeqCst);
    app.listen("recording-levels", |event| {
        if let Ok(levels) = serde_json::from_str::<Levels>(event.payload()) {
            LEVEL.store(meter(levels.mic.max(levels.system)).to_bits(), Ordering::Relaxed);
        }
    });
    let handle = app.clone();
    app.listen("tetro-brand-ui", move |event| {
        if let Ok(ui) = serde_json::from_str::<UiState>(event.payload()) {
            let busy_changed = FRONTEND_BUSY.swap(ui.processing, Ordering::SeqCst) != ui.processing;
            let motion_changed = REDUCE_MOTION.swap(ui.reduced_motion, Ordering::SeqCst) != ui.reduced_motion;
            if busy_changed || motion_changed { refresh(&handle); }
        }
    });
    refresh(app);
}

pub fn recording_state<R: Runtime>(app: &AppHandle<R>, state: &crate::tray::RecordingState) {
    use crate::tray::RecordingState;
    let next = match state {
        RecordingState::Stopped => Mode::Idle,
        RecordingState::Starting | RecordingState::Resuming => Mode::Starting,
        RecordingState::Recording => Mode::Recording,
        RecordingState::Pausing | RecordingState::Paused => Mode::Paused,
        RecordingState::Stopping => Mode::Working,
    };
    if BACKEND.swap(next as u8, Ordering::SeqCst) != next as u8 {
        if next != Mode::Recording { LEVEL.store(0, Ordering::Relaxed); }
        refresh(app);
    }
}

fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let mode = visual_mode(mode_from(BACKEND.load(Ordering::SeqCst)), FRONTEND_BUSY.load(Ordering::SeqCst));
    let reduced = REDUCE_MOTION.load(Ordering::SeqCst);
    let name = if crate::app_profile::is_development() { "Tetro Dev" } else { "Tetro" };
    let status = match mode { Mode::Idle if crate::call_detection::call_active() => "Microphone in use · Record this call", Mode::Idle => "Ready", Mode::Starting => "Starting recording", Mode::Recording => "Recording", Mode::Paused => "Recording paused", Mode::Working => "Processing recording" };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(format!("{name} · {status}")));
    }
    show_frame(app, mode, 0, if reduced { 1.0 } else { 0.0 }, generation, true);
    if reduced || matches!(mode, Mode::Idle | Mode::Paused) { return; }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut step = 0usize;
        let mut last_frame = usize::MAX;
        let mut last_dock = usize::MAX;
        let mut energy = 0.0f32;
        loop {
            tokio::time::sleep(Duration::from_millis(125)).await;
            if GENERATION.load(Ordering::SeqCst) != generation { break; }
            step += 1;
            energy = f32::from_bits(LEVEL.load(Ordering::Relaxed)).max(energy * 0.78);
            let (_, index) = frame(mode, step, energy);
            let update_dock = step % 2 == 0 && index != last_dock;
            if index != last_frame || update_dock {
                // Dock refresh is capped at 4Hz; the menu bar may update at 8Hz.
                show_frame(&handle, mode, step, energy, generation, update_dock);
                last_frame = index;
                if update_dock { last_dock = index; }
            }
        }
    });
}

fn show_frame<R: Runtime>(app: &AppHandle<R>, mode: Mode, step: usize, level: f32, generation: u64, dock: bool) {
    let handle = app.clone();
    let (rgba, dock_index) = tray_frame(mode, step, level, crate::call_detection::call_active());
    let _ = app.run_on_main_thread(move || {
        if GENERATION.load(Ordering::SeqCst) != generation { return; }
        if let Some(tray) = handle.tray_by_id("main-tray") {
            let _ = tray.set_icon(Some(tauri::image::Image::new(rgba, 36, 36)));
            let _ = tray.set_icon_as_template(true);
        }
        if dock { set_dock_icon(dock_index); }
    });
}

#[cfg(not(target_os = "macos"))]
fn native_reduced_motion() -> bool { false }
#[cfg(not(target_os = "macos"))]
fn set_dock_icon(_: usize) {}

#[cfg(target_os = "macos")]
fn native_reduced_motion() -> bool {
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let workspace: *mut objc::runtime::Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let reduced: objc::runtime::BOOL = msg_send![workspace, accessibilityDisplayShouldReduceMotion];
        reduced == objc::runtime::YES
    }
}

#[cfg(target_os = "macos")]
fn set_dock_icon(index: usize) {
    use objc::{class, msg_send, sel, sel_impl};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use objc::runtime::Object;
    struct NativeImage(*mut Object);
    impl Drop for NativeImage {
        fn drop(&mut self) { unsafe { let _: () = msg_send![self.0, release]; } }
    }
    thread_local! { static CACHE: RefCell<HashMap<usize, NativeImage>> = RefCell::new(HashMap::new()); }
    // Only called by show_frame's main-thread closure. NSImage cache never crosses threads.
    objc::rc::autoreleasepool(|| unsafe {
        CACHE.with(|cache| {
            let mut cache = cache.borrow_mut();
            let image = cache.entry(index).or_insert_with(|| {
                let bytes = DOCK[index];
                let data: *mut Object = msg_send![class!(NSData), dataWithBytes:bytes.as_ptr() length:bytes.len()];
                let allocated: *mut Object = msg_send![class!(NSImage), alloc];
                let image: *mut Object = msg_send![allocated, initWithData:data];
                NativeImage(image)
            });
            if !image.0.is_null() {
                let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
                let _: () = msg_send![app, setApplicationIconImage:image.0];
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn call_hint_uses_the_same_canvas_and_never_overrides_recording() {
        let (call, dock) = tray_frame(Mode::Idle, 0, 0.0, true);
        assert_eq!(call.len(), 36 * 36 * 4);
        assert_eq!(dock, 0);
        assert_ne!(call, frame(Mode::Idle, 0, 0.0).0);
        for mode in [Mode::Starting, Mode::Recording, Mode::Paused, Mode::Working] {
            assert_eq!(tray_frame(mode, 3, 0.5, true), frame(mode, 3, 0.5));
        }
    }
    #[test]
    fn native_recording_and_pause_win_over_frontend_processing() {
        assert_eq!(visual_mode(Mode::Recording, true), Mode::Recording);
        assert_eq!(visual_mode(Mode::Paused, true), Mode::Paused);
        assert_eq!(visual_mode(Mode::Idle, true), Mode::Working);
        assert_eq!(visual_mode(Mode::Idle, false), Mode::Idle);
    }
    #[test]
    fn audio_meter_rejects_invalid_and_silent_input() {
        assert_eq!(meter(f32::NAN), 0.0);
        assert_eq!(meter(f32::INFINITY), 0.0);
        assert_eq!(meter(0.0), 0.0);
        assert_eq!(meter(-1.0), 0.0);
        assert_eq!(meter(1.0), 1.0);
        assert!((0.0..1.0).contains(&meter(0.03)));
    }
    #[test]
    fn all_animation_frames_are_complete_rgba_and_indices_are_bounded() {
        for mode in [Mode::Idle, Mode::Starting, Mode::Recording, Mode::Paused, Mode::Working] {
            for step in 0..40 {
                for level in [0.0, 0.2, 1.0, 3.0] {
                    let (bytes, index) = frame(mode, step, level);
                    assert_eq!(bytes.len(), 36 * 36 * 4);
                    assert!(index < 22);
                }
            }
        }
    }
}
