use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tauri::command;

/// Groq model information returned to frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GroqModel {
    pub id: String,
    pub owned_by: Option<String>,
}

/// API response model from Groq (OpenAI-compatible format)
#[derive(Debug, Deserialize)]
struct GroqApiModel {
    id: String,
    owned_by: Option<String>,
    #[allow(dead_code)]
    object: String,
}

/// API response wrapper from Groq
#[derive(Debug, Deserialize)]
struct GroqApiResponse {
    data: Vec<GroqApiModel>,
}

/// Cache entry for models
struct CacheEntry {
    models: Vec<GroqModel>,
    fetched_at: Instant,
    key_hash: u64,
}

/// Global cache for Groq models (5 minute TTL)
static MODELS_CACHE: RwLock<Option<CacheEntry>> = RwLock::new(None);

/// Cache TTL in seconds
const CACHE_TTL_SECS: u64 = 300;

fn key_hash(key: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
}

/// Check if model is a chat-capable model (filter out whisper, etc.)
fn is_chat_model(model_id: &str) -> bool {
    let id = model_id.to_lowercase();
    // Exclude whisper, tool-use specific models, and embedding models
    !id.contains("whisper")
        && !id.contains("embed")
        && !id.contains("guard")
        && !id.contains("tool-use")
}

/// Fetch Groq models from API
///
/// # Arguments
/// * `api_key` - Groq API key
///
/// # Returns
/// Vector of models returned by the provider. Errors never masquerade as a verified catalog.
#[command]
pub async fn get_groq_models(state: tauri::State<'_, crate::state::AppState>, api_key: Option<String>) -> Result<Vec<GroqModel>, String> {
    let api_key = match api_key {
        None => crate::database::repositories::setting::SettingsRepository::get_api_key(state.db_manager.pool(), "groq").await.map_err(|e| e.to_string())?,
        value => value,
    };
    let api_key = match api_key {
        Some(key) if !key.trim().is_empty() => key.trim().to_string(),
        _ => return Err("Connect Groq to check its summary models".to_string()),
    };
    let requested_key_hash = key_hash(&api_key);

    // Check cache first
    {
        let cache = MODELS_CACHE.read().map_err(|e| e.to_string())?;
        if let Some(entry) = cache.as_ref() {
            if entry.key_hash == requested_key_hash && entry.fetched_at.elapsed() < Duration::from_secs(CACHE_TTL_SECS) {
                log::info!("Returning cached Groq models ({} models)", entry.models.len());
                return Ok(entry.models.clone());
            }
        }
    }

    // Fetch from API
    log::info!("Fetching Groq models from API...");
    let client = crate::network_security::client()?;

    let response = match client
        .get("https://api.groq.com/openai/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => return Err(format!("Could not reach Groq: {}", e)),
    };

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("Groq model check failed: {}", status));
    }

    let api_response: GroqApiResponse = match response.json().await {
        Ok(data) => data,
        Err(e) => return Err(format!("Could not read Groq models: {}", e)),
    };

    // Filter to only chat models and map to our struct
    let models: Vec<GroqModel> = api_response
        .data
        .into_iter()
        .filter(|m| is_chat_model(&m.id))
        .map(|m| GroqModel {
            id: m.id,
            owned_by: m.owned_by,
        })
        .collect();

    if models.is_empty() {
        return Err("Groq returned no supported summary models for this key".to_string());
    }

    log::info!("Fetched {} Groq models from API", models.len());

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
        log::info!("Groq models cache cleared");
    }
}
