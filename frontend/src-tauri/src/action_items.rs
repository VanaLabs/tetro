//! Action items gathered from every meeting's notes, with a ticked-off state.

use crate::state::AppState;
use regex::Regex;
use serde::{Serialize, Deserialize};
use sqlx::{Row, SqlitePool};
use std::hash::{Hash, Hasher};
use std::sync::LazyLock;
use tauri::{AppHandle, Runtime};

static HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?:#{1,6}\s+(.+?)\s*#*\s*|\*\*(.+?)\*\*:?\s*)$").unwrap());
static ACTION_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(action items?|next steps?|to-?dos?|tasks?|follow[- ]?ups?|commitments?|owners? and tasks)\b").unwrap());
static BULLET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$").unwrap());
static PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(none|none noted.*|not specified|unspecified|unknown|n/?a|no action items?.*|nothing.*|—|-|tbd|tba|pending assignment)\.?$").unwrap());
static TIMECODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[?\d{1,2}:\d{2}(:\d{2})?\]?(\s*[-–—]\s*\[?\d{1,2}:\d{2}(:\d{2})?\]?)?$").unwrap());
static TASK_COL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(task|action|item|to-?do|what|deliverable|next step|description)").unwrap());
static OWNER_COL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(owner|assignee|assigned|who|responsible|person)").unwrap());
static DUE_COL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(due|deadline|date|when|by)\b").unwrap());

/// A real value for a cell, or None for placeholders, timecodes and quotes from the transcript.
fn value(cell: &str) -> Option<String> {
    let c = cell.trim().trim_matches(|ch| ch == '"' || ch == '“' || ch == '”').trim();
    if c.is_empty() || PLACEHOLDER.is_match(c) || TIMECODE.is_match(c) || cell.trim().starts_with('"') || cell.trim().starts_with('“') { None } else { Some(c.to_string()) }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct ActionItem {
    pub key: String,
    pub owner: Option<String>,
    pub due: Option<String>,
    pub meeting_id: String,
    pub meeting_title: String,
    pub created_at: String,
    pub text: String,
    pub done: bool,
    pub source_latest: bool,
}

fn clean(text: &str) -> String {
    text.replace("**", "").replace('`', "").split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn item_key(meeting_id: &str, text: &str) -> String {
    let norm: String = text.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
    format!("{}:{}", meeting_id, norm)
}

/// Pulls items from sections titled like "Action items" / "Next steps", in bullets or tables.
pub fn extract(markdown: &str) -> Vec<(String, Option<String>, Option<String>)> {
    let mut items = Vec::new();
    let mut in_section = false;
    let mut table_header_seen = false;
    let mut cols: (Option<usize>, Option<usize>, Option<usize>) = (None, None, None);
    for line in markdown.lines() {
        if let Some(c) = HEADING.captures(line) {
            let title = c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or("");
            in_section = ACTION_TITLE.is_match(title);
            table_header_seen = false;
            continue;
        }
        if !in_section {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.starts_with('|') {
            let cells: Vec<String> = trimmed.trim_matches('|').split('|').map(|c| clean(c.trim())).collect();
            if cells.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ':' || ch == ' ')) {
                continue; // separator row
            }
            if !table_header_seen {
                table_header_seen = true; // first row is the header: find task/owner/due columns
                let find = |re: &Regex| cells.iter().position(|c| re.is_match(c));
                let owner = find(&OWNER_COL);
                let due = find(&DUE_COL).filter(|i| Some(*i) != owner);
                let task = cells.iter().enumerate().position(|(i, c)| TASK_COL.is_match(c) && Some(i) != owner && Some(i) != due);
                cols = (task, owner, due);
                continue;
            }
            let get = |i: Option<usize>| i.and_then(|i| cells.get(i)).and_then(|c| value(c));
            // Without a task column, the longest real cell that isn't the owner or due date.
            let task = get(cols.0).or_else(|| cells.iter().enumerate()
                .filter(|(i, _)| Some(*i) != cols.1 && Some(*i) != cols.2)
                .filter_map(|(_, c)| value(c)).max_by_key(|c| c.len()));
            if let Some(task) = task { items.push((task, get(cols.1), get(cols.2))); }
        } else if let Some(c) = BULLET.captures(line) {
            let text = clean(&c[1]);
            if !text.is_empty() && !PLACEHOLDER.is_match(&text) { items.push((text, None, None)); }
        }
    }
    items.dedup();
    items
}

/// Use the source report's section and column positions when translated headings
/// differ. If structure changed, keep the source tasks available rather than drop them.
fn localized_actions(markdown: &str, english: &str) -> Vec<(String, Option<String>, Option<String>)> {
    let parts = |text: &str| crate::meeting_edits::sections(text).into_iter().filter(|(_,s)| !s.starts_with("# ")).collect::<Vec<_>>();
    let source = parts(english); let translated = parts(markdown);
    if source.len() == translated.len() && !source.is_empty() {
        let mut mapped = String::new();
        for ((_,original),(_,local)) in source.iter().zip(&translated) {
            let title = original.lines().next().unwrap_or("").trim_start_matches('#').trim();
            if !ACTION_TITLE.is_match(title) { continue; }
            mapped.push_str("\n## Action items\n");
            let original_header = original.lines().find(|l| l.trim_start().starts_with('|'));
            let mut header = true;
            for line in local.lines().skip(1) {
                if header && line.trim_start().starts_with('|') {
                    mapped.push_str(original_header.unwrap_or(line)); header = false;
                } else { mapped.push_str(line); }
                mapped.push('\n');
            }
        }
        let items = extract(&mapped);
        if !items.is_empty() { return items; }
    }
    let display = extract(markdown);
    if display.is_empty() { extract(english) } else { display }
}

fn report_items(result: &str) -> Vec<(String, String, Option<String>, Option<String>)> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(result) else { return Vec::new() };
    let markdown = v["markdown"].as_str().unwrap_or("");
    let english = v["english_cache"]["markdown"].as_str().unwrap_or(markdown);
    let canonical = extract(english);
    let display = localized_actions(markdown, english);
    let aligned = canonical.len() == display.len();
    display.into_iter().enumerate().map(|(i,(text,owner,due))| {
        let key_text = if aligned { canonical[i].0.clone() } else { text.clone() };
        (key_text,text,owner,due)
    }).collect()
}

