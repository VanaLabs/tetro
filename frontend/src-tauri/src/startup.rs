use std::sync::Mutex;
use tauri::{AppHandle, Manager};
static ISSUE: Mutex<Option<String>> = Mutex::new(None);
static RETRY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub fn failed(error: String) { *ISSUE.lock().unwrap_or_else(|p|p.into_inner()) = Some(error); }
#[tauri::command]
pub fn api_startup_issue() -> Option<String> { ISSUE.lock().unwrap_or_else(|p|p.into_inner()).clone() }
#[tauri::command]
pub async fn api_retry_startup(app: AppHandle) -> Result<(),String> {
    let _guard = RETRY.lock().await;
    if app.try_state::<crate::state::AppState>().is_none() {
        if let Err(error) = crate::database::setup::initialize_database_on_startup(&app).await { failed(error.clone()); return Err(error); }
    }
    *ISSUE.lock().unwrap_or_else(|p|p.into_inner()) = None;
    Ok(())
}
