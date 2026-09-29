//! Catalog bytes are pinned independently of the hosting account and checked before native parsing.
use std::{collections::HashMap, io::Read, path::{Path, PathBuf}, sync::Mutex};
use once_cell::sync::Lazy;
use sha2::{Digest,Sha256};
#[derive(serde::Deserialize)] struct Entry { sha256:String, size:u64 }
static CATALOG:Lazy<HashMap<String,Entry>>=Lazy::new(||serde_json::from_str(include_str!("../model-fingerprints.json")).expect("Invalid model fingerprints"));
static VERIFIED:Lazy<Mutex<HashMap<(PathBuf,String),String>>>=Lazy::new(||Mutex::new(HashMap::new()));
fn identity(m:&std::fs::Metadata)->String {
    #[cfg(unix)] { use std::os::unix::fs::MetadataExt; format!("{}:{}:{}:{}:{}:{}",m.dev(),m.ino(),m.len(),m.mtime(),m.ctime(),m.ctime_nsec()) }
    #[cfg(not(unix))] { format!("{}:{:?}",m.len(),m.modified()) }
}
pub fn verify(path:&Path,key:&str)->anyhow::Result<()> {
    let expected=CATALOG.get(key).ok_or_else(||anyhow::anyhow!("No fingerprint for model {key}"))?;
    verify_expected(path,key,&expected.sha256,expected.size)
}
fn verify_expected(path:&Path,key:&str,sha:&str,size:u64)->anyhow::Result<()> {
    anyhow::ensure!(!path.symlink_metadata()?.file_type().is_symlink(),"Model cannot be a symbolic link");
    let mut file=std::fs::File::open(path)?; let before=file.metadata()?;
    anyhow::ensure!(before.len()==size,"Model size does not match its catalog fingerprint");
    let stamp=identity(&before);let cache_key=(path.to_path_buf(),key.to_string());
    if VERIFIED.lock().unwrap().get(&cache_key)==Some(&stamp) {return Ok(())}
    let mut h=Sha256::new();let mut buf=[0;1024*1024];
    loop {let n=file.read(&mut buf)?;if n==0 {break}h.update(&buf[..n]);}
    anyhow::ensure!(identity(&file.metadata()?)==stamp,"Model changed during verification");
    anyhow::ensure!(format!("{:x}",h.finalize())==sha,"Model fingerprint mismatch; remove it and download again");
    VERIFIED.lock().unwrap().insert(cache_key,stamp);Ok(())
}
pub fn whisper(path:&Path)->anyhow::Result<()> {
    let name=path.file_name().and_then(|v|v.to_str()).ok_or_else(||anyhow::anyhow!("Invalid model path"))?;
    let key=format!("stt-whisper/{name}");
    // User-imported Whisper models use non-catalog names and are explicitly user supplied.
    if CATALOG.contains_key(&key) {verify(path,&key)?;} Ok(())
}
pub fn summary(path:&Path)->anyhow::Result<()> {
    let name=path.file_name().and_then(|v|v.to_str()).ok_or_else(||anyhow::anyhow!("Invalid model path"))?;
    verify(path,&format!("{}/{name}",if name.starts_with("gemma") {"llm-gemma"} else {"llm-qwen"}))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn detects_same_size_changes_even_after_a_successful_check() {
        let d=tempfile::tempdir().unwrap();let p=d.path().join("model");std::fs::write(&p,b"good").unwrap();
        let sha=format!("{:x}",Sha256::digest(b"good"));verify_expected(&p,"test",&sha,4).unwrap();
        std::fs::write(&p,b"evil").unwrap();assert!(verify_expected(&p,"test",&sha,4).is_err());
    }
}
