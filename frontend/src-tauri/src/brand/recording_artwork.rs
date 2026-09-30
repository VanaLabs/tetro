//! Native recording overlays. The supplied logo/background assets remain unchanged.

const BADGE_X: f32 = 28.5;
const BADGE_Y: f32 = 29.0;
const BADGE_RADIUS: f32 = 5.3;

fn height(quiet: f32, loud: f32, frame: usize) -> f32 {
    quiet + (loud - quiet) * frame.min(7) as f32 / 7.0
}

/// Retain the quiet frame's stem; extend its bars and outline its recording dot.
pub(super) fn tray(base: &[u8], frame: usize, dark: bool, phase: Option<usize>) -> Vec<u8> {
    let mut pixels = vec![0; base.len()];
    if let Some(phase) = phase {
        let (progress, opacity) = pulse(phase);
        let radius = BADGE_RADIUS + progress * 1.4;
        paint(&mut pixels, [255, 59, 48], opacity, |x, y| (x - BADGE_X).powi(2) + (y - BADGE_Y).powi(2) <= radius * radius);
    }
    copy_without_badge(base, &mut pixels);
    let ink = if dark { [255, 255, 255] } else { [23, 25, 27] };
    for (x, quiet, loud) in [(2.0, 3.0, 13.0), (6.9, 3.5, 16.0), (11.8, 4.0, 20.0),
        (21.6, 4.0, 20.0), (26.5, 3.5, 16.0), (31.4, 3.0, 13.0)] {
        let h = height(quiet, loud, frame);
        paint(&mut pixels, ink, 1.0, |px, py| {
            let dy = (py - 10.5).abs() - (h / 2.0 - 1.3);
            (px - (x + 1.3)).powi(2) + dy.max(0.0).powi(2) <= 1.3 * 1.3
        });
    }
    badge(&mut pixels, [255, 59, 48]);
    pixels
}

/// Meeting and recording use the same compact placement and contrast treatment.
pub(super) fn meeting_tray(base: &[u8], dark: bool) -> Vec<u8> {
    let mut pixels = vec![0; base.len()];
    copy_without_badge(base, &mut pixels);
    badge(&mut pixels, if dark { [48, 209, 88] } else { [40, 177, 76] });
    pixels
}

fn copy_without_badge(base: &[u8], pixels: &mut [u8]) {
    // Preserve the supplied T above any halo. Clear only the old badge area,
    // leaving a transparent gap to the stem and the fully extended waveform.
    for (index, source) in base.chunks_exact(4).enumerate() {
        let x = index % 36;
        let y = index / 36;
        if x >= 21 && y >= 20 { continue; }
        blend(&mut pixels[index * 4..][..4], [source[0], source[1], source[2]], source[3] as f32 / 255.0);
    }
}

fn badge(pixels: &mut [u8], color: [u8; 3]) {
    // White separates either color from translucent wallpaper; the thin dark edge
    // also keeps that ring readable against a light or highlighted menu bar.
    for (radius, color) in [(BADGE_RADIUS, [23, 25, 27]), (4.7, [255, 255, 255]), (3.5, color)] {
        paint(pixels, color, 1.0, |x, y| (x - BADGE_X).powi(2) + (y - BADGE_Y).powi(2) <= radius * radius);
    }
}

/// Four samples per pixel keep rounded strokes crisp at 18pt without a new renderer.
fn paint(pixels: &mut [u8], color: [u8; 3], opacity: f32, inside: impl Fn(f32, f32) -> bool) {
    for y in 0..36 {
        for x in 0..36 {
            let mut samples = 0;
            for dy in [0.25, 0.75] {
                for dx in [0.25, 0.75] { samples += inside(x as f32 + dx, y as f32 + dy) as u8; }
            }
            if samples == 0 { continue; }
            blend(&mut pixels[(y * 36 + x) * 4..][..4], color, samples as f32 / 4.0 * opacity);
        }
    }
}