fn similarity(a: &str, b: &str) -> f64 {
    let words = |s: &str| s.split(|c:char| !c.is_alphanumeric()).filter(|w|w.chars().count()>2)
        .map(str::to_lowercase).filter(|w| !["the","and","for","with","this","that"].contains(&w.as_str())).collect::<std::collections::HashSet<_>>();
    let a=words(a); let b=words(b);
    if a.is_empty() || b.is_empty() { return 0.; }
    a.intersection(&b).count() as f64 / a.union(&b).count() as f64
}

async fn sync_items(pool: &SqlitePool, meeting: &str, result: &str) -> Result<(), sqlx::Error> {
    let mut hash = std::collections::hash_map::DefaultHasher::new(); result.hash(&mut hash);
    let fingerprint = format!("{:x}", hash.finish());
    let mut tx = pool.begin().await?;
    let previous: Option<String> = sqlx::query_scalar("SELECT fingerprint FROM meeting_action_sources WHERE meeting_id=?").bind(meeting).fetch_optional(&mut *tx).await?;
    if previous.as_deref()==Some(&fingerprint) { return Ok(()); }
    let old = sqlx::query("SELECT id,canonical_text,text,owner,manual_edit FROM meeting_action_items WHERE meeting_id=? ORDER BY created_at").bind(meeting).fetch_all(&mut *tx).await?;
    let mut used = std::collections::HashSet::<String>::new();
    let mut seen = std::collections::HashSet::<String>::new();
    sqlx::query("UPDATE meeting_action_items SET source_latest=0 WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await?;
    for (canonical,text,owner,due) in report_items(result) {
        let norm = item_key(meeting,&canonical);
        if !seen.insert(format!("{}|{:?}|{:?}",norm,owner,due)) { continue; }
        let exact = old.iter().find(|row| !used.contains(row.get::<&str,_>("id")) && (item_key(meeting,row.get("canonical_text"))==norm || item_key(meeting,row.get("text"))==item_key(meeting,&text)));
        let similar = || {
            let mut candidates = old.iter().filter(|row| !used.contains(row.get::<&str,_>("id")))
                .map(|row| (row,similarity(row.get("canonical_text"),&canonical).max(similarity(row.get("text"),&text))))
                .filter(|(row,score)| *score >= 0.6 && row.get::<&str,_>("canonical_text").split_whitespace().next().map(str::to_lowercase) == canonical.split_whitespace().next().map(str::to_lowercase)).collect::<Vec<_>>();
            candidates.sort_by(|a,b|b.1.total_cmp(&a.1));
            // Ambiguous tasks must never inherit another task's completed state.
            if candidates.len()>1 && candidates[0].1-candidates[1].1<0.15 { return None; }
            candidates.first().map(|(row,_)|*row)
        };
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(row) = exact.or_else(similar) {
            let id: String = row.get("id"); used.insert(id.clone());
            sqlx::query("UPDATE meeting_action_items SET canonical_text=?,text=CASE WHEN manual_edit THEN text ELSE ? END,owner=CASE WHEN manual_edit THEN owner ELSE ? END,due=CASE WHEN manual_edit THEN due ELSE ? END,source_latest=1,updated_at=? WHERE id=?")
                .bind(&canonical).bind(&text).bind(&owner).bind(&due).bind(&now).bind(id).execute(&mut *tx).await?;
        } else {
            let done: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM action_item_state WHERE meeting_id=? AND item_key IN (?,?) AND done=1)")
                .bind(meeting).bind(&norm).bind(item_key(meeting,&text)).fetch_one(&mut *tx).await?;
            sqlx::query("INSERT INTO meeting_action_items(id,meeting_id,canonical_text,text,owner,due,done,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
                .bind(uuid::Uuid::new_v4().to_string()).bind(meeting).bind(canonical).bind(text).bind(owner).bind(due).bind(done).bind(&now).bind(&now).execute(&mut *tx).await?;
        }
    }
    sqlx::query("INSERT INTO meeting_action_sources(meeting_id,fingerprint) VALUES(?,?) ON CONFLICT(meeting_id) DO UPDATE SET fingerprint=excluded.fingerprint")
        .bind(meeting).bind(fingerprint).execute(&mut *tx).await?;
    tx.commit().await
}

#[tauri::command]
pub async fn api_list_action_items<R: Runtime>(_app: AppHandle<R>, state: tauri::State<'_, AppState>) -> Result<Vec<ActionItem>, String> {
    let pool=state.db_manager.pool();
    let rows: Vec<(String,String)> = sqlx::query_as("SELECT s.meeting_id,s.result FROM summary_processes s JOIN meetings m ON m.id=s.meeting_id WHERE s.result IS NOT NULL AND m.deleted_at IS NULL").fetch_all(pool).await.map_err(|e|e.to_string())?;
    for (meeting,result) in rows { sync_items(pool,&meeting,&result).await.map_err(|e|e.to_string())?; }
    sqlx::query("SELECT a.*,m.title,m.created_at AS meeting_created_at FROM meeting_action_items a JOIN meetings m ON m.id=a.meeting_id WHERE m.deleted_at IS NULL ORDER BY m.created_at DESC,a.created_at")
        .fetch_all(pool).await.map_err(|e|e.to_string()).map(|rows| rows.iter().map(|r| ActionItem { key:r.get("id"),meeting_id:r.get("meeting_id"),meeting_title:r.get("title"),created_at:r.get("meeting_created_at"),text:r.get("text"),owner:r.get("owner"),due:r.get("due"),done:r.get("done"),source_latest:r.get("source_latest") }).collect())
}

#[tauri::command]
pub async fn api_set_action_item_done<R: Runtime>(_app: AppHandle<R>, state: tauri::State<'_, AppState>, key:String, meeting_id:String, done:bool) -> Result<(),String> {
    let changed = sqlx::query("UPDATE meeting_action_items SET done=?,updated_at=? WHERE id=? AND meeting_id=?").bind(done).bind(chrono::Utc::now().to_rfc3339()).bind(key).bind(meeting_id).execute(state.db_manager.pool()).await.map_err(|e|e.to_string())?;
    if changed.rows_affected()==0 { return Err("This task could not be found. Refresh and try again.".into()); } Ok(())
}

#[tauri::command]
pub async fn api_edit_action_item<R: Runtime>(_app: AppHandle<R>, state: tauri::State<'_, AppState>, key:String, meeting_id:String, text:String, owner:Option<String>, due:Option<String>) -> Result<(),String> {
    if text.trim().is_empty() { return Err("Give the task a description.".into()); }
    let clean = |v:Option<String>| v.map(|s|s.trim().to_string()).filter(|s|!s.is_empty());
    let changed = sqlx::query("UPDATE meeting_action_items SET text=?,owner=?,due=?,manual_edit=1,updated_at=? WHERE id=? AND meeting_id=?")
        .bind(text.trim()).bind(clean(owner)).bind(clean(due)).bind(chrono::Utc::now().to_rfc3339()).bind(key).bind(meeting_id).execute(state.db_manager.pool()).await.map_err(|e|e.to_string())?;
    if changed.rows_affected()==0 { return Err("This task could not be found. Refresh and try again.".into()); } Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_bullets_bold_headings_and_tables() {
        let md = "# Sync\n\n## Summary\n- not an action\n\n## Action items\n- **Sam** to update the docs\n- None\n\n**Next Steps**\n1. Ship Friday\n\n## Owners and tasks\n| Owner | Task | Due |\n| --- | --- | --- |\n| Ana | Draft budget | Mon |\n\n## Risks\n- also not";
        let got: Vec<String> = extract(md).into_iter().map(|(t, _, _)| t).collect();
        assert_eq!(got, vec!["Sam to update the docs", "Ship Friday", "Draft budget"]);
        assert_eq!(extract(md)[2], ("Draft budget".into(), Some("Ana".into()), Some("Mon".into())));
    }

    #[test]
    fn drops_placeholders_quotes_and_timecodes_from_tables() {
        let md = "## Action Items\n| Owner | Task | Due | Context | Time |\n|---|---|---|---|---|\n| Alex | Check the transcript | Not specified | \"We decided to review\" | 00:00 |\n| None noted in this section | Verify sleep data | — | \"quote\" | 00:25-00:30 |";
        let got = extract(md);
        assert_eq!(got[0], ("Check the transcript".into(), Some("Alex".into()), None));
        assert_eq!(got[1], ("Verify sleep data".into(), None, None));
    }

    #[test]
    fn key_survives_formatting_changes() {
        assert_eq!(item_key("m", "Sam to update the docs."), item_key("m", "sam to update the docs"));
    }

    #[test]
    fn translated_headings_and_columns_keep_the_source_tasks() {
        let source="# Launch\n\n## Summary\nDiscussed launch.\n\n## Action items\n| Task | Owner | Due |\n|---|---|---|\n| Send budget | Alex | Friday |";
        let local="## Ամփոփում\nՔննարկվեց գործարկումը։\n\n## Անելիքներ\n| Առաջադրանք | Պատասխանատու | Ժամկետ |\n|---|---|---|\n| Ուղարկել բյուջեն | Ալեքս | Ուրբաթ |";
        let report=serde_json::json!({"markdown":local,"english_cache":{"markdown":source}}).to_string();
        assert_eq!(report_items(&report),vec![("Send budget".into(),"Ուղարկել բյուջեն".into(),Some("Ալեքս".into()),Some("Ուրբաթ".into()))]);
    }

    #[tokio::test]
    async fn reworded_tasks_keep_completion_and_manual_edits() {
        let pool=SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE meetings(id TEXT PRIMARY KEY); INSERT INTO meetings VALUES('m');").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260923130000_add_action_item_state.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260925092000_stable_action_items.sql")).execute(&pool).await.unwrap();
        let report=|text:&str|serde_json::json!({"markdown":format!("## Action items\n- {}",text)}).to_string();
        sync_items(&pool,"m",&report("Send the budget to Alex")).await.unwrap();
        let id:String=sqlx::query_scalar("SELECT id FROM meeting_action_items").fetch_one(&pool).await.unwrap();
        sqlx::query("UPDATE meeting_action_items SET done=1,manual_edit=1,text='Send the approved budget',owner='Sam'").execute(&pool).await.unwrap();
        sync_items(&pool,"m",&report("Send Alex the budget")).await.unwrap();
        let row:(String,String,bool,String)=sqlx::query_as("SELECT id,text,done,owner FROM meeting_action_items").fetch_one(&pool).await.unwrap();
        assert_eq!(row,(id,"Send the approved budget".into(),true,"Sam".into()));
        sync_items(&pool,"m",&report("Approve the budget for Alex")).await.unwrap();
        let rows:Vec<(bool,bool)>=sqlx::query_as("SELECT done,source_latest FROM meeting_action_items ORDER BY created_at").fetch_all(&pool).await.unwrap();
        assert_eq!(rows,vec![(true,false),(false,true)]);
    }
}
