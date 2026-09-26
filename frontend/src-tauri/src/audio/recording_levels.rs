//! Live input levels while recording, for the recorder bar's meter and the
//! "nothing heard" warning. Capture threads record the loudest sample per device; a small
//! task sends one combined reading to the window about ten times a second.

use super::recording_state::DeviceType;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

static MIC_PEAK: AtomicU32 = AtomicU32::new(0);
static SYSTEM_PEAK: AtomicU32 = AtomicU32::new(0);
static EMITTER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Called from the capture path with each chunk. Positive IEEE floats order like their
/// bit patterns, so `fetch_max` on the bits keeps the loudest value without locks.
pub fn record(device: &DeviceType, samples: &[f32]) {
    let peak = samples.iter().fold(0.0f32, |m, &x| m.max(x.abs())).min(1.0);
    let slot = match device { DeviceType::Microphone => &MIC_PEAK, DeviceType::System => &SYSTEM_PEAK };
    slot.fetch_max(peak.to_bits(), Ordering::Relaxed);
}

fn take(slot: &AtomicU32) -> f32 {
    f32::from_bits(slot.swap(0, Ordering::Relaxed))
}

#[derive(Serialize, Clone)]
struct Levels { mic: f32, system: f32 }

/// Starts the emitter for this recording; it stops by itself when `is_live` turns false.
pub fn start<R: Runtime>(app: AppHandle<R>, is_live: fn() -> bool) {
    if EMITTER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    take(&MIC_PEAK);
    take(&SYSTEM_PEAK);
    tauri::async_runtime::spawn(async move {
        while is_live() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let _ = app.emit("recording-levels", Levels { mic: take(&MIC_PEAK), system: take(&SYSTEM_PEAK) });
        }
        let _ = app.emit("recording-levels", Levels { mic: 0.0, system: 0.0 });
        EMITTER_RUNNING.store(false, Ordering::SeqCst);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_loudest_peak_until_read() {
        record(&DeviceType::Microphone, &[0.1, -0.4, 0.2]);
        record(&DeviceType::Microphone, &[0.3]);
        assert!((take(&MIC_PEAK) - 0.4).abs() < 1e-6);
        assert_eq!(take(&MIC_PEAK), 0.0);
    }
}
