#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use log;
use env_logger;

#[cfg(all(debug_assertions, target_os = "macos"))]
fn enter_development_bundle() -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    if std::env::var("TETRO_EXPECTED_IDENTIFIER").as_deref() != Ok("am.vanalabs.tetro.dev") {
        return Ok(());
    }
    let Some(path) = std::env::var_os("TETRO_DEV_EXECUTABLE") else { return Ok(()); };
    let executable = std::path::PathBuf::from(path);
    let current = std::env::current_exe()?;
    if current == executable || std::env::var_os("TETRO_DEV_BUNDLED").is_some() {
        return Ok(());
    }
    // Re-exec preserves the PID owned by Tauri's watcher, so Rust rebuilds still
    // stop and relaunch the correct app instead of leaving an orphan window.
    if executable.exists() { std::fs::remove_file(&executable)?; }
    if std::fs::hard_link(&current, &executable).is_err() {
        std::fs::copy(&current, &executable)?;
    }
    // Refresh resources too: the watcher can rebuild after a template edit without
    // restarting the JavaScript launcher that initially prepared this bundle.
    let templates = executable.parent().unwrap().parent().unwrap().join("Resources/templates");
    std::fs::create_dir_all(&templates)?;
    for entry in std::fs::read_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("templates"))? {
        let entry = entry?;
        if entry.path().extension().is_some_and(|e| e == "json") {
            std::fs::copy(entry.path(), templates.join(entry.file_name()))?;
        }
    }
    let error = std::process::Command::new(&executable)
        .args(std::env::args_os().skip(1))
        .env("TETRO_DEV_BUNDLED", "1")
        .exec();
    Err(error)
}

fn main() {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    enter_development_bundle().expect("Could not start the Tetro development bundle");
    std::env::set_var("RUST_LOG", "info");
    env_logger::init();

    // Async logger will be initialized lazily when first needed (after Tauri runtime starts)
    log::info!("Starting application...");
    app_lib::run();
}
