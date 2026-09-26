//! One-shot prompts to the user's configured notes model (same provider, key and endpoint
//! used for meeting notes). Shared by template drafting and speaker labels.

use crate::database::repositories::setting::SettingsRepository;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

pub struct NotesModel {
    provider: LLMProvider,
    model: String,
    api_key: String,
    ollama_endpoint: Option<String>,
    custom_endpoint: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
}

impl NotesModel {
    pub async fn load(pool: &SqlitePool) -> Result<Self, String> {
        let config = SettingsRepository::get_model_config(pool)
            .await
            .map_err(|e| format!("Could not read the notes model settings: {}", e))?
            .ok_or("Choose a notes model in Settings → Notes first.")?;
        let provider = LLMProvider::from_str(&config.provider)?;
        let (api_key, custom_endpoint, max_tokens, temperature, top_p) = match provider {
            LLMProvider::Ollama | LLMProvider::BuiltInAI => (String::new(), None, None, None, None),
            LLMProvider::CustomOpenAI => {
                let c = SettingsRepository::get_custom_openai_config(pool)
                    .await
                    .map_err(|e| format!("Could not read the custom endpoint settings: {}", e))?
                    .ok_or("The custom AI endpoint is not configured yet.")?;
                (c.api_key.unwrap_or_default(), Some(c.endpoint), c.max_tokens.map(|t| t as u32), c.temperature, c.top_p)
            }
            _ => {
                let key = SettingsRepository::get_api_key(pool, &config.provider)
                    .await
                    .map_err(|e| format!("Could not read the API key: {}", e))?
                    .filter(|k| !k.is_empty())
                    .ok_or_else(|| format!("Add an API key for {} in Settings → Notes first.", config.provider))?;
                (key, None, None, None, None)
            }
        };
        let ollama_endpoint = if provider == LLMProvider::Ollama { config.ollama_endpoint.clone() } else { None };
        Ok(Self { provider, model: config.model, api_key, ollama_endpoint, custom_endpoint, max_tokens, temperature, top_p })
    }

    /// "llama3.2 via Ollama", "qwen3.5:4b on this device", …
    pub fn label(&self) -> String {
        let via = match self.provider {
            LLMProvider::BuiltInAI => "on this device",
            LLMProvider::Ollama => "via Ollama",
            LLMProvider::CustomOpenAI => "via your custom endpoint",
            LLMProvider::OpenAI => "via OpenAI",
            LLMProvider::Claude => "via Anthropic",
            LLMProvider::Groq => "via Groq",
            LLMProvider::OpenRouter => "via OpenRouter",
        };
        format!("{} {}", self.model, via)
    }

    pub async fn complete(&self, app_data_dir: Option<&PathBuf>, system: &str, user: &str, max_tokens: u32) -> Result<String, String> {
        self.complete_cancellable(app_data_dir, system, user, max_tokens, None).await
    }

    pub async fn complete_cancellable(&self, app_data_dir: Option<&PathBuf>, system: &str, user: &str, max_tokens: u32, cancellation: Option<&CancellationToken>) -> Result<String, String> {
        let client = reqwest::Client::new();
        generate_summary(
            &client, &self.provider, &self.model, &self.api_key, system, user,
            self.ollama_endpoint.as_deref(), self.custom_endpoint.as_deref(),
            Some(self.max_tokens.map_or(max_tokens, |limit| limit.min(max_tokens))), self.temperature.or(Some(0.2)), self.top_p,
            app_data_dir, cancellation,
        )
        .await
        .map(|c| c.content)
    }
}

/// The first JSON object in a model reply (tolerates code fences and chatter).
pub fn json_object(reply: &str) -> Option<&str> {
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    (end > start).then(|| &reply[start..=end])
}
