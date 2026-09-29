//! Independent Tetro input gates. Muting preserves stream timing with silence;
//! it never changes the system's microphone or playback volume.
use super::recording_state::DeviceType;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Runtime};

const MIC: u64 = 1;
const SYSTEM: u64 = 2;
const FLAGS: u64 = MIC | SYSTEM;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct InputState {
    pub microphone_muted: bool,
    pub system_muted: bool,
    pub revision: u64,
}

impl InputState {
    pub fn is_muted(&self, device: &DeviceType) -> bool {
        match device {
            DeviceType::Microphone => self.microphone_muted,
            DeviceType::System => self.system_muted,
        }
    }

    pub fn apply(&self, device: &DeviceType, samples: &mut [f32]) {
        if self.is_muted(device) { samples.fill(0.0); }
    }
}

// Flags and revision share one atomic snapshot so old IPC replies cannot undo
// a newer input choice. Choices remain visible between recording sessions.
struct InputControls(AtomicU64);
impl InputControls {
    const fn new() -> Self { Self(AtomicU64::new(0)) }

    fn state(&self) -> InputState {
        Self::decode(self.0.load(Ordering::SeqCst))
    }

    fn decode(value: u64) -> InputState {
        InputState { microphone_muted: value & MIC != 0, system_muted: value & SYSTEM != 0, revision: value >> 2 }
    }

    fn set(&self, flag: u64, muted: bool) -> InputState {
        let old = self.0.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |old| {
            let flags = if muted { (old & FLAGS) | flag } else { (old & FLAGS) & !flag };
            Some(((old & !FLAGS) + 4) | flags)
        }).expect("input update always succeeds");
        let flags = if muted { (old & FLAGS) | flag } else { (old & FLAGS) & !flag };
        Self::decode(((old & !FLAGS) + 4) | flags)
    }
}

static INPUTS: InputControls = InputControls::new();
pub fn state() -> InputState { INPUTS.state() }

#[tauri::command]
pub fn get_recording_inputs() -> InputState { state() }

#[tauri::command]
pub fn set_recording_input_muted<R: Runtime>(app: AppHandle<R>, input: String, muted: bool) -> Result<InputState, String> {
    let flag = match input.as_str() {
        "microphone" => MIC,
        "system" => SYSTEM,
        _ => return Err("Unknown recording input".into()),
    };
    let next = INPUTS.set(flag, muted);
    let _ = app.emit("recording-inputs-changed", next);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inputs_mute_independently_and_unmute_without_changing_timing() {
        let controls = InputControls::new();
        let mut mic = vec![0.2, -0.5, 0.8];
        let mut system = mic.clone();
        let muted = controls.set(MIC, true);
        muted.apply(&DeviceType::Microphone, &mut mic);
        muted.apply(&DeviceType::System, &mut system);
        assert_eq!(mic, vec![0.0; 3]);
        assert_eq!(system, vec![0.2, -0.5, 0.8]);
        let both = controls.set(SYSTEM, true);
        both.apply(&DeviceType::System, &mut system);
        assert_eq!(system, vec![0.0; 3]);
        let next = controls.set(MIC, false);
        assert!(!next.microphone_muted && next.system_muted);
        assert!(next.revision > both.revision && both.revision > muted.revision);
        mic = vec![0.2, -0.5, 0.8];
        next.apply(&DeviceType::Microphone, &mut mic);
        assert_eq!(mic, vec![0.2, -0.5, 0.8]);
    }
}
