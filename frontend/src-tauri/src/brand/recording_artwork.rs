//! Status indicators stay inside the interlocking T's central window.

const CENTER_X: f32 = 18.125;
const CENTER_Y: f32 = 10.75;

/// The entire opening stays colored and breathes; the selected T remains fixed.
pub(super) fn tray(base: &[u8], _frame: usize, _dark: bool, phase: Option<usize>) -> Vec<u8> {
    let mut pixels = base.to_vec();
    window(&mut pixels, [255, 59, 48], opacity(phase, 1.6));
    pixels
}

pub(super) fn meeting_tray(base: &[u8], dark: bool, phase: Option<usize>) -> Vec<u8> {
    let mut pixels = base.to_vec();
    window(&mut pixels, if dark { [48, 209, 88] } else { [40, 177, 76] }, opacity(phase, 3.0));
    pixels
}

/// Four samples per pixel retain crisp edges at an 18pt menu-bar size.
fn window(pixels: &mut [u8], color: [u8; 3], opacity: f32) {
    for y in 0..36 {
        for x in 0..36 {
            let (mut edge, mut fill) = (0, 0);
            for dy in [0.25, 0.75] {
                for dx in [0.25, 0.75] {
                    edge += inside_window(x as f32 + dx, y as f32 + dy, 0.12) as u8;
                    fill += inside_window(x as f32 + dx, y as f32 + dy, 0.45) as u8;
                }
            }
            let pixel = &mut pixels[(y * 36 + x) * 4..][..4];
            blend(pixel, [250, 249, 246], edge as f32 / 4.0);
            blend(pixel, color, fill as f32 / 4.0 * opacity);
        }
    }
}

fn inside_window(x: f32, y: f32, inset: f32) -> bool {
    let (half_width, half_height, radius) = (5.375 - inset, 3.25 - inset, 1.0 - inset);
    let (dx, dy) = ((x - CENTER_X).abs(), (y - CENTER_Y).abs());
    if dx > half_width || dy > half_height { return false; }
    let (corner_x, corner_y) = ((dx - half_width + radius).max(0.0), (dy - half_height + radius).max(0.0));
    corner_x * corner_x + corner_y * corner_y <= radius * radius
}

fn blend(pixel: &mut [u8], color: [u8; 3], coverage: f32) {
    if coverage <= 0.0 { return; }
    let remainder = pixel[3] as f32 / 255.0 * (1.0 - coverage);
    let alpha = coverage + remainder;
    for c in 0..3 { pixel[c] = ((color[c] as f32 * coverage + pixel[c] as f32 * remainder) / alpha).round() as u8; }
    pixel[3] = (alpha * 255.0).round() as u8;
}

fn opacity(phase: Option<usize>, period: f32) -> f32 {
    let Some(phase) = phase else { return 1.0; };
    let seconds = (phase % super::PULSE_FRAMES) as f32 * 0.125;
    let pulse = (1.0 - (std::f32::consts::TAU * (seconds % period) / period).cos()) / 2.0;
    0.64 + 0.36 * pulse
}

#[cfg(target_os = "macos")]
pub(super) unsafe fn draw_dock(image: *mut objc::runtime::Object, _frame: usize, phase: Option<usize>) {
    draw_dock_window(image, [255, 59, 48], opacity(phase, 1.6));
}

#[cfg(target_os = "macos")]
pub(super) unsafe fn draw_meeting_dock(image: *mut objc::runtime::Object, phase: Option<usize>) {
    draw_dock_window(image, [52, 199, 89], opacity(phase, 3.0));
}

#[cfg(target_os = "macos")]
unsafe fn draw_dock_window(image: *mut objc::runtime::Object, color: [u8; 3], opacity: f32) {
    use core_graphics::context::CGContext;
    use objc::{class, msg_send, sel, sel_impl};
    let _: () = msg_send![image, lockFocus];
    let graphics: *mut objc::runtime::Object = msg_send![class!(NSGraphicsContext), currentContext];
    let raw: *mut core_graphics::sys::CGContext = msg_send![graphics, CGContext];
    if !raw.is_null() {
        let context = CGContext::from_existing_context_ptr(raw);
        // Matches the generated 256px Dock artwork. Core Graphics has a bottom-left origin.
        let path = |inset: f64| {
            let (cx, cy, scale) = (128.53125, 256.0 - 97.1875, 4.25);
            let (w, h, r) = ((5.375 - inset) * scale, (3.25 - inset) * scale, (1.0 - inset) * scale);
            let (left, right, bottom, top) = (cx - w, cx + w, cy - h, cy + h);
            context.begin_path(); context.move_to_point(left + r, bottom);
            context.add_line_to_point(right - r, bottom); context.add_quad_curve_to_point(right, bottom, right, bottom + r);
            context.add_line_to_point(right, top - r); context.add_quad_curve_to_point(right, top, right - r, top);
            context.add_line_to_point(left + r, top); context.add_quad_curve_to_point(left, top, left, top - r);
            context.add_line_to_point(left, bottom + r); context.add_quad_curve_to_point(left, bottom, left + r, bottom); context.close_path();
        };
        context.save(); path(0.0); context.clip();
        context.set_rgb_fill_color(250.0 / 255.0, 249.0 / 255.0, 246.0 / 255.0, 1.0); path(0.12); context.fill_path();
        context.set_rgb_fill_color(color[0] as f64 / 255.0, color[1] as f64 / 255.0, color[2] as f64 / 255.0, opacity as f64); path(0.45); context.fill_path();
        context.restore();
    }
    let _: () = msg_send![image, unlockFocus];
}

