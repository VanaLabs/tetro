// Model manager for built-in AI models - handles downloads and lifecycle
// Follows the same pattern as whisper_engine/whisper_engine.rs for consistency

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::RwLock;
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;

use super::models::{get_available_models, get_model_by_name, ModelDef};

// ============================================================================
// Model Status Types
// ============================================================================

/// Detailed download progress info (MB-based with speed)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Bytes downloaded so far
    pub downloaded_bytes: u64,
    /// Total file size in bytes
    pub total_bytes: u64,
    /// Downloaded in MB (for display)
    pub downloaded_mb: f64,
    /// Total size in MB (for display)
    pub total_mb: f64,
    /// Download speed in MB/s
    pub speed_mbps: f64,
    /// Percentage complete (0-100)
    pub percent: u8,
}

impl DownloadProgress {
    pub fn new(downloaded: u64, total: u64, speed_mbps: f64) -> Self {
        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };
        Self {
            downloaded_bytes: downloaded,
            total_bytes: total,
            downloaded_mb: downloaded as f64 / (1024.0 * 1024.0),
            total_mb: total as f64 / (1024.0 * 1024.0),
            speed_mbps,
            percent,
        }
    }
}

/// Model status in the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ModelStatus {
    /// Model is not yet downloaded
    NotDownloaded,

    /// Model is currently being downloaded (progress 0-100)
    Downloading { progress: u8 },

    /// A partial file is kept on disk and can be resumed or deleted.
    Paused { downloaded_mb: u64 },

    /// Model is downloaded and ready to use
    Available,

    /// Model file is corrupted and needs redownload
    Corrupted { file_size: u64, expected_min_size: u64 },

    /// Error occurred with the model
    Error(String),
}

/// Model information for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Model name (e.g., "qwen3.5:2b")
    pub name: String,

    /// Display name for UI
    pub display_name: String,

    /// Current status
    pub status: ModelStatus,

    /// File path (if available)
    pub path: PathBuf,

    /// Size in MB
    pub size_mb: u64,

    /// Context window size in tokens
    pub context_size: u32,

    /// Description
    pub description: String,

    /// GGUF filename on disk
    pub gguf_file: String,
}

// ============================================================================
// Model Manager
// ============================================================================

pub struct ModelManager {
    /// Directory where models are stored
    models_dir: PathBuf,

    /// Currently available models with their status
    available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,

    /// Per-model cancellation avoids one download clearing another model's stop request.
    active_downloads: Arc<RwLock<HashMap<String, CancellationToken>>>,
}

impl ModelManager {
    /// Create a new model manager with default models directory
    pub fn new() -> Result<Self> {
        Self::new_with_models_dir(None)
    }

    /// Create a new model manager with custom models directory
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = if let Some(dir) = models_dir {
            dir
        } else {
            // Fallback: Use current directory in development
            crate::app_profile::data_dir()
                .ok_or_else(|| anyhow!("Could not find Tetro data directory"))?
                .join("models").join("summary")
        };

        log::info!(
            "Built-in AI ModelManager using directory: {}",
            models_dir.display()
        );

        Ok(Self {
            models_dir,
            available_models: Arc::new(RwLock::new(HashMap::new())),
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Initialize and scan for existing models
    pub async fn init(&self) -> Result<()> {
        // Create models directory if it doesn't exist
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir).await?;
            log::info!("Created models directory: {}", self.models_dir.display());
        }

        // Scan for existing models
        self.scan_models().await?;

        Ok(())
    }

