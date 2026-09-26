//! Cancellation shared by the template editor and its background request.
use std::{collections::HashMap, sync::{LazyLock, Mutex}, time::{Duration, Instant}};
use tokio_util::sync::CancellationToken;

struct Entry { token: CancellationToken, active: bool, touched: Instant }
impl Default for Entry { fn default() -> Self { Self { token: CancellationToken::new(), active: false, touched: Instant::now() } } }
static JOBS: LazyLock<Mutex<HashMap<String, Entry>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
fn prune(jobs: &mut HashMap<String, Entry>) {
    jobs.retain(|_, e| e.active || e.touched.elapsed() < Duration::from_secs(300));
    // A Stop received after completion also lands here. Bound those tombstones.
    let mut inactive: Vec<_> = jobs.iter().filter(|(_,e)| !e.active).map(|(id,e)| (id.clone(),e.touched)).collect();
    inactive.sort_by_key(|(_,t)| *t);
    let extra = inactive.len().saturating_sub(128);
    for (id,_) in inactive.into_iter().take(extra) { jobs.remove(&id); }
}

pub struct DraftJob { id: String, pub token: CancellationToken }
impl DraftJob {
    pub fn start(id: String) -> Result<Self, String> {
        if uuid::Uuid::parse_str(&id).is_err() { return Err("Invalid draft request.".into()); }
        let mut jobs = JOBS.lock().unwrap_or_else(|p| p.into_inner()); prune(&mut jobs);
        let entry = jobs.entry(id.clone()).or_default();
        if entry.active { return Err("This draft is already being written.".into()); }
        entry.active = true;
        Ok(Self { id, token: entry.token.clone() })
    }
}
impl Drop for DraftJob {
    fn drop(&mut self) { JOBS.lock().unwrap_or_else(|p| p.into_inner()).remove(&self.id); }
}

#[tauri::command]
pub fn api_cancel_template_draft(request_id: String) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request_id).is_err() { return Err("Invalid draft request.".into()); }
    // Keep a cancelled token if Stop arrives before the drafting command starts.
    let mut jobs = JOBS.lock().unwrap_or_else(|p| p.into_inner());
    let entry = jobs.entry(request_id).or_default(); entry.token.cancel(); entry.touched = Instant::now();
    prune(&mut jobs);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopping_before_the_worker_starts_is_not_lost() {
        let id = uuid::Uuid::new_v4().to_string();
        api_cancel_template_draft(id.clone()).unwrap();
        let job = DraftJob::start(id.clone()).unwrap();
        assert!(job.token.is_cancelled());
        drop(job);
        assert!(!JOBS.lock().unwrap().contains_key(&id));
    }
    #[test]
    fn stopping_a_draft_does_not_cancel_another_draft() {
        let a = DraftJob::start(uuid::Uuid::new_v4().to_string()).unwrap();
        let b = DraftJob::start(uuid::Uuid::new_v4().to_string()).unwrap();
        api_cancel_template_draft(a.id.clone()).unwrap();
        assert!(a.token.is_cancelled()); assert!(!b.token.is_cancelled());
    }
}
