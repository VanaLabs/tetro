//! Recoverable deletion. Files stay on this device until the person explicitly
//! deletes the Trash item permanently; restoring does not depend on moving files.
use crate::{meeting_edits, state::AppState};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Runtime};

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Parts { pub transcript: bool, pub summary: bool, pub audio: bool }
impl Parts {
    pub fn all() -> Self { Self { transcript:true,summary:true,audio:true } }
    fn whole(&self) -> bool { self.transcript && self.summary && self.audio }
    fn any(&self) -> bool { self.transcript || self.summary || self.audio }
}

pub async fn move_to_trash(pool: &SqlitePool, meeting: &str, parts: Parts) -> Result<String, String> {
    if !parts.any() { return Err("Choose something to remove.".into()); }
    let _guard = meeting_edits::EDIT_GATE.lock().await;
    if crate::audio::retranscription::is_retranscription_in_progress() { return Err("Stop transcription before removing this recording.".into()); }
    let mut tx = pool.begin().await.map_err(|e|e.to_string())?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL)").bind(meeting).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    if !exists { return Err("This meeting is already in Trash or could not be found.".into()); }
    let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM summary_processes WHERE meeting_id=? AND LOWER(status)='pending')").bind(meeting).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    if pending { return Err("Stop summarizing before removing this meeting.".into()); }
    let version = if parts.whole() || (!parts.transcript && !parts.summary) { None } else { Some(meeting_edits::snapshot(&mut tx,meeting,if parts.transcript && parts.summary { "correction" } else if parts.transcript { "transcript" } else { "summary" },"Before moving items to Trash").await.map_err(|e|e.to_string())?) };
    let tasks: String = sqlx::query_scalar("SELECT json_group_array(json_object('id',id,'canonical_text',canonical_text,'text',text,'owner',owner,'due',due,'done',done,'manual_edit',manual_edit,'source_latest',source_latest,'created_at',created_at,'updated_at',updated_at)) FROM meeting_action_items WHERE meeting_id=?")
        .bind(meeting).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string(); let now=chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO meeting_trash(id,meeting_id,parts,version_id,tasks,created_at) VALUES(?,?,?,?,?,?)").bind(&id).bind(meeting).bind(serde_json::to_string(&parts).unwrap()).bind(version).bind(tasks).bind(&now).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    if parts.whole() {
        sqlx::query("UPDATE meetings SET deleted_at=? WHERE id=?").bind(&now).bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    } else {
        if parts.transcript {
            sqlx::query("DELETE FROM transcripts WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("DELETE FROM meeting_edits WHERE meeting_id=? AND kind='transcript'").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        if parts.summary {
            sqlx::query("UPDATE summary_processes SET result=NULL,result_backup=NULL,status='idle',error=NULL WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("DELETE FROM meeting_edits WHERE meeting_id=? AND kind='summary'").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("DELETE FROM meeting_action_items WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("DELETE FROM meeting_action_sources WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        if parts.audio { sqlx::query("UPDATE meetings SET audio_trashed=1 WHERE id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?; }
    }
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn api_move_to_trash<R: Runtime>(app:AppHandle<R>,state:tauri::State<'_,AppState>,meeting_id:String,parts:Parts)->Result<String,String> {
    let sync_file=parts.transcript && !parts.whole();
    let id=move_to_trash(state.db_manager.pool(),&meeting_id,parts).await?;
    if sync_file { meeting_edits::sync_transcript_with_warning(&app,state.db_manager.pool(),&meeting_id).await; }
    crate::meeting_preferences::changed(&app,&meeting_id); Ok(id)
}

#[derive(Serialize)]
pub struct TrashItem { id:String,meeting_id:String,title:String,parts:Parts,created_at:String }
#[tauri::command]
pub async fn api_list_trash(state:tauri::State<'_,AppState>)->Result<Vec<TrashItem>,String> {
    sqlx::query("SELECT t.*,m.title FROM meeting_trash t JOIN meetings m ON t.meeting_id=m.id ORDER BY t.created_at DESC")
        .fetch_all(state.db_manager.pool()).await.map_err(|e|e.to_string())?.iter().map(|r|Ok(TrashItem{id:r.get("id"),meeting_id:r.get("meeting_id"),title:r.get("title"),parts:serde_json::from_str(r.get("parts")).map_err(|e|format!("Could not read a Trash item: {}",e))?,created_at:r.get("created_at")})).collect()
}

pub async fn restore_item(pool:&SqlitePool,id:&str)->Result<String,String> {
    let _guard=meeting_edits::EDIT_GATE.lock().await;
    let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
    let row=sqlx::query("SELECT * FROM meeting_trash WHERE id=?").bind(id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    let meeting:String=row.get("meeting_id");
    let parts:Parts=serde_json::from_str(row.get("parts")).map_err(|e|e.to_string())?;
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM summary_processes WHERE meeting_id=? AND LOWER(status)='pending')").bind(&meeting).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
    if pending || crate::audio::retranscription::is_retranscription_in_progress() { return Err("Stop the current job before restoring these items.".into()); }
    if parts.whole() { sqlx::query("UPDATE meetings SET deleted_at=NULL WHERE id=?").bind(&meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?; }
    else {
        if parts.transcript || parts.summary {
            let version:String=row.get("version_id");
            let payload:String=sqlx::query_scalar("SELECT payload FROM meeting_versions WHERE id=? AND meeting_id=?").bind(version).bind(&meeting).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
            meeting_edits::restore(&mut tx,&meeting,if parts.transcript && parts.summary { "correction" } else if parts.transcript { "transcript" } else { "summary" },&payload).await.map_err(|e|e.to_string())?;
        }
        if parts.audio { sqlx::query("UPDATE meetings SET audio_trashed=0 WHERE id=?").bind(&meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?; }
        if parts.summary {
            sqlx::query("INSERT OR IGNORE INTO meeting_action_items(id,meeting_id,canonical_text,text,owner,due,done,manual_edit,source_latest,created_at,updated_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.canonical_text'),json_extract(value,'$.text'),json_extract(value,'$.owner'),json_extract(value,'$.due'),json_extract(value,'$.done'),json_extract(value,'$.manual_edit'),json_extract(value,'$.source_latest'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(?)")
                .bind(&meeting).bind(row.get::<Option<String>,_>("tasks").unwrap_or("[]".into())).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("DELETE FROM meeting_action_sources WHERE meeting_id=?").bind(&meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
    }
    sqlx::query("DELETE FROM meeting_trash WHERE id=?").bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(meeting)
}

#[tauri::command]
pub async fn api_restore_trash<R:Runtime>(app:AppHandle<R>,state:tauri::State<'_,AppState>,id:String)->Result<String,String> {
    let meeting=restore_item(state.db_manager.pool(),&id).await?;
    meeting_edits::sync_transcript_with_warning(&app,state.db_manager.pool(),&meeting).await;
    crate::meeting_preferences::changed(&app,&meeting); Ok(meeting)
}

#[tauri::command]
pub async fn api_delete_trash_permanently<R:Runtime>(app:AppHandle<R>,state:tauri::State<'_,AppState>,id:String)->Result<(),String> {
    let _guard=meeting_edits::EDIT_GATE.lock().await;
    let pool=state.db_manager.pool();
    let row=sqlx::query("SELECT t.*,m.folder_path FROM meeting_trash t JOIN meetings m ON m.id=t.meeting_id WHERE t.id=?").bind(&id).fetch_one(pool).await.map_err(|e|e.to_string())?;
    let meeting:String=row.get("meeting_id");
    let parts:Parts=serde_json::from_str(row.get("parts")).map_err(|e|e.to_string())?;
    let folder = row.get::<Option<String>,_>("folder_path");
    if let Some(folder) = folder.as_deref().filter(|p| std::path::Path::new(p).exists()) {
        let folder=crate::recording_paths::folder(std::path::Path::new(folder))?;
        if parts.audio {
            while let Some(path)=crate::meeting_media::find_audio_file(&folder) {
                crate::recording_paths::child(&folder,path.file_name().and_then(|n|n.to_str()).ok_or("Invalid audio file")?)?;
                std::fs::remove_file(path).map_err(|e|e.to_string())?;
            }
            let checkpoints=crate::recording_paths::child(&folder,".checkpoints")?;
            if checkpoints.exists() { std::fs::remove_dir_all(checkpoints).map_err(|e|e.to_string())?; }
        }
        if parts.transcript { let path=crate::recording_paths::child(&folder,"transcripts.json")?; if path.exists() {std::fs::remove_file(path).map_err(|e|e.to_string())?;} }
        if parts.whole() { let path=crate::recording_paths::child(&folder,"metadata.json")?; if path.exists() {std::fs::remove_file(path).map_err(|e|e.to_string())?;} }
    }
    purge_deleted_content(pool,&id,&meeting,&parts).await?;
    use tauri::Emitter;
    let _=app.emit("tetro-local-cleanup",());
    crate::meeting_preferences::changed(&app,&meeting); Ok(())
}

async fn purge_deleted_content(pool:&SqlitePool,id:&str,meeting:&str,parts:&Parts)->Result<(),String> {
    let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
    let mut ids:Vec<String>=sqlx::query_scalar("SELECT id FROM transcripts WHERE meeting_id=?").bind(meeting).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let versions:Vec<(String,String)>=sqlx::query_as("SELECT id,payload FROM meeting_versions WHERE meeting_id=?").bind(meeting).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    for (version,payload) in versions {
        let mut value:serde_json::Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
        if let Some(lines)=value["transcripts"].as_array() { ids.extend(lines.iter().filter_map(|line|line["id"].as_str().map(str::to_owned))); }
        if parts.transcript { value["transcripts"]=serde_json::json!([]); }
        if parts.summary {
            value["summary"]=serde_json::Value::Null;
            if let Some(lines)=value["transcripts"].as_array_mut() {
                for line in lines { for field in ["summary", "action_items", "key_points"] { line[field]=serde_json::Value::Null; } }
            }
        }
        if let Some(edits)=value["edits"].as_array_mut() { edits.retain(|e| !(parts.transcript && e["kind"]=="transcript" || parts.summary && e["kind"]=="summary")); }
        sqlx::query("UPDATE meeting_versions SET payload=? WHERE id=?").bind(value.to_string()).bind(version).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    ids.sort();ids.dedup();
    sqlx::query("INSERT INTO local_deletion_cleanup(id,meeting_id,transcript_ids,parts) VALUES(?,?,?,?)").bind(uuid::Uuid::new_v4().to_string()).bind(meeting).bind(serde_json::to_string(&ids).unwrap()).bind(serde_json::to_string(parts).unwrap()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    if parts.whole() {
        sqlx::query("DELETE FROM meetings WHERE id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    } else {
        if parts.transcript {
            sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        if parts.summary {
            sqlx::query("UPDATE transcripts SET summary=NULL,action_items=NULL,key_points=NULL WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            sqlx::query("UPDATE meeting_trash SET tasks='[]' WHERE meeting_id=?").bind(meeting).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        }
        sqlx::query("DELETE FROM meeting_trash WHERE id=?").bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(())
}

#[derive(Serialize,sqlx::FromRow)]
pub struct CleanupReceipt { id:String, meeting_id:String, transcript_ids:String, parts:String }
#[tauri::command]
pub async fn api_pending_local_cleanup(state:tauri::State<'_,AppState>)->Result<Vec<CleanupReceipt>,String> {
    sqlx::query_as("SELECT * FROM local_deletion_cleanup").fetch_all(state.db_manager.pool()).await.map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn api_ack_local_cleanup(state:tauri::State<'_,AppState>,id:String)->Result<(),String> {
    sqlx::query("DELETE FROM local_deletion_cleanup WHERE id=?").bind(id).execute(state.db_manager.pool()).await.map_err(|e|e.to_string())?;Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn pool()->SqlitePool {
        let pool=meeting_edits::tests::pool().await;
        sqlx::raw_sql(include_str!("../migrations/20260923130000_add_action_item_state.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260925092000_stable_action_items.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260925093000_meeting_trash.sql")).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcripts(id,meeting_id,transcript,timestamp,audio_start_time) VALUES('line','m','Our corrected transcript','',2)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO summary_processes(meeting_id,status,created_at,updated_at,result) VALUES('m','completed','','','{\"markdown\":\"Our notes\"}')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meeting_action_items(id,meeting_id,canonical_text,text,done,created_at,updated_at) VALUES('task','m','Send budget','Send budget',1,'','')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meeting_marks VALUES('mark','m',2.5,'')").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/20260929180000_local_deletion_cleanup.sql")).execute(&pool).await.unwrap();
        pool
    }
    #[tokio::test]
    async fn permanent_summary_deletion_redacts_old_versions_but_preserves_transcripts() {
        let pool=pool().await;
        sqlx::query("UPDATE transcripts SET summary='Old embedded summary'").execute(&pool).await.unwrap();
        meeting_edits::save_version(&pool,"m","summary","Older notes").await.unwrap();
        let id=move_to_trash(&pool,"m",Parts{summary:true,..Parts::default()}).await.unwrap();
        purge_deleted_content(&pool,&id,"m",&Parts{summary:true,..Parts::default()}).await.unwrap();
        let payloads:Vec<String>=sqlx::query_scalar("SELECT payload FROM meeting_versions").fetch_all(&pool).await.unwrap();
        assert!(payloads.iter().all(|v|!v.contains("Our notes") && !v.contains("Old embedded summary") && v.contains("Our corrected transcript")));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM local_deletion_cleanup").fetch_one(&pool).await.unwrap(),1);
    }
    #[tokio::test]
    async fn full_meeting_returns_with_its_content_and_completed_tasks() {
        let pool=pool().await;
        let id=move_to_trash(&pool,"m",Parts::all()).await.unwrap();
        assert!(crate::database::repositories::meeting::MeetingsRepository::get_meetings(&pool).await.unwrap().is_empty());
        assert_eq!(restore_item(&pool,&id).await.unwrap(),"m");
        assert_eq!(crate::database::repositories::meeting::MeetingsRepository::get_meetings(&pool).await.unwrap().len(),1);
        assert!(sqlx::query_scalar::<_,bool>("SELECT done FROM meeting_action_items").fetch_one(&pool).await.unwrap());
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT transcript FROM transcripts").fetch_one(&pool).await.unwrap(),"Our corrected transcript");
    }
    #[tokio::test]
    async fn partial_notes_restore_keeps_transcript_marks_and_task_completion() {
        let pool=pool().await;
        let id=move_to_trash(&pool,"m",Parts{summary:true,..Parts::default()}).await.unwrap();
        assert!(sqlx::query_scalar::<_,Option<String>>("SELECT result FROM summary_processes").fetch_one(&pool).await.unwrap().is_none());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM meeting_action_items").fetch_one(&pool).await.unwrap(),0);
        restore_item(&pool,&id).await.unwrap();
        assert!(sqlx::query_scalar::<_,bool>("SELECT done FROM meeting_action_items").fetch_one(&pool).await.unwrap());
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT transcript FROM transcripts").fetch_one(&pool).await.unwrap(),"Our corrected transcript");
        assert_eq!(sqlx::query_scalar::<_,f64>("SELECT at_seconds FROM meeting_marks").fetch_one(&pool).await.unwrap(),2.5);
    }
}