    /// Scan models directory and update status
    pub async fn scan_models(&self) -> Result<()> {
        let start = std::time::Instant::now();

        log::info!(
            "Starting model scan in directory: {}",
            self.models_dir.display()
        );

        let model_defs = get_available_models();
        let mut models_map = HashMap::new();

        for model_def in model_defs {
            let model_path = self.models_dir.join(&model_def.gguf_file);
            log::debug!(
                "Checking model '{}' at path: {}",
                model_def.name,
                model_path.display()
            );

            let is_actively_downloading = {
                let active = self.active_downloads.read().await;
                active.contains_key(&model_def.name)
            };

            // If actively downloading, preserve existing status from memory
            if is_actively_downloading {
                let existing_info = {
                    let models = self.available_models.read().await;
                    models.get(&model_def.name).cloned()
                };

                if let Some(info) = existing_info {
                    // Preserve existing status (should be Downloading)
                    models_map.insert(model_def.name.clone(), info);
                    log::debug!(
                        "Model '{}': Preserving Downloading status during scan",
                        model_def.name
                    );
                    continue;
                }
            }

            let status = if model_path.exists() {
                // Check if file size matches expected size (basic validation)
                match fs::metadata(&model_path).await {
                    Ok(metadata) => {
                        let file_size_mb = metadata.len() / (1024 * 1024);

                        log::info!(
                            "Model '{}': found {} bytes (expected {} bytes)",
                            model_def.name,
                            metadata.len(),
                            model_def.size_bytes
                        );

                        if metadata.len() == model_def.size_bytes {
                            match self.validate_gguf_file(&model_path).await {
                                Ok(()) => ModelStatus::Available,
                                Err(e) => ModelStatus::Error(format!("Invalid model file: {}", e)),
                            }
                        } else if metadata.len() < model_def.size_bytes {
                            ModelStatus::Paused { downloaded_mb: file_size_mb }
                        } else {
                            log::warn!(
                                "Model '{}': CORRUPTED (size mismatch: {} bytes, expected {} bytes)",
                                model_def.name,
                                metadata.len(),
                                model_def.size_bytes
                            );
                            ModelStatus::Corrupted {
                                file_size: file_size_mb,
                                expected_min_size: model_def.size_mb,
                            }
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "Model '{}': Failed to read metadata: {}",
                            model_def.name,
                            e
                        );
                        ModelStatus::Error(format!("Failed to read metadata: {}", e))
                    }
                }
            } else {
                log::debug!("Model '{}': NOT FOUND", model_def.name);
                ModelStatus::NotDownloaded
            };

            let model_info = ModelInfo {
                name: model_def.name.clone(),
                display_name: model_def.display_name.clone(),
                status,
                path: model_path,
                size_mb: model_def.size_mb,
                context_size: model_def.context_size,
                description: model_def.description.clone(),
                gguf_file: model_def.gguf_file.clone(),
            };

            models_map.insert(model_def.name.clone(), model_info);
        }

        let model_count = models_map.len();

        let mut models = self.available_models.write().await;
        *models = models_map;

        let elapsed = start.elapsed();
        log::info!(
            "Model scan complete: {} models checked in {:?}",
            model_count,
            elapsed
        );
        Ok(())
    }

    /// Get list of all models with their status
    pub async fn list_models(&self) -> Vec<ModelInfo> {
        let mut models: Vec<_> = self.available_models
            .read()
            .await
            .values()
            .cloned()
            .collect();
        models.sort_by_key(|model| model.size_mb);
        models
    }

    /// Get info for a specific model
    pub async fn get_model_info(&self, model_name: &str) -> Option<ModelInfo> {
        self.available_models
            .read()
            .await
            .get(model_name)
            .cloned()
    }

    /// Check if a model is ready to use
    /// If refresh=true, scans filesystem before checking (slower but accurate)
    pub async fn is_model_ready(&self, model_name: &str, refresh: bool) -> bool {
        if refresh {
            if let Err(e) = self.scan_models().await {
                log::error!("Failed to scan models: {}", e);
                return false;
            }
        }

        if let Some(info) = self.get_model_info(model_name).await {
            info.status == ModelStatus::Available
        } else {
            false
        }
    }

