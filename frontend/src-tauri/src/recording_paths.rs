//! Native filesystem boundary. Meeting paths from IPC or the database are not authorization.
use std::path::{Path, PathBuf};

pub fn folder_in(root: &Path, folder: &Path) -> Result<PathBuf, String> {
    if folder.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Invalid recording folder".into());
    }
    let root = root.canonicalize().map_err(|_| "Recording location is unavailable")?;
    let meta = folder.symlink_metadata().map_err(|_| "Recording folder is unavailable")?;
    if meta.file_type().is_symlink() || !meta.is_dir() { return Err("Recording folders cannot be symbolic links".into()); }
    let actual = folder.canonicalize().map_err(|_| "Recording folder is unavailable")?;
    if actual.parent() != Some(root.as_path()) { return Err("This folder is outside Tetro's recording location".into()); }
    Ok(actual)
}

pub fn folder(folder: &Path) -> Result<PathBuf, String> {
    let mut roots = vec![crate::audio::recording_preferences::get_default_recordings_folder()];
    if let Some(data) = crate::app_profile::data_dir() {
        if let Ok(bytes) = std::fs::read(data.join("recording_preferences.json")) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(path) = value["preferences"]["save_folder"].as_str() { roots.push(path.into()); }
            }
        }
    }
    roots.iter().find_map(|root| folder_in(root, folder).ok()).ok_or_else(|| "This folder is outside Tetro's recording location or is a symbolic link".into())
}

pub fn child(folder: &Path, name: &str) -> Result<PathBuf, String> {
    let path = folder.join(name);
    if Path::new(name).components().count()!=1 { return Err("Invalid recording file name".into()); }
    match path.symlink_metadata() {
        Ok(meta) if meta.file_type().is_symlink() => Err("Recording files cannot be symbolic links".into()),
        Ok(_) => Ok(path),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => Ok(path),
        Err(e) => Err(e.to_string()),
    }
}

pub fn concat_entry(path: &Path) -> Result<String, String> {
    let text = path.to_str().ok_or("Unsupported recording path")?;
    if text.contains(['\r','\n']) { return Err("Recording paths cannot contain line breaks".into()); }
    Ok(format!("file '{}'\n", text.replace('\'', "'\\''")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_traversal_other_roots_and_symlinks() {
        let root=tempfile::tempdir().unwrap(); let outside=tempfile::tempdir().unwrap();
        let good=root.path().join("meeting"); std::fs::create_dir(&good).unwrap();
        assert_eq!(folder_in(root.path(),&good).unwrap(),good.canonicalize().unwrap());
        assert!(folder_in(root.path(),root.path()).is_err());
        assert!(folder_in(root.path(),outside.path()).is_err());
        assert!(folder_in(root.path(),&good.join("../meeting")).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(outside.path(),root.path().join("link")).unwrap();
            assert!(folder_in(root.path(),&root.path().join("link")).is_err());
            std::os::unix::fs::symlink(outside.path().join("secret"),good.join("audio.mp4")).unwrap();
            assert!(child(&good,"audio.mp4").is_err());
        }
    }
    #[test]
    fn concat_names_do_not_inject_directives() {
        assert_eq!(concat_entry(Path::new("/a/b'c.mp4")).unwrap(),"file '/a/b'\\''c.mp4'\n");
        assert!(concat_entry(Path::new("/a/x\nfile y")).is_err());
    }
}
