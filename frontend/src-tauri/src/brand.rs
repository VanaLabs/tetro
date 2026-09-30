//! Tetro's waveform identity across the menu bar and macOS Dock.
//! Recording uses measured audio energy; processing uses a bounded opacity sequence.
//! A generation token cancels queued frames immediately when state or motion preference changes.
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager, Runtime};

mod recording_artwork;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Mode { Idle, Starting, Recording, Paused, Working }

static BACKEND: AtomicU8 = AtomicU8::new(Mode::Idle as u8);
static FRONTEND_BUSY: AtomicBool = AtomicBool::new(false);
static REDUCE_MOTION: AtomicBool = AtomicBool::new(false);
static LEVEL: AtomicU32 = AtomicU32::new(0);
static GENERATION: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
static MENU_BAR_DARK: AtomicBool = AtomicBool::new(false);

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
const LIVE_DARK: [&[u8]; 8] = [
    include_bytes!("../icons/letter/recording-0-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-1-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-2-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-3-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-4-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-5-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-6-dark.rgba").as_slice(),
    include_bytes!("../icons/letter/recording-7-dark.rgba").as_slice()
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
const DOCK: [&[u8]; 23] = [
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
    include_bytes!("../icons/letter/dock-working-11.png").as_slice(),
    include_bytes!("../icons/letter/dock-call.png").as_slice()
];

fn mode_from(value: u8) -> Mode {
    match value { 1 => Mode::Starting, 2 => Mode::Recording, 3 => Mode::Paused, 4 => Mode::Working, _ => Mode::Idle }
}

fn visual_mode(backend: Mode, busy: bool) -> Mode {
    if backend == Mode::Idle && busy { Mode::Working } else { backend }
}

fn meter(peak: f32) -> f32 {
    // Display normal speech across the full icon range; this never changes audio gain.
    if !peak.is_finite() || peak <= 0.0 { 0.0 } else { ((20.0 * peak.log10() + 48.0) / 36.0).clamp(0.0, 1.0) }
}

fn follow_level(current: f32, previous: f32) -> f32 { current.max(previous * 0.55) }

const PULSE_FRAMES: usize = 16; // Two seconds at the menu bar's 8Hz refresh rate.
fn pulse_phase(mode: Mode, step: usize, reduced: bool) -> Option<usize> {
    if mode == Mode::Recording && !reduced { Some(step % PULSE_FRAMES) } else { None }
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

fn tray_frame(mode: Mode, step: usize, level: f32, call: bool, dark: bool) -> (&'static [u8], usize) {
    let (rgba, dock) = frame(mode, step, level);
    if mode == Mode::Idle && call {
        (if dark { include_bytes!("../icons/letter/idle-call-dark.rgba") } else { include_bytes!("../icons/letter/idle-call.rgba") }, 22)
    } else if mode == Mode::Recording && dark {
        (LIVE_DARK[dock - 2], dock)
    } else {
        (rgba, dock)
    }
}

fn uses_template(mode: Mode, call: bool) -> bool {
    mode != Mode::Recording && !(mode == Mode::Idle && call)
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
    // Static meeting artwork must also follow a menu-bar appearance change.
    // Query the status button's actual appearance, independent of app theme.
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let next = handle.clone();
                if handle.run_on_main_thread(move || {
                    if let Some(tray) = next.tray_by_id("main-tray") {
                        let dark = menu_bar_is_dark(&tray);
                        if MENU_BAR_DARK.swap(dark, Ordering::SeqCst) != dark { refresh(&next); }
                    }
                }).is_err() { break; }
            }
        });
    }
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
    let name = crate::app_profile::NAME;
    let status = match mode { Mode::Idle if crate::call_detection::call_active() => "Microphone in use · Record this call", Mode::Idle => "Ready", Mode::Starting => "Starting recording", Mode::Recording => "Recording", Mode::Paused => "Recording paused", Mode::Working => "Processing recording" };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(format!("{name} · {status}")));
    }
    show_frame(app, mode, 0, if reduced { 1.0 } else { 0.0 }, generation, true);
    if reduced || matches!(mode, Mode::Idle | Mode::Paused) { return; }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut step = 0usize;
        let mut last_frame = (usize::MAX, None);
        let mut last_dock = (usize::MAX, None);
        let mut energy = 0.0f32;
        loop {
            tokio::time::sleep(Duration::from_millis(125)).await;
            if GENERATION.load(Ordering::SeqCst) != generation { break; }
            step += 1;
            energy = follow_level(f32::from_bits(LEVEL.load(Ordering::Relaxed)), energy);
            let (_, index) = frame(mode, step, energy);
            let key = (index, pulse_phase(mode, step, false));
            let update_dock = step % 2 == 0 && key != last_dock;
            if key != last_frame || update_dock {
                // Dock refresh is capped at 4Hz; the menu bar may update at 8Hz.
                show_frame(&handle, mode, step, energy, generation, update_dock);
                last_frame = key;
                if update_dock { last_dock = key; }
            }
        }
    });
}