    /// Download a model with simple percentage callback (backward compatible)
    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        // Wrap the simple callback to use detailed progress internally
        let detailed_callback: Option<Box<dyn Fn(DownloadProgress) + Send>> =
            progress_callback.map(|cb| {
                Box::new(move |p: DownloadProgress| cb(p.percent)) as Box<dyn Fn(DownloadProgress) + Send>
            });
        self.download_model_detailed(model_name, detailed_callback).await
    }

    /// Download a model with detailed progress (MB, speed, etc.)
    pub async fn download_model_detailed(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for model: {}", model_name);

        // Check if already downloading
        {
            let active = self.active_downloads.read().await;
            if active.contains_key(model_name) {
                log::warn!("Download already in progress for model: {}", model_name);
                return Err(anyhow!("Download already in progress"));
            }
        }

        // Get model definition
        let model_def = get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;

        // Add to active downloads
        let cancellation = CancellationToken::new();
        {
            let mut active = self.active_downloads.write().await;
            if active.contains_key(model_name) {
                return Err(anyhow!("Download already in progress"));
            }
            active.insert(model_name.to_string(), cancellation.clone());
        }

        let result = self.download_model_inner(model_name, &model_def, progress_callback, cancellation).await;
        if let Err(ref error) = result {
            let path = self.models_dir.join(&model_def.gguf_file);
            let partial_bytes = fs::metadata(path).await.map(|metadata| metadata.len()).unwrap_or(0);
            if partial_bytes > 0 && partial_bytes < model_def.size_bytes {
                self.mark_paused(model_name, partial_bytes).await;
            } else if partial_bytes == 0 {
                let mut models = self.available_models.write().await;
                if let Some(info) = models.get_mut(model_name) {
                    info.status = if error.to_string().starts_with("CANCELLED:") {
                        ModelStatus::NotDownloaded
                    } else {
                        ModelStatus::Error(error.to_string())
                    };
                }
            }
        }
        self.active_downloads.write().await.remove(model_name);
        result
    }

    async fn download_model_inner(
        &self,
        model_name: &str,
        model_def: &ModelDef,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
        cancellation: CancellationToken,
    ) -> Result<()> {

        // Update status to downloading
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Downloading { progress: 0 };
            }
        }

        let file_path = self.models_dir.join(&model_def.gguf_file);

        // Check if model already exists and is valid (skip re-download)
        if file_path.exists() {
            if let Ok(metadata) = fs::metadata(&file_path).await {
                if metadata.len() == model_def.size_bytes && self.validate_gguf_file(&file_path).await.is_ok() {
                    log::info!(
                        "Model '{}' already exists and is valid ({} MB), skipping download",
                        model_name,
                        metadata.len() / (1024 * 1024)
                    );

                    // Update status to available
                    {
                        let mut models = self.available_models.write().await;
                        if let Some(model_info) = models.get_mut(model_name) {
                            model_info.status = ModelStatus::Available;
                        }
                    }

                    // Report 100% progress
                    if let Some(ref callback) = progress_callback {
                        let total = metadata.len();
                        callback(DownloadProgress::new(total, total, 0.0));
                    }

                    return Ok(());
                } else if metadata.len() >= model_def.size_bytes {
                    // File is LARGER than expected - possibly corrupted or wrong file
                    // A full-size file with a bad header also needs a fresh download.
                    log::warn!(
                        "Model '{}' exists but is invalid ({} MB, expected {} MB), deleting and re-downloading",
                        model_name,
                        metadata.len() / (1024 * 1024),
                        model_def.size_bytes / (1024 * 1024)
                    );
                    if let Err(e) = fs::remove_file(&file_path).await {
                        log::warn!("Failed to delete oversized model file: {}", e);
                    }
                } else {
                    // File is SMALLER than expected - likely partial download
                    // DON'T DELETE - let resume logic handle it
                    log::info!(
                        "Model '{}' exists but is incomplete ({} MB, expected min {} MB), will resume download",
                        model_name,
                        metadata.len() / (1024 * 1024),
                        model_def.size_mb
                    );
                    // Continue to download/resume logic below
                }
            }
        }

        log::info!("Downloading from: {}", model_def.download_url);
        log::info!("Saving to: {}", file_path.display());

        // Create models directory if needed
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir).await?;
        }

        // Check for existing partial download to resume
        let existing_size: u64 = if file_path.exists() {
            fs::metadata(&file_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        // Download the file with optimized client settings
        let client = Client::builder()
            .tcp_nodelay(true) // Disable Nagle's algorithm for faster streaming
            .pool_max_idle_per_host(1) // Keep connection alive
            .timeout(Duration::from_secs(3600)) // 1 hour timeout for large files
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        // Build request with Range header if resuming
        let mut request = client.get(&model_def.download_url);
        if existing_size > 0 {
            log::info!(
                "Resuming download from byte {} ({:.1} MB)",
                existing_size,
                existing_size as f64 / (1024.0 * 1024.0)
            );
            request = request.header("Range", format!("bytes={}-", existing_size));
        }

        let response = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.mark_paused(model_name, existing_size).await;
                return Err(anyhow!("CANCELLED: Download cancelled by user"));
            }
            response = request.send() => response.map_err(|e| anyhow!("Failed to start download: {}", e))?,
        };

        // Check response status - 200 OK (full download) or 206 Partial Content (resume)
        let resuming = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            log::info!("Server supports resume from {} bytes", existing_size);
            true
        } else if response.status().is_success() {
            // Server doesn't support resume or fresh download
            if existing_size > 0 {
                log::warn!("Server doesn't support resume, starting fresh download");
            }
            false
        } else {
            return Err(anyhow!("Download failed with status: {}", response.status()));
        };
        let total_size = model_def.size_bytes;

        log::info!("Total size: {} MB", total_size / (1024 * 1024));

        // Open file for append if resuming, or create new
        let file = if resuming {
            OpenOptions::new()
                .write(true)
                .append(true)
                .open(&file_path)
                .await
                .map_err(|e| anyhow!("Failed to open file for append: {}", e))?
        } else {
            fs::File::create(&file_path)
                .await
                .map_err(|e| anyhow!("Failed to create file: {}", e))?
        };

        // Use 8MB buffer to reduce disk I/O syscalls (major performance improvement)
        let mut writer = BufWriter::with_capacity(8 * 1024 * 1024, file);

        let mut downloaded: u64 = if resuming { existing_size } else { 0 };

        // Emit initial progress (showing resumed position if applicable)
        if let Some(ref callback) = progress_callback {
            callback(DownloadProgress::new(downloaded, total_size, 0.0));
        }
        log::info!(
            "Starting at {:.1} MB / {:.1} MB",
            downloaded as f64 / (1024.0 * 1024.0),
            total_size as f64 / (1024.0 * 1024.0)
        );

        let mut last_progress_percent = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0) as u8
        } else {
            0
        };
        let mut last_report_time = std::time::Instant::now();
        let mut bytes_since_last_report: u64 = 0;
        let download_start_time = std::time::Instant::now();
        let start_downloaded = downloaded;

        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();

        loop {
            // Wake immediately when stopped, even if the server has stalled mid-stream.
            let next_result = tokio::select! {
                biased;
                _ = cancellation.cancelled() => {
                    let _ = writer.flush().await;
                    drop(writer);
                    self.mark_paused(model_name, downloaded).await;
                    return Err(anyhow!("CANCELLED: Download cancelled by user"));
                }
                result = timeout(Duration::from_secs(30), stream.next()) => result,
            };

            let chunk = match next_result {
                // Timeout - no data received for 30 seconds
                Err(_) => {
                    log::warn!("Download timeout for {}: no data received for 30 seconds", model_name);
                    let _ = writer.flush().await;

                    // Set model status to Error (NOT NotDownloaded) so UI can show retry button
                    {
                        let mut models = self.available_models.write().await;
                        if let Some(model_info) = models.get_mut(model_name) {
                            model_info.status = ModelStatus::Error("Download timeout - No data received for 30 seconds".to_string());
                        }
                    }

                    return Err(anyhow!("Download timeout - No data received for 30 seconds"));
                },
                // Stream ended
                Ok(None) => break,
                // Got chunk result
                Ok(Some(chunk_result)) => {
                    match chunk_result {
                        Ok(c) => c,
                        // Detect error type for better user feedback
                        Err(e) => {
                            log::error!("Download error for {}: {:?}", model_name, e);
                            let _ = writer.flush().await;

                            // Categorize error for user-friendly message
                            let error_msg = if e.is_timeout() {
                                "Connection timeout - Check your internet"
                            } else if e.is_connect() {
                                "Connection failed - Check your internet"
                            } else if e.is_body() {
                                "Stream interrupted - Network unstable"
                            } else {
                                "Download error"
                            };

                            // Set model status to Error (NOT NotDownloaded) so UI can show retry button
                            {
                                let mut models = self.available_models.write().await;
                                if let Some(model_info) = models.get_mut(model_name) {
                                    model_info.status = ModelStatus::Error(error_msg.to_string());
                                }
                            }

                            return Err(anyhow!("{}: {}", error_msg, e));
                        }
                    }
                }
            };
            let chunk_len = chunk.len() as u64;
            writer
                .write_all(&chunk)
                .await
                .map_err(|e| anyhow!("Error writing to file: {}", e))?;

            downloaded += chunk_len;
            bytes_since_last_report += chunk_len;

            // Calculate progress
            let progress_percent = if total_size > 0 {
                let exact_percent = (downloaded as f64 / total_size as f64) * 100.0;
                exact_percent.min(100.0) as u8
            } else {
                0
            };

            let elapsed_since_report = last_report_time.elapsed();
            let is_download_complete = downloaded >= total_size;
            let should_report = progress_percent > last_progress_percent
                || is_download_complete  // Force report on completion
                || elapsed_since_report.as_millis() >= 500;

            if should_report {
                // Calculate speed based on bytes downloaded since last report
                let speed_mbps = if elapsed_since_report.as_secs_f64() > 0.0 {
                    (bytes_since_last_report as f64 / (1024.0 * 1024.0)) / elapsed_since_report.as_secs_f64()
                } else {
                    // Fallback to overall average speed
                    let total_elapsed = download_start_time.elapsed().as_secs_f64();
                    if total_elapsed > 0.0 {
                        ((downloaded - start_downloaded) as f64 / (1024.0 * 1024.0)) / total_elapsed
                    } else {
                        0.0
                    }
                };

                log::info!(
                    "Download: {:.1} MB / {:.1} MB ({:.1} MB/s)",
                    downloaded as f64 / (1024.0 * 1024.0),
                    total_size as f64 / (1024.0 * 1024.0),
                    speed_mbps
                );

                // Update status
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model_info) = models.get_mut(model_name) {
                        model_info.status = ModelStatus::Downloading {
                            progress: if is_download_complete { 100 } else { progress_percent }
                        };
                    }
                }

                // Call progress callback with detailed info
                if let Some(ref callback) = progress_callback {
                    callback(DownloadProgress::new(downloaded, total_size, speed_mbps));
                }

                last_progress_percent = progress_percent;
                last_report_time = std::time::Instant::now();
                bytes_since_last_report = 0;
            }
        }

        writer.flush().await?;
        drop(writer);

        if cancellation.is_cancelled() {
            self.mark_paused(model_name, downloaded).await;
            return Err(anyhow!("CANCELLED: Download cancelled by user"));
        }

        log::info!("Download completed for model: {}", model_name);

        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Downloading { progress: 100 };
            }
        }

        if let Some(ref callback) = progress_callback {
            callback(DownloadProgress::new(total_size, total_size, 0.0));
        }

        // Small delay to ensure UI receives 100% event
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        if cancellation.is_cancelled() {
            self.mark_paused(model_name, downloaded).await;
            return Err(anyhow!("CANCELLED: Download cancelled by user"));
        }

        if downloaded != model_def.size_bytes {
            self.mark_paused(model_name, downloaded).await;
            return Err(anyhow!("Incomplete download: received {} of {} bytes", downloaded, model_def.size_bytes));
        }

        if let Err(e) = self.validate_gguf_file(&file_path).await {
            log::error!("Downloaded file failed validation: {}", e);

            // Clean up invalid file
            let _ = fs::remove_file(&file_path).await;

            // Update status
            {
                let mut models = self.available_models.write().await;
                if let Some(model_info) = models.get_mut(model_name) {
                    model_info.status = ModelStatus::Error(format!("Validation failed: {}", e));
                }
            }

            return Err(anyhow!("File validation failed: {}", e));
        }

        // Update status to available
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Available;
                model_info.path = file_path.clone();
            }
        }

        Ok(())
    }

    async fn mark_paused(&self, model_name: &str, downloaded_bytes: u64) {
        let mut models = self.available_models.write().await;
        if let Some(model_info) = models.get_mut(model_name) {
            model_info.status = if downloaded_bytes > 0 {
                ModelStatus::Paused { downloaded_mb: downloaded_bytes / (1024 * 1024) }
            } else {
                ModelStatus::NotDownloaded
            };
        }
    }

    /// Validate that a file is a valid GGUF model
    async fn validate_gguf_file(&self, path: &PathBuf) -> Result<()> {
        crate::model_integrity::summary(path)?;
        let mut file = fs::File::open(path).await?;

        // Read first 4 bytes to check for GGUF magic number
        use tokio::io::AsyncReadExt;
        let mut magic = [0u8; 4];
        file.read_exact(&mut magic).await?;

        // GGUF magic number is "GGUF" (0x47475546)
        if &magic == b"GGUF" {
            Ok(())
        } else if &magic == b"ggjt" || &magic == b"ggla" || &magic == b"ggml" {
            // Older formats (GGML, GGJT)
            Ok(())
        } else {
            Err(anyhow!(
                "Invalid model file: magic number {:?} doesn't match GGUF/GGML",
                magic
            ))
        }
    }

    /// Cancel an ongoing download
    pub async fn cancel_download(&self, model_name: &str) -> Result<bool> {
        log::info!("Cancelling download for model: {}", model_name);
        let token = self.active_downloads.read().await.get(model_name).cloned();
        let Some(token) = token else { return Ok(false); };
        token.cancel();

        // The UI may offer Resume or Delete only after the writer has stopped.
        timeout(Duration::from_secs(10), async {
            while self.active_downloads.read().await.contains_key(model_name) {
                sleep(Duration::from_millis(20)).await;
            }
        }).await.map_err(|_| anyhow!("Timed out stopping the download"))?;
        Ok(true)
    }

    /// Delete a corrupted or available model file
    pub async fn delete_model(&self, model_name: &str) -> Result<()> {
        log::info!("Deleting model: {}", model_name);

        let model_def = get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;

        let active = self.active_downloads.write().await;
        if active.contains_key(model_name) {
            return Err(anyhow!("Stop the download before deleting its files"));
        }

        let file_path = self.models_dir.join(&model_def.gguf_file);

        if file_path.exists() {
            fs::remove_file(&file_path).await?;
            log::info!("Deleted model file: {}", file_path.display());
        }
        drop(active);

        // Update status
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::NotDownloaded;
            }
        }

        Ok(())
    }

    /// Get models directory path
    pub fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_95_percent_file_is_paused_and_can_be_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let manager = ModelManager::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        manager.init().await.unwrap();
        let model = get_model_by_name("qwen3.5:2b").unwrap();
        let path = dir.path().join(model.gguf_file);
        let mut file = fs::File::create(&path).await.unwrap();
        file.write_all(b"GGUF").await.unwrap();
        file.set_len(model.size_bytes * 95 / 100).await.unwrap();
        drop(file);

        manager.scan_models().await.unwrap();
        assert!(matches!(
            manager.get_model_info("qwen3.5:2b").await.unwrap().status,
            ModelStatus::Paused { .. }
        ));

        manager.delete_model("qwen3.5:2b").await.unwrap();
        assert!(!path.exists());
        assert_eq!(manager.get_model_info("qwen3.5:2b").await.unwrap().status, ModelStatus::NotDownloaded);
    }

    #[tokio::test]
    async fn cancelling_waits_for_the_download_to_release_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let manager = Arc::new(ModelManager::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap());
        manager.init().await.unwrap();
        let token = CancellationToken::new();
        manager.active_downloads.write().await.insert("qwen3.5:2b".to_string(), token.clone());
        let cancelling = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.cancel_download("qwen3.5:2b").await })
        };
        token.cancelled().await;
        assert!(!cancelling.is_finished());
        manager.active_downloads.write().await.remove("qwen3.5:2b");
        assert!(cancelling.await.unwrap().unwrap());
    }

    #[tokio::test]
    async fn deleting_one_partial_model_keeps_other_models() {
        let dir = tempfile::tempdir().unwrap();
        let manager = ModelManager::new_with_models_dir(Some(dir.path().to_path_buf())).unwrap();
        manager.init().await.unwrap();
        let qwen = dir.path().join(get_model_by_name("qwen3.5:2b").unwrap().gguf_file);
        let gemma = dir.path().join(get_model_by_name("gemma3:1b").unwrap().gguf_file);
        fs::write(&qwen, b"GGUFpartial").await.unwrap();
        fs::write(&gemma, b"GGUFpartial").await.unwrap();
        manager.scan_models().await.unwrap();

        manager.delete_model("qwen3.5:2b").await.unwrap();
        assert!(!qwen.exists());
        assert!(gemma.exists());
    }
}