fn blend(pixel: &mut [u8], color: [u8; 3], coverage: f32) {
    if coverage <= 0.0 { return; }
    let remainder = pixel[3] as f32 / 255.0 * (1.0 - coverage);
    let alpha = coverage + remainder;
    for c in 0..3 { pixel[c] = ((color[c] as f32 * coverage + pixel[c] as f32 * remainder) / alpha).round() as u8; }
    pixel[3] = (alpha * 255.0).round() as u8;
}

fn pulse(phase: usize) -> (f32, f32) {
    let progress = (phase % super::PULSE_FRAMES) as f32 / (super::PULSE_FRAMES - 1) as f32;
    (progress, (std::f32::consts::PI * progress).sin().max(0.0) * 0.55)
}

fn dock_bars(frame: usize) -> impl Iterator<Item = (f64, f64)> {
    [(65.25, 9.5, 46.0), (79.75, 13.0, 62.0), (94.25, 10.0, 50.0), (108.75, 18.0, 90.0),
        (137.75, 18.0, 90.0), (152.25, 10.0, 50.0), (166.75, 13.0, 62.0), (181.25, 9.5, 46.0)]
        .into_iter().map(move |(x, quiet, loud)| (x, height(quiet, loud, frame) as f64))
}

#[cfg(target_os = "macos")]
pub(super) unsafe fn draw_dock(image: *mut objc::runtime::Object, frame: usize, phase: Option<usize>) {
    use core_graphics::context::{CGContext, CGLineCap};
    use core_graphics::geometry::{CGPoint, CGRect, CGSize};
    use objc::{class, msg_send, sel, sel_impl};
    let _: () = msg_send![image, lockFocus];
    let graphics: *mut objc::runtime::Object = msg_send![class!(NSGraphicsContext), currentContext];
    let raw: *mut core_graphics::sys::CGContext = msg_send![graphics, CGContext];
    if !raw.is_null() {
        let context = CGContext::from_existing_context_ptr(raw);
        if let Some(phase) = phase {
            let (progress, opacity) = pulse(phase);
            let radius = 28.0 + progress as f64 * 16.0;
            context.set_rgb_stroke_color(1.0, 59.0 / 255.0, 48.0 / 255.0, opacity as f64);
            context.set_line_width(4.0);
            context.stroke_ellipse_in_rect(CGRect::new(&CGPoint::new(192.0 - radius, 64.0 - radius), &CGSize::new(radius * 2.0, radius * 2.0)));
        }
        context.set_rgb_stroke_color(1.0, 244.0 / 255.0, 230.0 / 255.0, 1.0);
        context.set_line_width(9.5);
        context.set_line_cap(CGLineCap::CGLineCapRound);
        for (x, h) in dock_bars(frame) {
            context.begin_path();
            let half = (h - 9.5) / 2.0;
            // Core Graphics uses a bottom-left origin; the artwork baseline is y=90.
            context.move_to_point(x + 4.75, 256.0 - 90.0 - half);
            context.add_line_to_point(x + 4.75, 256.0 - 90.0 + half);
            context.stroke_path();
        }
    }
    let _: () = msg_send![image, unlockFocus];
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn marker_has_a_white_separator_in_both_menu_bar_appearances() {
        for dark in [false, true] {
            let pixels = tray(&[0; 36 * 36 * 4], 0, dark, None);
            let pixel = |x: usize, y: usize| &pixels[(y * 36 + x) * 4..][..4];
            assert_eq!(pixel(24, 28), [255, 255, 255, 255]);
            assert_eq!(pixel(28, 29), [255, 59, 48, 255]);
            assert!(pixels.chunks_exact(4).any(|p| p[..3] == [23, 25, 27] && p[3] > 0));
        }
    }

    #[test]
    fn meeting_marker_matches_recording_size_and_keeps_the_supplied_stem() {
        for dark in [false, true] {
            let base: &[u8] = if dark { include_bytes!("../../icons/letter/idle-call-dark.rgba") }
                else { include_bytes!("../../icons/letter/idle-call.rgba") };
            let green = meeting_tray(base, dark);
            let red = tray(base, 0, dark, None);
            let pixel = |x: usize, y: usize| &green[(y * 36 + x) * 4..][..4];
            assert_eq!(pixel(28, 29), if dark { [48, 209, 88, 255] } else { [40, 177, 76, 255] });
            assert_eq!(pixel(24, 28), [255, 255, 255, 255]);
            assert_eq!(pixel(17, 28), &base[(28 * 36 + 17) * 4..][..4]);
            for y in 23..36 {
                for x in 21..36 {
                    let i = (y * 36 + x) * 4;
                    assert_eq!(green[i + 3], red[i + 3], "marker silhouettes must match");
                }
            }
        }
    }

    #[test]
    fn maximum_waveform_and_every_pulse_keep_a_gap_to_the_stem_and_badge() {
        for (dark, base) in [(false, super::super::LIVE[0]), (true, super::super::LIVE_DARK[0])] {
            for phase in 0..super::super::PULSE_FRAMES {
                let pixels = tray(base, 7, dark, Some(phase));
                // A full transparent pixel row separates the tallest bars from
                // even the expanding halo; a column separates it from the stem.
                for x in 21..36 { assert_eq!(pixels[(21 * 36 + x) * 4 + 3], 0); }
                for y in 24..36 { assert_eq!(pixels[(y * 36 + 21) * 4 + 3], 0); }
            }
        }
    }
    #[test]
    fn waveform_sweep_is_visible_at_menu_bar_and_dock_sizes() {
        let base = [0; 36 * 36 * 4];
        let quiet = tray(&base, 0, true, None);
        let loud = tray(&base, 7, true, None);
        let changed = quiet.chunks_exact(4).zip(loud.chunks_exact(4)).filter(|(a, b)| a != b).count();
        assert!(changed > 180, "at least 45 logical pixels should change at 2x");
        for ((_, low), (_, high)) in dock_bars(0).zip(dock_bars(7)) {
            assert!(high - low >= 36.0, "every Dock bar must move at least 9pt at 64pt icon size");
        }
        assert_eq!(tray(&base, 7, true, None), tray(&base, usize::MAX, true, None));
    }

    #[test]
    fn approved_quiet_frames_keep_their_stem_with_readable_overlays() {
        for (dark, base) in [(false, super::super::LIVE[0]), (true, super::super::LIVE_DARK[0])] {
            for frame in 0..8 {
                let pixels = tray(base, frame, dark, None);
                assert_eq!(pixels.len(), 36 * 36 * 4);
                // The lower stem remains the supplied artwork, independent of audio.
                let stem = (28 * 36 + 17) * 4;
                assert_eq!(&pixels[stem..stem + 4], &base[stem..stem + 4]);
                if let Some(directory) = std::env::var_os("TETRO_ICON_PREVIEW_DIR") {
                    let directory = std::path::PathBuf::from(directory);
                    std::fs::create_dir_all(&directory).unwrap();
                    std::fs::write(directory.join(format!("tray-{}-{frame}.rgba", if dark { "dark" } else { "light" })), pixels).unwrap();
                }
            }
            if let Some(directory) = std::env::var_os("TETRO_ICON_PREVIEW_DIR") {
                let directory = std::path::PathBuf::from(directory);
                for phase in 0..super::super::PULSE_FRAMES {
                    std::fs::write(directory.join(format!("pulse-{}-{phase}.rgba", if dark { "dark" } else { "light" })), tray(base, 4, dark, Some(phase))).unwrap();
                }
            }
        }
    }

    #[test]
    fn halo_expands_and_fades_without_blinking_the_recording_marker() {
        let base = super::super::LIVE_DARK[0];
        let still = tray(base, 0, true, None);
        let first = tray(base, 0, true, Some(0));
        let middle = tray(base, 0, true, Some(8));
        let last = tray(base, 0, true, Some(15));
        assert_eq!(still, first);
        assert_eq!(still, last);
        assert_ne!(still, middle);
        for phase in 0..super::super::PULSE_FRAMES {
            let pixels = tray(base, 0, true, Some(phase));
            let center = (29 * 36 + 28) * 4;
            assert_eq!(&pixels[center..center + 4], &[255, 59, 48, 255]);
        }
        assert!(pulse(2).0 < pulse(8).0);
        assert!(pulse(12).1 < pulse(8).1);
    }
}
