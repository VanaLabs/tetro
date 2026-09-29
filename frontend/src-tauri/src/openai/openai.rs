use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tauri::command;

/// OpenAI model information returned to frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAIModel {
    pub id: String,
}

/// API response model from OpenAI
#[derive(Debug, Deserialize)]
struct OpenAIApiModel {
    id: String,
    #[allow(dead_code)]
    object: String,
    #[allow(dead_code)]
    owned_by: String,
}

/// API response wrapper from OpenAI
#[derive(Debug, Deserialize)]
struct OpenAIApiResponse {
    data: Vec<OpenAIApiModel>,
}

/// Cache entry for models
struct CacheEntry {
    models: Vec<OpenAIModel>,
    fetched_at: Instant,
    key_hash: u64,
}

/// Global cache for OpenAI models (5 minute TTL)
static MODELS_CACHE: RwLock<Option<CacheEntry>> = RwLock::new(None);

/// Cache TTL in seconds
const CACHE_TTL_SECS: u64 = 300;

fn key_hash(key: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
}

/// Check if model is a chat-capable model (filter out embedding, tts, etc.)
fn is_chat_model(model_id: &str) -> bool {
    let id = model_id.to_lowercase();
    // Include gpt-*, o1-*, o3-*, o4-* models
    // Exclude embedding, tts, whisper, dall-e, babbage, davinci (non-chat models)
    (id.starts_with("gpt-")
        || id.starts_with("o1-")
        || id.starts_with("o3-")
        || id.starts_with("o4-")
        || id.starts_with("chatgpt-"))
        && !id.contains("embedding")
        && !id.contains("tts")
        && !id.contains("whisper")
        && !id.contains("dall-e")
        && !id.contains("babbage")
        && !id.contains("davinci")
        && !id.contains("instruct")
        && !id.contains("realtime")
        && !id.contains("audio")
}

/// Fetch OpenAI models from API
///
/// # Arguments
/// * `api_key` - OpenAI API key
///
/// # Returns
/// Vector of models returned by the provider. Errors never masquerade as a verified catalog.
#[command]
pub async fn get_openai_models(state: tauri::State<'_, crate::state::AppState>, api_key: Option<String>) -> Result<Vec<OpenAIModel>, String> {
    let api_key = match api_key {
        None => crate::database::repositories::setting::SettingsRepository::get_api_key(state.db_manager.pool(), "openai").await.map_err(|e| e.to_string())?,
        value => value,
    };
    let api_key = match api_key {
        Some(key) if !key.trim().is_empty() => key.trim().to_string(),
        _ => return Err("Connect OpenAI to check its summary models".to_string()),
    };
    let requested_key_hash = key_hash(&api_key);

    // Check cache first
    {
        let cache = MODELS_CACHE.read().map_err(|e| e.to_string())?;
        if let Some(entry) = cache.as_ref() {
            if entry.key_hash == requested_key_hash && entry.fetched_at.elapsed() < Duration::from_secs(CACHE_TTL_SECS) {
                log::info!("Returning cached OpenAI models ({} models)", entry.models.len());
                return Ok(entry.models.clone());
            }
        }
    }

    // Fetch from API
    log::info!("Fetching OpenAI models from API...");
    let client = crate::network_security::client()?;

    let response = match client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => return Err(format!("Could not reach OpenAI: {}", e)),
    };

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("OpenAI model check failed: {}", status));
    }

    let api_response: OpenAIApiResponse = match response.json().await {
        Ok(data) => data,
        Err(e) => return Err(format!("Could not read OpenAI models: {}", e)),
    };

    // Filter to only chat models and map to our struct
    let models: Vec<OpenAIModel> = api_response
        .data
        .into_iter()
        .filter(|m| is_chat_model(&m.id))
        .map(|m| OpenAIModel { id: m.id })
        .collect();

    if models.is_empty() {
        return Err("OpenAI returned no supported summary models for this key".to_string());
    }

    log::info!("Fetched {} OpenAI models from API", models.len());

    // Update cache
    {
        let mut cache = MODELS_CACHE.write().map_err(|e| e.to_string())?;
        *cache = Some(CacheEntry {
            models: models.clone(),
            fetched_at: Instant::now(),
            key_hash: requested_key_hash,
        });
    }

    Ok(models)
}

/// Clear the models cache (useful when API key changes)
pub fn clear_cache() {
    if let Ok(mut cache) = MODELS_CACHE.write() {
        *cache = None;
        log::info!("OpenAI models cache cleared");
    }
}
