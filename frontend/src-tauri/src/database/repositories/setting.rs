use crate::database::models::{Setting, TranscriptSetting};
use crate::summary::CustomOpenAIConfig;
use sqlx::SqlitePool;
use crate::credentials::{self, Slot};

#[derive(serde::Deserialize, Debug)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

pub struct SettingsRepository;

// Transcript providers: localWhisper, deepgram, elevenLabs, groq, openai
// Summary providers: openai, claude, ollama, groq, added openrouter
// NOTE: Handle data exclusion in the higher layer as this is database abstraction layer(using SELECT *)

impl SettingsRepository {
    pub async fn get_model_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<Setting>, sqlx::Error> {
        let setting = sqlx::query_as::<_, Setting>("SELECT * FROM settings LIMIT 1")
            .fetch_optional(pool)
            .await?;
        Ok(setting)
    }

    pub async fn save_model_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
        whisper_model: &str,
        ollama_endpoint: Option<&str>,
    ) -> std::result::Result<(), sqlx::Error> {
        // Using id '1' for backward compatibility
        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, ollamaEndpoint)
            VALUES ('1', $1, $2, $3, $4)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                whisperModel = excluded.whisperModel,
                ollamaEndpoint = excluded.ollamaEndpoint
            "#,
        )
        .bind(provider)
        .bind(model)
        .bind(whisper_model)
        .bind(ollama_endpoint)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Keep setup from clearing a model that finished downloading while setup was closing.
    pub async fn ensure_unselected_summary_config(pool: &SqlitePool) -> std::result::Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO settings (id, provider, model, whisperModel) \
             VALUES ('1', 'builtin-ai', '', 'tiny') ON CONFLICT(id) DO NOTHING",
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    /// A setup download becomes the default only while no summary model has been chosen.
    /// The conditional update is atomic, so a newer explicit choice wins the race.
    pub async fn select_summary_model_if_unselected(
        pool: &SqlitePool,
        model: &str,
    ) -> std::result::Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO settings (id, provider, model, whisperModel) \
             VALUES ('1', 'builtin-ai', $1, 'tiny') \
             ON CONFLICT(id) DO UPDATE SET model = excluded.model, whisperModel = excluded.whisperModel \
             WHERE settings.provider = 'builtin-ai' AND settings.model = ''",
        )
        .bind(model)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn save_api_key(pool: &SqlitePool, provider: &str, api_key: &str) -> Result<(), sqlx::Error> {
        if let Some(slot) = Slot::summary(provider)? { credentials::write(pool, slot, api_key).await?; }
        Ok(())
    }

    pub async fn get_api_key(pool: &SqlitePool, provider: &str) -> Result<Option<String>, sqlx::Error> {
        if provider == "custom-openai" { return Ok(Self::get_custom_openai_config(pool).await?.and_then(|c| c.api_key)); }
        match Slot::summary(provider)? { Some(slot) => credentials::read(pool, slot).await, None => Ok(None) }
    }

    pub async fn get_transcript_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<TranscriptSetting>, sqlx::Error> {
        let setting =
            sqlx::query_as::<_, TranscriptSetting>("SELECT * FROM transcript_settings LIMIT 1")
                .fetch_optional(pool)
                .await?;
        Ok(setting)

    }

    pub async fn save_transcript_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO transcript_settings (id, provider, model)
            VALUES ('1', $1, $2)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model
            "#,
        )
        .bind(provider)
        .bind(model)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Finish setup without overwriting a download that selected a model first.
    pub async fn initialize_onboarding_transcript_config(
        pool: &SqlitePool,
        parakeet_ready: bool,
    ) -> Result<(), sqlx::Error> {
        let (provider, model) = if parakeet_ready {
            ("parakeet", "stt-parakeet-multilingual")
        } else {
            ("localWhisper", "tiny")
        };
        sqlx::query(
            r#"
            INSERT INTO transcript_settings (id, provider, model)
            VALUES ('1', $1, $2)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model
            WHERE transcript_settings.model = ''
               OR (transcript_settings.provider = 'localWhisper' AND transcript_settings.model = 'tiny')
            "#,
        )
        .bind(provider)
        .bind(model)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn save_transcript_api_key(pool: &SqlitePool, provider: &str, api_key: &str) -> Result<(), sqlx::Error> {
        if let Some(slot) = Slot::transcription(provider)? { credentials::write(pool, slot, api_key).await?; }
        Ok(())
    }

    pub async fn get_transcript_api_key(pool: &SqlitePool, provider: &str) -> Result<Option<String>, sqlx::Error> {
        match Slot::transcription(provider)? { Some(slot) => credentials::read(pool, slot).await, None => Ok(None) }
    }

    pub async fn delete_api_key(pool: &SqlitePool, provider: &str) -> Result<(), sqlx::Error> {
        if provider == "custom-openai" {
            if let Some(config) = Self::get_custom_openai_config(pool).await? {
                credentials::delete(pool, Slot::custom(&config.endpoint)).await?;
            }
            sqlx::query("UPDATE settings SET customOpenAIConfig = NULL WHERE id = '1'").execute(pool).await?;
        } else if let Some(slot) = Slot::summary(provider)? { credentials::delete(pool, slot).await?; }
        Ok(())
    }

    // ===== CUSTOM OPENAI CONFIG METHODS =====

    /// Gets the custom OpenAI configuration from JSON
    ///
    /// # Returns
    /// * `Ok(Some(CustomOpenAIConfig))` - Config exists and is valid JSON
    /// * `Ok(None)` - No config stored
    /// * `Err(sqlx::Error)` - Database error
    pub async fn get_custom_openai_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<CustomOpenAIConfig>, sqlx::Error> {
        use sqlx::Row;

        let row = sqlx::query(
            r#"
            SELECT customOpenAIConfig
            FROM settings
            WHERE id = '1'
            LIMIT 1
            "#
        )
        .fetch_optional(pool)
        .await?;

        match row {
            Some(record) => {
                let config_json: Option<String> = record.get("customOpenAIConfig");

                if let Some(json) = config_json {
                    // Parse JSON into CustomOpenAIConfig
                    let mut config: CustomOpenAIConfig = serde_json::from_str(&json)
                        .map_err(|_| sqlx::Error::Protocol(
                            "Invalid custom provider configuration".into()
                        ))?;

                    config.api_key = credentials::read(pool, Slot::custom(&config.endpoint)).await?;
                    Ok(Some(config))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    /// Saves the custom OpenAI configuration as JSON
    ///
    /// # Arguments
    /// * `pool` - Database connection pool
    /// * `config` - CustomOpenAIConfig to save (includes endpoint, apiKey, model, maxTokens, temperature, topP)
    ///
    /// # Returns
    /// * `Ok(())` - Config saved successfully
    /// * `Err(sqlx::Error)` - Database or JSON serialization error
    pub async fn save_custom_openai_config(
        pool: &SqlitePool,
        config: &CustomOpenAIConfig,
    ) -> std::result::Result<(), sqlx::Error> {
        // Migrate the previous endpoint's key before changing its settings. Never carry it to a different endpoint.
        let previous = Self::get_custom_openai_config(pool).await?;
        let slot = Slot::custom(&config.endpoint);
        if let Some(key) = config.api_key.as_deref() {
            if key.is_empty() { credentials::delete(pool, slot).await?; }
            else { credentials::write(pool, slot, key).await?; }
        }
        let mut public_config = config.clone();
        public_config.api_key = None;
        let config_json = serde_json::to_string(&public_config)
            .map_err(|e| sqlx::Error::Protocol(
                format!("Failed to serialize config to JSON: {}", e).into()
            ))?;

        // Upsert into settings table
        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, customOpenAIConfig)
            VALUES ('1', 'custom-openai', $1, 'large-v3', $2)
            ON CONFLICT(id) DO UPDATE SET
                customOpenAIConfig = excluded.customOpenAIConfig
            "#,
        )
        .bind(&config.model)
        .bind(config_json)
        .execute(pool)
        .await?;

        if let Some(old) = previous {
            if old.endpoint.trim_end_matches('/') != config.endpoint.trim_end_matches('/') {
                credentials::delete(pool, Slot::custom(&old.endpoint)).await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod onboarding_model_tests {
    use super::*;

    async fn transcript_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE transcript_settings (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL)")
            .execute(&pool).await.unwrap();
        pool
    }

    async fn selected_transcriber(pool: &SqlitePool) -> (String, String) {
        sqlx::query_as("SELECT provider, model FROM transcript_settings WHERE id = '1'")
            .fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn onboarding_uses_downloaded_parakeet_instead_of_bundled_tiny() {
        let pool = transcript_pool().await;
        SettingsRepository::initialize_onboarding_transcript_config(&pool, false).await.unwrap();
        assert_eq!(selected_transcriber(&pool).await, ("localWhisper".into(), "tiny".into()));
        // A resumed setup discovers the recommended model downloaded previously.
        SettingsRepository::initialize_onboarding_transcript_config(&pool, true).await.unwrap();
        assert_eq!(selected_transcriber(&pool).await, ("parakeet".into(), "stt-parakeet-multilingual".into()));
    }

    #[tokio::test]
    async fn onboarding_cannot_overwrite_a_download_that_finishes_after_its_readiness_check() {
        let pool = transcript_pool().await;
        SettingsRepository::save_transcript_config(&pool, "parakeet", "stt-parakeet-multilingual").await.unwrap();
        // Stale readiness snapshot: the download bridge saved Parakeet meanwhile.
        SettingsRepository::initialize_onboarding_transcript_config(&pool, false).await.unwrap();
        assert_eq!(selected_transcriber(&pool).await, ("parakeet".into(), "stt-parakeet-multilingual".into()));
    }

    #[tokio::test]
    async fn onboarding_preserves_an_explicit_nondefault_transcriber() {
        let pool = transcript_pool().await;
        SettingsRepository::save_transcript_config(&pool, "parakeet", "stt-fastconformer-armenian").await.unwrap();
        SettingsRepository::initialize_onboarding_transcript_config(&pool, true).await.unwrap();
        assert_eq!(selected_transcriber(&pool).await, ("parakeet".into(), "stt-fastconformer-armenian".into()));
    }

    #[tokio::test]
    async fn setup_download_selects_once_without_overwriting_a_later_choice() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE settings (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, whisperModel TEXT NOT NULL)")
            .execute(&pool).await.unwrap();

        SettingsRepository::ensure_unselected_summary_config(&pool).await.unwrap();
        assert!(SettingsRepository::select_summary_model_if_unselected(&pool, "qwen3.5:2b").await.unwrap());
        // Finishing setup after the download must leave the selected model in place.
        SettingsRepository::ensure_unselected_summary_config(&pool).await.unwrap();
        assert!(!SettingsRepository::select_summary_model_if_unselected(&pool, "qwen3.5:4b").await.unwrap());

        let (provider, model): (String, String) = sqlx::query_as("SELECT provider, model FROM settings WHERE id = '1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!((provider.as_str(), model.as_str()), ("builtin-ai", "qwen3.5:2b"));

        sqlx::query("UPDATE settings SET provider = 'openai', model = 'chosen-model' WHERE id = '1'")
            .execute(&pool).await.unwrap();
        assert!(!SettingsRepository::select_summary_model_if_unselected(&pool, "qwen3.5:2b").await.unwrap());
        let (provider, model): (String, String) = sqlx::query_as("SELECT provider, model FROM settings WHERE id = '1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!((provider.as_str(), model.as_str()), ("openai", "chosen-model"));
    }
}
