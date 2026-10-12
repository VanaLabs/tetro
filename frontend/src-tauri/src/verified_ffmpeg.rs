//! Shared by the build script and runtime repair: never execute bytes before verification.
use sha2::{Digest, Sha256};
use std::{io::{Read, Write}, path::Path};

pub fn artifact(target: &str) -> Result<(&'static str, u64), String> {
    match target {
        "aarch64-apple-darwin" => Ok(("9aeb28ad844e93155edffbce47d5b20cc384c6631006b040b0b06f90b225f743", 3092624)),
        "x86_64-apple-darwin" => Ok(("61e3976f911a1c8c490848a3ff731817b8a3c264ca09ec38345a0864c02f790f", 3070976)),
        "x86_64-pc-windows-msvc" | "aarch64-pc-windows-msvc" if cfg!(feature = "dev-profile") => {
            // Internal Windows Dev builds compile our pinned upstream source themselves.
            // Bind the exact resulting bytes to this app; never accept a runtime manifest.
            dev_artifact(target,
                option_env!("TETRO_WINDOWS_FFMPEG_TARGET"),
                option_env!("TETRO_WINDOWS_FFMPEG_SHA256"),
                option_env!("TETRO_WINDOWS_FFMPEG_SIZE"))
        }
        _ => Err(format!("No verified VanaLabs FFmpeg build is available for {target}")),
    }
}
fn dev_artifact(target: &str, pinned_target: Option<&str>, digest: Option<&'static str>, size: Option<&str>) -> Result<(&'static str, u64), String> {
    if pinned_target != Some(target) { return Err("Windows Dev FFmpeg target pin is missing or mismatched".into()); }
    let digest=digest.filter(|s| s.len()==64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
        .ok_or("Windows Dev FFmpeg fingerprint is missing or invalid")?;
    let size=size.and_then(|s|s.parse::<u64>().ok()).filter(|n|*n>0 && *n<=64*1024*1024)
        .ok_or("Windows Dev FFmpeg size is missing or invalid")?;
    Ok((digest,size))
}
pub fn verify(path: &Path, target: &str) -> Result<(), String> {
    let (digest,size)=artifact(target)?;
    let metadata=path.symlink_metadata().map_err(|e|e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("FFmpeg must be a regular file without links".into()); }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Err("FFmpeg cannot be a reparse point".into()); }
    }
    let mut file=std::fs::File::open(path).map_err(|e|e.to_string())?;
    if file.metadata().map_err(|e|e.to_string())?.len()!=size { return Err("FFmpeg size mismatch".into()); }
    let mut hash=Sha256::new(); let mut buffer=[0;65536];
    loop { let n=file.read(&mut buffer).map_err(|e|e.to_string())?; if n==0 {break} hash.update(&buffer[..n]); }
    if format!("{:x}",hash.finalize())!=digest { return Err("FFmpeg fingerprint mismatch".into()); }
    Ok(())
}
pub fn ensure(path: &Path, target: &str) -> Result<(), String> {
    let (_,size)=artifact(target)?;
    if verify(path,target).is_ok() { return Ok(()) }
    if target.contains("windows") {
        return Err("The verified Windows Dev FFmpeg must be built and staged before building the app".into());
    }
    let parent=path.parent().ok_or("Invalid FFmpeg destination")?;
    std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let url=format!("https://github.com/VanaLabs/tetro/releases/download/ffmpeg-8.0.3-tetro.1/ffmpeg-{target}");
    let client=reqwest::blocking::Client::builder().https_only(true).timeout(std::time::Duration::from_secs(180)).build().map_err(|e|e.to_string())?;
    let response=client.get(url).send().and_then(|r|r.error_for_status()).map_err(|_|"Could not download the verified Tetro audio component")?;
    let mut temp=tempfile::NamedTempFile::new_in(parent).map_err(|e|e.to_string())?;
    std::io::copy(&mut response.take(size+1),&mut temp).map_err(|e|e.to_string())?;
    temp.flush().map_err(|e|e.to_string())?;
    verify(temp.path(),target)?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; temp.as_file().set_permissions(std::fs::Permissions::from_mode(0o755)).map_err(|e|e.to_string())?; }
    temp.persist(path).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_corruption_and_unsupported_targets() {
        let dir=tempfile::tempdir().unwrap();let p=dir.path().join("ffmpeg");
        std::fs::write(&p,vec![0;3092624]).unwrap();
        assert!(verify(&p,"aarch64-apple-darwin").unwrap_err().contains("fingerprint"));
        assert!(artifact("not-a-target").is_err());
    }
    #[test] fn windows_dev_pins_fail_closed() {
        let target="aarch64-pc-windows-msvc";
        let digest="7008f7ff82f8e7de563a22f2b590e08e706a1289eba606b93de2b56edfb1e04b";
        assert!(dev_artifact(target,None,Some(digest),Some("1234")).is_err());
        assert!(dev_artifact(target,Some("x86_64-pc-windows-msvc"),Some(digest),Some("1234")).is_err());
        assert!(dev_artifact(target,Some(target),Some("bad"),Some("1234")).is_err());
        assert!(dev_artifact(target,Some(target),Some(digest),Some("0")).is_err());
        assert!(dev_artifact(target,Some(target),Some(digest),Some("67108865")).is_err());
        assert_eq!(dev_artifact(target,Some(target),Some(digest),Some("1234")).unwrap(),(digest,1234));
    }
}
