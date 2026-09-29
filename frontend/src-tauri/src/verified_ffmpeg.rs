//! Shared by the build script and runtime repair: never execute bytes before verification.
use sha2::{Digest, Sha256};
use std::{io::{Read, Write}, path::Path};

pub fn artifact(target: &str) -> Result<(&'static str, u64), String> {
    match target {
        "aarch64-apple-darwin" => Ok(("9aeb28ad844e93155edffbce47d5b20cc384c6631006b040b0b06f90b225f743", 3092624)),
        "x86_64-apple-darwin" => Ok(("61e3976f911a1c8c490848a3ff731817b8a3c264ca09ec38345a0864c02f790f", 3070976)),
        _ => Err(format!("No verified VanaLabs FFmpeg build is available for {target}")),
    }
}
pub fn verify(path: &Path, target: &str) -> Result<(), String> {
    let (digest,size)=artifact(target)?;
    if path.symlink_metadata().map_err(|e|e.to_string())?.file_type().is_symlink() { return Err("FFmpeg cannot be a symbolic link".into()); }
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
}
