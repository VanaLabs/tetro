#[path = "../src/verified_ffmpeg.rs"]
mod verified;
pub fn ensure_ffmpeg_binary() {
    let target=std::env::var("TARGET").expect("Missing build target");
    let root=std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let name=format!("ffmpeg-{}{}",target,if target.contains("windows") { ".exe" } else { "" });
    let path=root.join("binaries").join(name);
    println!("cargo:rerun-if-changed=src/verified_ffmpeg.rs");
    for key in ["TETRO_WINDOWS_FFMPEG_TARGET", "TETRO_WINDOWS_FFMPEG_SHA256", "TETRO_WINDOWS_FFMPEG_SIZE"] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    println!("cargo:rerun-if-changed={}",path.display());
    verified::ensure(&path,&target).expect("Verified VanaLabs FFmpeg is required");
}