#[cfg(test)]
mod tests {
    use super::*;
    fn base(dark: bool) -> &'static [u8] {
        if dark { include_bytes!("../../icons/letter/idle-dark.rgba") }
        else { include_bytes!("../../icons/letter/idle.rgba") }
    }
    fn assert_outside_window_unchanged(original: &[u8], pixels: &[u8]) {
        for y in 0..36 {
            for x in 0..36 {
                if (13..24).contains(&x) && (7..14).contains(&y) { continue; }
                let i = (y * 36 + x) * 4;
                assert_eq!(&pixels[i..i + 4], &original[i..i + 4], "changed silhouette at {x},{y}");
            }
        }
    }
    #[test]
    fn every_pulse_preserves_the_selected_silhouette_and_keeps_red_visible() {
        for dark in [false, true] {
            for frame in 0..8 {
                for phase in 0..super::super::PULSE_FRAMES {
                    let pixels = tray(base(dark), frame, dark, Some(phase));
                    assert_outside_window_unchanged(base(dark), &pixels);
                    let center = (10 * 36 + 18) * 4;
                    let signal = &pixels[center..center + 4];
                    assert_eq!(signal[3], 255);
                    assert!(signal[0] > 240 && signal[1] < 150 && signal[2] < 140);
                }
            }
        }
    }
    #[test]
    fn meeting_window_stays_green_in_both_appearances_through_the_whole_pulse() {
        for dark in [false, true] {
            for phase in 0..super::super::PULSE_FRAMES {
                let pixels = meeting_tray(base(dark), dark, Some(phase));
                assert_outside_window_unchanged(base(dark), &pixels);
                let center = (10 * 36 + 18) * 4;
                let signal = &pixels[center..center + 4];
                assert_eq!(signal[3], 255);
                assert!(signal[1] > signal[0] && signal[1] > signal[2]);
            }
        }
    }
    #[test]
    fn windows_pulse_at_the_approved_rates_and_reduce_motion_holds_them_bright() {
        let original = base(true);
        let bright = tray(original, 0, true, None);
        assert_eq!(bright, tray(original, usize::MAX, true, None));
        assert_ne!(bright, tray(original, 0, true, Some(0)));
        assert_eq!(tray(original, 0, true, Some(0)), tray(original, 0, true, Some(64)));
        assert!(opacity(Some(6), 1.6) > 0.99);
        assert_eq!(opacity(None, 1.6), 1.0);
        assert_eq!(opacity(Some(0), 3.0), 0.64);
        assert_eq!(opacity(Some(12), 3.0), 1.0);
        assert_eq!(meeting_tray(original, true, Some(12)), meeting_tray(original, true, None));
        assert_eq!(meeting_tray(original, true, Some(0)), meeting_tray(original, true, Some(24)));
    }
    #[test]
    fn paused_and_processing_assets_keep_the_same_outer_shape() {
        for pixels in std::iter::once(include_bytes!("../../icons/letter/paused.rgba").as_slice()).chain(super::super::WORKING.iter().copied()) {
            assert_outside_window_unchanged(base(false), pixels);
            assert_ne!(base(false), pixels);
        }
    }
    #[test]
    fn export_native_renderer_previews_when_requested() {
        if let Some(directory) = std::env::var_os("TETRO_ICON_PREVIEW_DIR") {
            let directory = std::path::PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            for dark in [false, true] {
                let appearance = if dark { "dark" } else { "light" };
                std::fs::write(directory.join(format!("meeting-{appearance}.rgba")), meeting_tray(base(dark), dark, None)).unwrap();
                for frame in 0..8 {
                    std::fs::write(directory.join(format!("tray-{appearance}-{frame}.rgba")), tray(base(dark), frame, dark, None)).unwrap();
                }
                for phase in 0..super::super::PULSE_FRAMES {
                    std::fs::write(directory.join(format!("pulse-{appearance}-{phase}.rgba")), tray(base(dark), 4, dark, Some(phase))).unwrap();
                    std::fs::write(directory.join(format!("meeting-{appearance}-{phase}.rgba")), meeting_tray(base(dark), dark, Some(phase))).unwrap();
                }
            }
            #[cfg(target_os = "macos")]
            export_dock_previews(&directory);
        }
    }

    #[cfg(target_os = "macos")]
    fn export_dock_previews(directory: &std::path::Path) {
        use objc::{class, msg_send, sel, sel_impl};
        use objc::runtime::Object;
        // Offscreen NSImages exercise the exact renderer used by the Dock.
        objc::rc::autoreleasepool(|| unsafe {
            for (name, meeting, phase) in [("red-bright", false, None), ("red-dim", false, Some(0)), ("red-pulse", false, Some(6)), ("green-bright", true, None), ("green-dim", true, Some(0)), ("green-pulse", true, Some(12))] {
                let bytes = super::super::DOCK[0];
                let data: *mut Object = msg_send![class!(NSData), dataWithBytes:bytes.as_ptr() length:bytes.len()];
                let allocated: *mut Object = msg_send![class!(NSImage), alloc];
                let image: *mut Object = msg_send![allocated, initWithData:data];
                assert!(!image.is_null());
                if meeting { draw_meeting_dock(image, phase); } else { draw_dock(image, 0, phase); }
                let tiff: *mut Object = msg_send![image, TIFFRepresentation];
                let bitmap: *mut Object = msg_send![class!(NSBitmapImageRep), imageRepWithData:tiff];
                let properties: *mut Object = msg_send![class!(NSDictionary), dictionary];
                let png: *mut Object = msg_send![bitmap, representationUsingType:4usize properties:properties];
                assert!(!png.is_null());
                let length: usize = msg_send![png, length];
                let pointer: *const u8 = msg_send![png, bytes];
                let bytes = std::slice::from_raw_parts(pointer, length);
                std::fs::write(directory.join(format!("dock-native-{name}.png")), bytes).unwrap();
                let _: () = msg_send![image, release];
            }
        });
    }
}
