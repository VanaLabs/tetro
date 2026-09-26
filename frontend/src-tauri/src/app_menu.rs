use tauri::{App, AppHandle, Emitter, Runtime};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as Native, Submenu};

pub fn navigate<R: Runtime>(app: &AppHandle<R>, action: &str) {
    crate::tray::focus_main_window(app);
    let _ = app.emit("tetro-menu", action);
}

pub fn install(app: &App) -> tauri::Result<()> {
    let item = |id, text, shortcut| MenuItem::with_id(app, id, text, true, shortcut);
    let about = item("tetro-about", "About Tetro", None::<&str>)?;
    let settings = item("tetro-settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let help = item("tetro-help", "Tetro Guide", Some("CmdOrCtrl+Shift+H"))?;
    let shortcuts = item("tetro-shortcuts", "Keyboard Shortcuts", None)?;
    let application = Submenu::with_items(app, "Tetro", true, &[
        &about, &settings, &Native::separator(app)?,
        #[cfg(target_os = "macos")] &Native::services(app, None)?,
        #[cfg(target_os = "macos")] &Native::hide(app, None)?,
        #[cfg(target_os = "macos")] &Native::hide_others(app, None)?,
        #[cfg(target_os = "macos")] &Native::show_all(app, None)?,
        &Native::separator(app)?, &item("tetro-quit", "Quit Tetro", Some("CmdOrCtrl+Q"))?,
    ])?;
    let file = Submenu::with_items(app, "File", true, &[
        &item("tetro-new", "New Recording", Some("CmdOrCtrl+N"))?,
        &item("tetro-import", "Import Recording…", Some("CmdOrCtrl+O"))?,
        &Native::separator(app)?, &Native::close_window(app, None)?,
    ])?;
    let edit = Submenu::with_items(app, "Edit", true, &[
        &Native::undo(app, None)?, &Native::redo(app, None)?, &Native::separator(app)?,
        &Native::cut(app, None)?, &Native::copy(app, None)?, &Native::paste(app, None)?, &Native::select_all(app, None)?,
    ])?;
    let window = Submenu::with_items(app, "Window", true, &[
        &Native::minimize(app, None)?, &Native::maximize(app, None)?, &Native::fullscreen(app, None)?,
    ])?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&help, &shortcuts])?;
    app.set_menu(Menu::with_items(app, &[&application, &file, &edit, &window, &help_menu])?)?;
    #[cfg(target_os = "macos")]
    { window.set_as_windows_menu_for_nsapp()?; help_menu.set_as_help_menu_for_nsapp()?; }
    app.on_menu_event(|app, event| match event.id.as_ref() {
        "tetro-quit" => { if crate::quit_guard::needs_save() { crate::quit_guard::request(app); } else { app.exit(0); } },
        "tetro-about" => navigate(app, "about"),
        "tetro-settings" => navigate(app, "settings"),
        "tetro-new" => navigate(app, "new"),
        "tetro-import" => navigate(app, "import"),
        "tetro-help" => navigate(app, "help"),
        "tetro-shortcuts" => navigate(app, "shortcuts"),
        _ => {},
    });
    crate::quit_guard::install_native_guard(app);
    Ok(())
}
