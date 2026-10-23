use crate::database::models::SummaryProcess;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{error, info as log_info};

pub struct SummaryProcessesRepository;

impl SummaryProcessesRepository {
    /// Retrieves the current summary process state for a given meeting ID.
    pub async fn get_summary_data(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>("SELECT * FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
    }

    pub async fn update_meeting_summary(
        pool: &SqlitePool,
        meeting_id: &str,
        summary: &Value,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = pool.begin().await?;

        let meeting_exists: bool = sqlx::query("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();

        if !meeting_exists {
            log_info!(
                "Attempted to save summary for a non-existent meeting_id: {}",
                meeting_id
            );
            transaction.rollback().await?;
            return Ok(false);
        }

        let result_json = serde_json::to_string(summary);
        if result_json.is_err() {
            error!("Can't convert the json to string for saving to Database");
            transaction.rollback().await?;
            return Ok(false);
        }
        let now = Utc::now();
        let update = sqlx::query("UPDATE summary_processes SET result = ?, updated_at = ? WHERE meeting_id = ?")
            .bind(&result_json.unwrap())
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        if update.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false);
        }

        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;

        log_info!(
            "Successfully updated summary and timestamp for meeting_id: {}",
            meeting_id
        );
        Ok(true)
    }

    pub async fn get_summary_data_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>(
            "SELECT p.* FROM summary_processes p JOIN transcript_chunks t ON p.meeting_id = t.meeting_id WHERE p.meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create_or_reset_process(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        resume_translation: bool,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Creating or resetting summary process for meeting_id: {}",
            meeting_id
        );
        sqlx::query(
            r#"
            INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time, result, error)
            VALUES (?, 'PENDING', ?, ?, ?, NULL, NULL)
            ON CONFLICT(meeting_id) DO UPDATE SET
                status = 'PENDING',
                updated_at = excluded.updated_at,
                start_time = excluded.start_time,
                result_backup = result,
                result_backup_timestamp = excluded.updated_at,
                result = result,
                translation_checkpoint = CASE WHEN ? AND LOWER(status) = 'failed' THEN translation_checkpoint ELSE NULL END,
                error = NULL
            "#
        )
        .bind(meeting_id)
        .bind(started_at)
        .bind(started_at)
        .bind(started_at)
        .bind(resume_translation)
        .execute(pool)
        .await?;
        log_info!(
            "Backed up existing summary before regeneration for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn get_translation_checkpoint(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
    ) -> Result<Option<String>, sqlx::Error> {
        Ok(sqlx::query_scalar::<_, Option<String>>(
            "SELECT translation_checkpoint FROM summary_processes WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'",
        ).bind(meeting_id).bind(started_at).fetch_optional(pool).await?.flatten())
    }

    pub async fn save_translation_checkpoint(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        checkpoint: &str,
    ) -> Result<bool, sqlx::Error> {
        let update = sqlx::query(
            "UPDATE summary_processes SET translation_checkpoint = ? WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'",
        ).bind(checkpoint).bind(meeting_id).bind(started_at).execute(pool).await?;
        Ok(update.rows_affected() == 1)
    }

    pub async fn update_process_completed(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        result: Value,
        chunk_count: i64,
        processing_time: f64,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        let result_str = serde_json::to_string(&result)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize result: {}", e)))?;

        let update = sqlx::query(
            r#"
            UPDATE summary_processes
            SET status = 'completed', result = ?, updated_at = ?, end_time = ?, chunk_count = ?, processing_time = ?, error = NULL, result_backup = NULL, result_backup_timestamp = NULL, translation_checkpoint = NULL
            WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'
            "#
        )
        .bind(result_str)
        .bind(now)
        .bind(now)
        .bind(chunk_count)
        .bind(processing_time)
        .bind(meeting_id)
        .bind(started_at)
        .execute(pool)
        .await?;
        Ok(update.rows_affected() == 1)
    }

    pub async fn update_process_failed(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        error: &str,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();

        let update = sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'failed',
                error = ?,
                updated_at = ?,
                end_time = ?,
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'
            "#,
        )
        .bind(error)
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .bind(started_at)
        .execute(pool)
        .await?;
        Ok(update.rows_affected() == 1)
    }

    pub async fn update_process_cancelled(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();

        let update = sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'cancelled',
                updated_at = ?,
                end_time = ?,
                error = 'Generation was cancelled by user',
                translation_checkpoint = NULL,
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .bind(started_at)
        .execute(pool)
        .await?;
        Ok(update.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE summary_processes (
                meeting_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                start_time TEXT,
                result TEXT,
                result_backup TEXT,
                result_backup_timestamp TEXT,
                end_time TEXT,
                chunk_count INTEGER,
                processing_time REAL,
                error TEXT,
                translation_checkpoint TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn seed_pending(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        result: Option<&str>,
        result_backup: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO summary_processes (
                meeting_id, status, created_at, updated_at, start_time, result, result_backup
            ) VALUES (?, 'PENDING', ?, ?, ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(started_at)
        .bind(started_at)
        .bind(started_at)
        .bind(result)
        .bind(result_backup)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn terminal_compare_and_set_preserves_first_writer() {
        let pool = test_pool().await;
        let completed_start = Utc::now();
        seed_pending(&pool, "completed-first", completed_start, None, None).await;
        assert!(
            SummaryProcessesRepository::update_process_completed(
                &pool,
                "completed-first",
                completed_start,
                json!({"markdown": "completed"}),
                1,
                1.0,
            )
            .await
            .unwrap()
        );
        assert!(
            !SummaryProcessesRepository::update_process_cancelled(
                &pool,
                "completed-first",
                completed_start,
            )
            .await
            .unwrap()
        );
        let completed_status: String = sqlx::query_scalar(
            "SELECT status FROM summary_processes WHERE meeting_id = 'completed-first'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(completed_status, "completed");

        let cancelled_start = completed_start + chrono::Duration::nanoseconds(1);
        let previous = r#"{"markdown":"previous"}"#;
        seed_pending(
            &pool,
            "cancelled-first",
            cancelled_start,
            Some(previous),
            Some(previous),
        )
        .await;
        assert!(
            SummaryProcessesRepository::update_process_cancelled(
                &pool,
                "cancelled-first",
                cancelled_start,
            )
            .await
            .unwrap()
        );
        assert!(
            !SummaryProcessesRepository::update_process_completed(
                &pool,
                "cancelled-first",
                cancelled_start,
                json!({"markdown": "completed"}),
                1,
                1.0,
            )
            .await
            .unwrap()
        );
        let cancelled: (String, String) = sqlx::query_as(
            "SELECT status, result FROM summary_processes WHERE meeting_id = 'cancelled-first'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(cancelled, ("cancelled".to_string(), previous.to_string()));
    }

    #[tokio::test]
    async fn cancelled_compare_and_set_rejects_stale_start_time() {
        let pool = test_pool().await;
        let current_start = Utc::now();
        seed_pending(&pool, "stale-cancel", current_start, None, None).await;
        assert!(
            !SummaryProcessesRepository::update_process_cancelled(
                &pool,
                "stale-cancel",
                current_start - chrono::Duration::nanoseconds(1),
            )
            .await
            .unwrap()
        );
        let status: String =
            sqlx::query_scalar("SELECT status FROM summary_processes WHERE meeting_id = 'stale-cancel'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "PENDING");
    }

    #[tokio::test]
    async fn translation_failure_keeps_checkpoint_and_previous_summary_until_retry_finishes() {
        let pool = test_pool().await;
        let start = Utc::now();
        let previous = r#"{"markdown":"My edited summary"}"#;
        seed_pending(&pool, "retry", start, Some(previous), Some(previous)).await;
        assert!(SummaryProcessesRepository::save_translation_checkpoint(&pool, "retry", start, "checkpoint").await.unwrap());
        assert!(SummaryProcessesRepository::update_process_failed(&pool, "retry", start, "Translation timed out").await.unwrap());
        let saved: (String,String) = sqlx::query_as("SELECT result,translation_checkpoint FROM summary_processes WHERE meeting_id='retry'").fetch_one(&pool).await.unwrap();
        assert_eq!(saved, (previous.into(), "checkpoint".into()));
        let retry = start + chrono::Duration::seconds(1);
        SummaryProcessesRepository::create_or_reset_process(&pool, "retry", retry, true).await.unwrap();
        assert_eq!(SummaryProcessesRepository::get_translation_checkpoint(&pool, "retry", retry).await.unwrap().as_deref(), Some("checkpoint"));
        assert!(!SummaryProcessesRepository::save_translation_checkpoint(&pool, "retry", start, "stale").await.unwrap());
        assert!(!SummaryProcessesRepository::update_process_completed(&pool, "retry", start, json!({"markdown":"late"}), 1, 1.0).await.unwrap());
        assert!(SummaryProcessesRepository::update_process_completed(&pool, "retry", retry, json!({"markdown":"Translated"}), 1, 1.0).await.unwrap());
        let checkpoint: Option<String> = sqlx::query_scalar("SELECT translation_checkpoint FROM summary_processes WHERE meeting_id='retry'").fetch_one(&pool).await.unwrap();
        assert!(checkpoint.is_none());
    }

    #[tokio::test]
    async fn fresh_generation_and_cancel_clear_translation_checkpoints() {
        let pool = test_pool().await;
        let start = Utc::now();
        seed_pending(&pool, "fresh", start, None, None).await;
        SummaryProcessesRepository::save_translation_checkpoint(&pool, "fresh", start, "old").await.unwrap();
        SummaryProcessesRepository::update_process_failed(&pool, "fresh", start, "failed").await.unwrap();
        let next = start + chrono::Duration::seconds(1);
        SummaryProcessesRepository::create_or_reset_process(&pool, "fresh", next, false).await.unwrap();
        assert!(SummaryProcessesRepository::get_translation_checkpoint(&pool, "fresh", next).await.unwrap().is_none());
        SummaryProcessesRepository::save_translation_checkpoint(&pool, "fresh", next, "new").await.unwrap();
        assert!(SummaryProcessesRepository::update_process_cancelled(&pool, "fresh", next).await.unwrap());
        assert!(!SummaryProcessesRepository::save_translation_checkpoint(&pool, "fresh", next, "late").await.unwrap());
        let retry = next + chrono::Duration::seconds(1);
        SummaryProcessesRepository::create_or_reset_process(&pool, "fresh", retry, true).await.unwrap();
        assert!(SummaryProcessesRepository::get_translation_checkpoint(&pool, "fresh", retry).await.unwrap().is_none());
    }

}
