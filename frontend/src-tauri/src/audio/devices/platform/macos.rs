use anyhow::Result;
use cidre::core_audio as ca;

use crate::audio::devices::configuration::{AudioDevice, DeviceType};

/// Read device metadata without opening AudioUnits. CPAL's input/output filters
/// initialize every device to query formats, which can stall alongside a tap
/// even though listing devices needs no recording stream or permission.
pub fn configure_macos_audio(_host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    let metadata = ca::System::devices().map_err(|e| anyhow::anyhow!("Could not list audio devices: {e:?}"))?
        .into_iter().filter_map(|device| {
            let name = device.name().ok()?.to_string();
            let input = device.input_stream_cfg().map(|cfg| cfg.buffers().iter().take(cfg.number_buffers()).any(|b| b.number_channels > 0)).unwrap_or(false);
            let output = device.output_stream_cfg().map(|cfg| cfg.buffers().iter().take(cfg.number_buffers()).any(|b| b.number_channels > 0)).unwrap_or(false);
            Some((name, input, output))
        }).collect::<Vec<_>>();
    Ok(classify_devices(&metadata))
}

fn classify_devices(metadata: &[(String, bool, bool)]) -> Vec<AudioDevice> {
    let mut devices = Vec::new();
    for (name, input, _) in metadata {
        if *input { devices.push(AudioDevice::new(name.clone(), DeviceType::Input)); }
    }

    // Filter function to exclude macOS built-in speakers for output devices
    // NOTE: AirPods and other Bluetooth devices are now allowed (with device monitoring for disconnect handling)
    fn should_include_output_device(name: &str) -> bool {
        // Only filter out built-in speakers (they don't typically capture system audio properly)
        !name.to_lowercase().contains("speakers")
    }

    for (name, _, output) in metadata {
        if *output && should_include_output_device(name) {
            devices.push(AudioDevice::new(name.clone(), DeviceType::Output));
        }
    }
    devices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_metadata_preserves_input_output_and_duplex_devices() {
        let devices = classify_devices(&[
            ("USB mic".into(), true, false),
            ("AirPods".into(), true, true),
            ("HDMI".into(), false, true),
            ("Offline".into(), false, false),
        ]);
        assert_eq!(devices, vec![
            AudioDevice::new("USB mic".into(), DeviceType::Input),
            AudioDevice::new("AirPods".into(), DeviceType::Input),
            AudioDevice::new("AirPods".into(), DeviceType::Output),
            AudioDevice::new("HDMI".into(), DeviceType::Output),
        ]);
    }

    #[test]
    fn metadata_classification_keeps_existing_speaker_filter() {
        let devices = classify_devices(&[("MacBook Air Speakers".into(), false, true)]);
        assert!(devices.is_empty());
    }
}
