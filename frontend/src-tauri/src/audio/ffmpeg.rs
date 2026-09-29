use once_cell::sync::Lazy;
use std::path::PathBuf;
static FFMPEG_PATH: Lazy<Option<PathBuf>>=Lazy::new(|| {
    // The bundled file is covered by the app/update signature. Tauri may re-sign Mach-O bytes.
    if let Ok(exe)=std::env::current_exe() {
        if let Some(parent)=exe.parent() {
            let bundled=parent.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
            if bundled.symlink_metadata().is_ok_and(|m|m.is_file() && !m.file_type().is_symlink()) { return Some(bundled); }
        }
    }
    let target=if cfg!(all(target_os="macos",target_arch="aarch64")) { "aarch64-apple-darwin" } else if cfg!(all(target_os="macos",target_arch="x86_64")) { "x86_64-apple-darwin" } else { return None };
    let path=crate::app_profile::data_dir()?.join("components").join("ffmpeg-8.0.3-tetro.1").join("ffmpeg");
    // Repair uses only our pinned binary in app-owned storage; no PATH search or shell edits.
    std::thread::spawn(move || match crate::verified_ffmpeg::ensure(&path,target) {
        Ok(())=>Some(path), Err(error)=>{ log::error!("Audio component repair failed: {}",error);None }
    }).join().ok().flatten()
});
pub fn find_ffmpeg_path()->Option<PathBuf> { FFMPEG_PATH.clone() }
