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
    if parts.audio {
        if let Some(folder)=row.get::<Option<String>,_>("folder_path") {
            let folder=std::path::Path::new(&folder);
            // Only Tetro's named recording files; never remove an arbitrary
            // user-selected folder recursively or follow symlinks into it.
            if folder.symlink_metadata().is_ok_and(|m|m.file_type().is_symlink()) { return Err("This recording folder is a link. Remove its audio manually from the original folder.".into()); }
            while let Some(path)=crate::meeting_media::find_audio_file(folder) {
                if path.symlink_metadata().is_ok_and(|m|m.file_type().is_symlink()) { return Err("This audio is a link. Remove it manually from the recording folder.".into()); }
                std::fs::remove_file(path).map_err(|e|format!("Could not remove the audio: {}",e))?;
            }
            if parts.whole() { for file in ["transcripts.json","metadata.json"] { let path=folder.join(file); if path.exists() { std::fs::remove_file(path).map_err(|e|e.to_string())?; } } }
        }
    }
    if parts.whole() { crate::database::repositories::meeting::MeetingsRepository::delete_meeting(pool,&meeting).await.map_err(|e|e.to_string())?; }
    else {
        let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
        sqlx::query("DELETE FROM meeting_trash WHERE id=?").bind(id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
        if let Some(version)=row.get::<Option<String>,_>("version_id") { sqlx::query("DELETE FROM meeting_versions WHERE id=?").bind(version).execute(&mut *tx).await.map_err(|e|e.to_string())?; }
        tx.commit().await.map_err(|e|e.to_string())?;
    }
    crate::meeting_preferences::changed(&app,&meeting); Ok(())
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
        pool
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