fn show_frame<R: Runtime>(app: &AppHandle<R>, mode: Mode, step: usize, level: f32, generation: u64, dock: bool) {
    let handle = app.clone();
    let call = crate::call_detection::call_active();
    let _ = app.run_on_main_thread(move || {
        if GENERATION.load(Ordering::SeqCst) != generation { return; }
        let pulse = pulse_phase(mode, step, REDUCE_MOTION.load(Ordering::SeqCst));
        if let Some(tray) = handle.tray_by_id("main-tray") {
            let dark = menu_bar_is_dark(&tray);
            #[cfg(target_os = "macos")]
            MENU_BAR_DARK.store(dark, Ordering::SeqCst);
            let (rgba, _) = tray_frame(mode, step, level, call, dark);
            let icon = if mode == Mode::Recording {
                let (_, index) = frame(mode, step, level);
                let base = if dark { LIVE_DARK[0] } else { LIVE[0] };
                tauri::image::Image::new_owned(recording_artwork::tray(base, index - 2, dark, pulse), 36, 36)
            } else if mode == Mode::Idle && call {
                tauri::image::Image::new_owned(recording_artwork::meeting_tray(rgba, dark), 36, 36)
            } else { tauri::image::Image::new(rgba, 36, 36) };
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_icon_as_template(uses_template(mode, call));
        }
        if dock { set_dock_icon(tray_frame(mode, step, level, call, false).1, pulse); }
    });
}

#[cfg(not(target_os = "macos"))]
fn menu_bar_is_dark<R: Runtime>(_: &tauri::tray::TrayIcon<R>) -> bool { false }

