//! Whisper models the user brings from their own computer.
//!
//! Any `ggml-<name>.bin` in the models directory that isn't in the catalog is listed as a
//! local model, and `whisper_import_model` puts a picked file there (hard link when it's on
//! the same disk, copy otherwise) so it survives the original being moved.

use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::command;

use crate::config::WHISPER_MODEL_CATALOG;
use crate::whisper_engine::{ModelInfo, ModelStatus};

const LOCAL_DESCRIPTION: &str = "Added from this computer";

fn has_ggml_magic(path: &Path) -> bool {
    let mut buffer = [0u8; 4];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut buffer))
        .map(|_| matches!(&buffer, b"ggml" | b"GGUF" | b"ggmf" | b"lmgg" | b"FUGU" | b"fmgg"))
        .unwrap_or(false)
}

/// Speed and accuracy labels guessed from the model family in the name.
fn guess_profile(name: &str) -> (&'static str, &'static str) {
    let quantized = name.contains("-q");
    match () {
        _ if name.contains("tiny") => ("Decent", "Very Fast"),
        _ if name.contains("base") => ("Good", "Fast"),
        _ if name.contains("small") => ("Good", if quantized { "Fast" } else { "Medium" }),
        _ if name.contains("medium") => ("High", if quantized { "Medium" } else { "Slow" }),
        _ if name.contains("turbo") => ("High", "Medium"),
        _ if name.contains("large") => ("High", "Slow"),
        _ => ("Good", "Medium"),
    }
}

/// Model name from a file name: `ggml-small-hy.bin` → `small-hy`. Keeps [a-z0-9._-] only.
pub fn model_name_from_file(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".bin").unwrap_or(file_name);
    let stem = stem.strip_prefix("ggml-").unwrap_or(stem);
    let name: String = stem
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '-' })
        .collect();
    let name = name.trim_matches(|c| c == '-' || c == '.').to_string();
    (!name.is_empty()).then_some(name)
}

/// Models in `models_dir` that aren't part of the catalog.
pub fn local_models(models_dir: &Path) -> Vec<ModelInfo> {
    let Ok(entries) = std::fs::read_dir(models_dir) else { return Vec::new() };
    let mut models: Vec<ModelInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.starts_with("ggml-") || !file_name.ends_with(".bin") {
                return None;
            }
            if WHISPER_MODEL_CATALOG.iter().any(|&(_, catalog_file, ..)| catalog_file == file_name) {
                return None;
            }
            let path = entry.path();
            let bytes = std::fs::metadata(&path).ok()?.len();
            if bytes < 1024 * 1024 || !has_ggml_magic(&path) {
                return None;
            }
            let name = model_name_from_file(&file_name)?;
            let (accuracy, speed) = guess_profile(&name);
            Some(ModelInfo {
                name,
                path,
                size_mb: (bytes / 1_000_000) as u32,
                accuracy: accuracy.to_string(),
                speed: speed.to_string(),
                status: ModelStatus::Available,
                description: LOCAL_DESCRIPTION.to_string(),
            })
        })
        .collect();
    models.sort_by(|a, b| a.name.cmp(&b.name));
    models
}

fn import_into(models_dir: &Path, source: &Path) -> Result<String, String> {
    if !source.is_file() {
        return Err("That file doesn't exist.".into());
    }
    if !has_ggml_magic(source) {
        return Err("This isn't a whisper.cpp model. Pick a GGML .bin file, like ggml-small.bin.".into());
    }
    let file_name = source.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let name = model_name_from_file(&file_name).ok_or("Couldn't make a model name from that file name.")?;
    if WHISPER_MODEL_CATALOG.iter().any(|&(catalog_name, ..)| catalog_name == name) {
        return Err(format!("“{name}” is already a model in the list. Rename the file (e.g. ggml-{name}-custom.bin) and try again."));
    }
    std::fs::create_dir_all(models_dir).map_err(|e| format!("Couldn't create the models folder: {e}"))?;
    let target: PathBuf = models_dir.join(format!("ggml-{name}.bin"));
    if target.exists() {
        if std::fs::canonicalize(&target).ok() == std::fs::canonicalize(source).ok() {
            return Ok(name);
        }
        return Err(format!("A model called “{name}” is already added. Remove it first, or rename the file."));
    }
    if std::fs::hard_link(source, &target).is_err() {
        std::fs::copy(source, &target).map_err(|e| {
            let _ = std::fs::remove_file(&target);
            format!("Couldn't copy the model: {e}")
        })?;
    }
    log::info!("Imported local Whisper model {} from {}", name, source.display());
    Ok(name)
}

/// Adds a whisper.cpp model file from anywhere on disk. Returns the model's name.
#[command]
pub async fn whisper_import_model(path: String) -> Result<String, String> {
    let models_dir = super::commands::get_models_directory().ok_or("Models directory not initialized")?;
    let source = PathBuf::from(path);
    tokio::task::spawn_blocking(move || import_into(&models_dir, &source))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_model(path: &Path) {
        let mut bytes = b"ggml".to_vec();
        bytes.resize(2 * 1024 * 1024, 0);
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn names_come_from_file_names() {
        assert_eq!(model_name_from_file("ggml-small-hy-q5_0.bin").as_deref(), Some("small-hy-q5_0"));
        assert_eq!(model_name_from_file("My Model.bin").as_deref(), Some("my-model"));
        assert_eq!(model_name_from_file("ggml-.bin"), None);
    }

    #[test]
    fn lists_only_non_catalog_ggml_files() {
        let dir = tempfile::tempdir().unwrap();
        fake_model(&dir.path().join("ggml-tiny.bin"));
        fake_model(&dir.path().join("ggml-large-v3-turbo-hy.bin"));
        fake_model(&dir.path().join("ggml-large-v3-turbo-custom.bin"));
        std::fs::write(dir.path().join("ggml-broken.bin"), vec![0u8; 2 * 1024 * 1024]).unwrap();
        let models = local_models(dir.path());
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "large-v3-turbo-custom");
        assert_eq!(models[0].speed, "Medium");
    }

    #[test]
    fn import_links_or_copies_and_rejects_bad_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let file = src.path().join("ggml-small-hy.bin");
        fake_model(&file);
        assert_eq!(import_into(dst.path(), &file).unwrap(), "small-hy");
        assert!(dst.path().join("ggml-small-hy.bin").exists());
        assert_eq!(import_into(dst.path(), &dst.path().join("ggml-small-hy.bin")).unwrap(), "small-hy");

        let text = src.path().join("notes.bin");
        std::fs::write(&text, b"hello world").unwrap();
        assert!(import_into(dst.path(), &text).is_err());

        let clash = src.path().join("ggml-tiny.bin");
        fake_model(&clash);
        assert!(import_into(dst.path(), &clash).is_err());
    }
}