#[cfg(target_os = "macos")]
fn menu_bar_is_dark<R: Runtime>(tray: &tauri::tray::TrayIcon<R>) -> bool {
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::{Object, YES};
    tray.with_inner_tray_icon(|inner| {
        let Some(item) = inner.ns_status_item() else { return false; };
        let item = std::ptr::from_ref(&*item).cast::<Object>() as *mut Object;
        objc::rc::autoreleasepool(|| unsafe {
            let button: *mut Object = msg_send![item, button];
            if button.is_null() { return false; }
            let appearance: *mut Object = msg_send![button, effectiveAppearance];
            let light: *mut Object = msg_send![class!(NSString), stringWithUTF8String: b"NSAppearanceNameAqua\0".as_ptr()];
            let dark: *mut Object = msg_send![class!(NSString), stringWithUTF8String: b"NSAppearanceNameDarkAqua\0".as_ptr()];
            let objects = [light, dark];
            let names: *mut Object = msg_send![class!(NSArray), arrayWithObjects: objects.as_ptr() count: objects.len()];
            let best: *mut Object = msg_send![appearance, bestMatchFromAppearancesWithNames: names];
            let matches: objc::runtime::BOOL = msg_send![best, isEqualToString: dark];
            matches == YES
        })
    }).unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn native_reduced_motion() -> bool { false }
#[cfg(not(target_os = "macos"))]
fn set_dock_icon(_: usize, _: Option<usize>) {}

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
fn set_dock_icon(index: usize, pulse: Option<usize>) {
    use objc::{class, msg_send, sel, sel_impl};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use objc::runtime::Object;
    struct NativeImage(*mut Object, std::time::Instant);
    impl Drop for NativeImage {
        fn drop(&mut self) { unsafe { let _: () = msg_send![self.0, release]; } }
    }
    thread_local! { static CACHE: RefCell<HashMap<(usize, Option<usize>), NativeImage>> = RefCell::new(HashMap::new()); }
    // Only called by show_frame's main-thread closure. NSImage cache never crosses threads.
    objc::rc::autoreleasepool(|| unsafe {
        CACHE.with(|cache| {
            let mut cache = cache.borrow_mut();
            let key = (index, pulse);
            // A pulse has more combinations than static artwork. Bound the retained
            // native bitmaps, evicting the least recently used frame before a miss.
            if cache.len() >= 24 && !cache.contains_key(&key) {
                if let Some(old) = cache.iter().min_by_key(|(_, image)| image.1).map(|(key, _)| *key) {
                    cache.remove(&old);
                }
            }
            let image = cache.entry(key).or_insert_with(|| {
                // Grow the bars over the approved quiet frame, preserving its gradient,
                // central stem and recording badge. Cache each completed native image.
                let bytes = DOCK[if (2..10).contains(&index) { 2 } else { index }];
                let data: *mut Object = msg_send![class!(NSData), dataWithBytes:bytes.as_ptr() length:bytes.len()];
                let allocated: *mut Object = msg_send![class!(NSImage), alloc];
                let image: *mut Object = msg_send![allocated, initWithData:data];
                if !image.is_null() && (2..10).contains(&index) {
                    recording_artwork::draw_dock(image, index - 2, pulse);
                }
                NativeImage(image, std::time::Instant::now())
            });
            image.1 = std::time::Instant::now();
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
        let (call, dock) = tray_frame(Mode::Idle, 0, 0.0, true, false);
        assert_eq!(call.len(), 36 * 36 * 4);
        assert_eq!(dock, 22);
        assert_ne!(call, frame(Mode::Idle, 0, 0.0).0);
        for mode in [Mode::Starting, Mode::Recording, Mode::Paused, Mode::Working] {
            assert_eq!(tray_frame(mode, 3, 0.5, true, false), frame(mode, 3, 0.5));
        }
    }
    #[test]
    fn colored_states_choose_readable_variants_and_keep_their_dots() {
        for mode in [Mode::Idle, Mode::Recording] {
            let (light, dock) = tray_frame(mode, 0, 1.0, true, false);
            let (dark, dark_dock) = tray_frame(mode, 0, 1.0, true, true);
            assert_ne!(light, dark);
            assert_eq!(dock, dark_dock);
            assert!(!uses_template(mode, true));
            assert!(light.chunks_exact(4).any(|p| p[0] != p[1] && p[3] > 0));
            assert!(dark.chunks_exact(4).any(|p| p[0] != p[1] && p[3] > 0));
        }
        for mode in [Mode::Paused, Mode::Working, Mode::Starting] { assert!(uses_template(mode, true)); }
        assert!(uses_template(Mode::Idle, false));
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
        assert_eq!(meter(0.001), 0.0);
        assert!(meter(0.25) > 0.99, "normal speech peaks should reach the full artwork range");
    }
    #[test]
    fn waveform_falls_promptly_after_audio_stops() {
        let mut energy = 1.0;
        for _ in 0..4 { energy = follow_level(0.0, energy); }
        assert!(energy < 0.1, "waveform should settle in half a second");
        assert_eq!(follow_level(0.9, 0.1), 0.9);
    }
    #[test]
    fn pulse_continues_at_constant_audio_but_stops_for_pause_and_reduce_motion() {
        assert_ne!(pulse_phase(Mode::Recording, 0, false), pulse_phase(Mode::Recording, 1, false));
        assert_eq!(pulse_phase(Mode::Recording, PULSE_FRAMES, false), Some(0));
        assert_eq!(pulse_phase(Mode::Recording, 1, true), None);
        for mode in [Mode::Idle, Mode::Paused, Mode::Starting, Mode::Working] {
            assert_eq!(pulse_phase(mode, 1, false), None);
        }
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
