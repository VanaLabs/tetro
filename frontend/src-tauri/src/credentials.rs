//! Provider secrets live in the operating system credential store, never in new SQLite writes.
//! Legacy values are removed only after a successful, verified credential-store write.

use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::sync::Arc;

const SERVICE: &str = "am.vanalabs.tetro.provider-keys";
static OPERATIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone)]
pub struct Slot {
    table: &'static str,
    column: &'static str,
    account: String,
    endpoint: Option<String>,
}

impl Slot {
    pub fn summary(provider: &str) -> Result<Option<Self>, sqlx::Error> {
        let column = match provider {
            "openai" => "openaiApiKey",
            "claude" => "anthropicApiKey",
            "groq" => "groqApiKey",
            "openrouter" => "openRouterApiKey",
            "ollama" => "ollamaApiKey",
            "builtin-ai" => return Ok(None),
            _ => return Err(error("Unknown credential provider")),
        };
        Ok(Some(Self { table: "settings", column, account: format!("summary/{provider}"), endpoint: None }))
    }

    pub fn transcription(provider: &str) -> Result<Option<Self>, sqlx::Error> {
        let column = match provider {
            "localWhisper" => "whisperApiKey",
            "deepgram" => "deepgramApiKey",
            "elevenLabs" => "elevenLabsApiKey",
            "groq" => "groqApiKey",
            "openai" => "openaiApiKey",
            "parakeet" => return Ok(None),
            _ => return Err(error("Unknown transcription credential provider")),
        };
        Ok(Some(Self { table: "transcript_settings", column, account: format!("transcription/{provider}"), endpoint: None }))
    }

    pub fn custom(endpoint: &str) -> Self {
        // Binding the key to the full endpoint prevents sending an old key to a replacement server.
        let endpoint = endpoint.trim().trim_end_matches('/').to_string();
        let digest = Sha256::digest(endpoint.as_bytes());
        Self { table: "settings", column: "customOpenAIConfig", account: format!("custom/{digest:x}"), endpoint: Some(endpoint) }
    }
}

fn error(message: &str) -> sqlx::Error { sqlx::Error::Protocol(message.to_string()) }

trait SecretStore: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn write(&self, account: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

struct OsStore;

// Never format keyring errors: BadEncoding can include the original secret bytes.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
impl SecretStore for OsStore {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| "Could not open the OS credential store")?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read the saved key. Unlock or allow access to the OS credential store and retry.".into()),
        }
    }
    fn write(&self, account: &str, secret: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, account).map_err(|_| "Could not open the OS credential store")?
            .set_password(secret).map_err(|_| "Could not save the key in the OS credential store. The key was not saved to a file.".into())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| "Could not open the OS credential store")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove the key from the OS credential store. Unlock or allow access and retry.".into()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
impl SecretStore for OsStore {
    fn read(&self, _: &str) -> Result<Option<String>, String> { Err("Secure credential storage is unavailable on this platform".into()) }
    fn write(&self, _: &str, _: &str) -> Result<(), String> { Err("Secure credential storage is unavailable on this platform".into()) }
    fn delete(&self, _: &str) -> Result<(), String> { Err("Secure credential storage is unavailable on this platform".into()) }
}

async fn store_call<T: Send + 'static>(store: Arc<dyn SecretStore>, operation: impl FnOnce(&dyn SecretStore) -> Result<T, String> + Send + 'static) -> Result<T, sqlx::Error> {
    tokio::task::spawn_blocking(move || operation(store.as_ref())).await
        .map_err(|_| error("The OS credential store operation did not complete"))?
        .map_err(|message| error(&message))
}

async fn legacy(pool: &SqlitePool, slot: &Slot) -> Result<Option<String>, sqlx::Error> {
    let value: Option<String> = sqlx::query_scalar::<_, Option<String>>(&format!("SELECT \"{}\" FROM {} WHERE id = '1'", slot.column, slot.table))
        .fetch_optional(pool).await?.flatten();
    if let Some(endpoint) = &slot.endpoint {
        let Some(json) = value else { return Ok(None) };
        let config: serde_json::Value = serde_json::from_str(&json).map_err(|_| error("Invalid custom provider settings"))?;
        if config["endpoint"].as_str().map(|s| s.trim().trim_end_matches('/')) != Some(endpoint.as_str()) { return Ok(None); }
        return Ok(config["apiKey"].as_str().filter(|s| !s.is_empty()).map(str::to_owned));
    }
    Ok(value.filter(|s| !s.is_empty()))
}

async fn clear_legacy(pool: &SqlitePool, slot: &Slot) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    sqlx::query("PRAGMA secure_delete = ON").execute(&mut *conn).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS credential_cleanup (id INTEGER PRIMARY KEY, pending INTEGER NOT NULL)").execute(&mut *conn).await?;
    sqlx::query("INSERT INTO credential_cleanup VALUES(1,1) ON CONFLICT(id) DO UPDATE SET pending=1").execute(&mut *conn).await?;
    if slot.endpoint.is_some() {
        sqlx::query("UPDATE settings SET customOpenAIConfig = json_set(customOpenAIConfig, '$.apiKey', NULL) WHERE id = '1' AND customOpenAIConfig IS NOT NULL")
            .execute(&mut *conn).await?;
    } else {
        sqlx::query(&format!("UPDATE {} SET \"{}\" = NULL WHERE id = '1'", slot.table, slot.column)).execute(&mut *conn).await?;
    }
    Ok(())
}

async fn read_with(pool: &SqlitePool, slot: Slot, store: Arc<dyn SecretStore>) -> Result<Option<String>, sqlx::Error> {
    let _guard = OPERATIONS.lock().await;
    let old = legacy(pool, &slot).await?;
    let account = slot.account.clone();
    let existing = store_call(store.clone(), move |s| s.read(&account)).await?;
    let result = if let Some(current) = existing { Some(current) }
    else if let Some(value) = old.as_ref() {
        let account = slot.account.clone();
        let value = value.clone();
        Some(store_call(store, move |s| {
            s.write(&account, &value)?;
            if s.read(&account)?.as_deref() != Some(value.as_str()) { return Err("Could not verify the migrated key; the original is retained".into()); }
            Ok(value)
        }).await?)
    } else { None };
    if old.is_some() {
        clear_legacy(pool, &slot).await?;
        purge_database_history(pool).await?;
    }
    Ok(result)
}

pub async fn read(pool: &SqlitePool, slot: Slot) -> Result<Option<String>, sqlx::Error> { read_with(pool, slot, Arc::new(OsStore)).await }

async fn write_with(pool: &SqlitePool, slot: Slot, secret: &str, store: Arc<dyn SecretStore>) -> Result<(), sqlx::Error> {
    let secret = secret.trim().to_string();
    if secret.is_empty() || secret.len() > 8192 || secret.contains(['\r', '\n']) { return Err(error("Enter a nonempty API key without line breaks (maximum 8192 bytes)")); }
    let _guard = OPERATIONS.lock().await;
    let had_legacy = legacy(pool, &slot).await?.is_some();
    let account = slot.account.clone();
    store_call(store, move |s| {
        s.write(&account, &secret)?;
        if s.read(&account)?.as_deref() != Some(secret.as_str()) { return Err("Could not verify the saved key".into()); }
        Ok(())
    }).await?;
    if had_legacy { clear_legacy(pool, &slot).await?; purge_database_history(pool).await?; }
    Ok(())
}

pub async fn write(pool: &SqlitePool, slot: Slot, secret: &str) -> Result<(), sqlx::Error> { write_with(pool, slot, secret, Arc::new(OsStore)).await }

async fn delete_with(pool: &SqlitePool, slot: Slot, store: Arc<dyn SecretStore>) -> Result<(), sqlx::Error> {
    let _guard = OPERATIONS.lock().await;
    let had_legacy = legacy(pool, &slot).await?.is_some();
    let account = slot.account.clone();
    store_call(store, move |s| s.delete(&account)).await?;
    if had_legacy { clear_legacy(pool, &slot).await?; purge_database_history(pool).await?; }
    Ok(())
}

pub async fn delete(pool: &SqlitePool, slot: Slot) -> Result<(), sqlx::Error> { delete_with(pool, slot, Arc::new(OsStore)).await }

async fn purge_database_history(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Compact previously freed pages as well as newly cleared columns. Backups/snapshots are outside this database.
    sqlx::query("VACUUM").execute(pool).await?;
    let (busy, _, _): (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)").fetch_one(pool).await?;
    if busy != 0 { return Err(error("Keys were migrated, but database cleanup is busy. Close other database connections and restart Tetro.")); }
    sqlx::query("UPDATE credential_cleanup SET pending=0 WHERE id=1").execute(pool).await?;
    Ok(())
}

pub async fn migrate_legacy(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    migrate_legacy_with(pool, Arc::new(OsStore)).await
}

async fn migrate_legacy_with(pool: &SqlitePool, store: Arc<dyn SecretStore>) -> Result<(), sqlx::Error> {
    let mut slots = Vec::new();
    for p in ["openai", "claude", "groq", "openrouter", "ollama"] { slots.push(Slot::summary(p)?.unwrap()); }
    for p in ["localWhisper", "deepgram", "elevenLabs", "groq", "openai"] { slots.push(Slot::transcription(p)?.unwrap()); }
    // Legacy schemas may predate individual providers. Only touch known existing columns.
    let mut supported = Vec::new();
    for slot in slots {
        let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM pragma_table_info(?) WHERE name=?")
            .bind(slot.table).bind(slot.column).fetch_one(pool).await?;
        if exists > 0 { supported.push(slot); }
    }
    let mut slots = supported;
    let custom_exists: i64 = sqlx::query_scalar("SELECT count(*) FROM pragma_table_info('settings') WHERE name='customOpenAIConfig'").fetch_one(pool).await?;
    let custom: Option<String> = if custom_exists > 0 { sqlx::query_scalar::<_, Option<String>>("SELECT customOpenAIConfig FROM settings WHERE id = '1'").fetch_optional(pool).await?.flatten() } else { None };
    if let Some(json) = custom {
        let value: serde_json::Value = serde_json::from_str(&json).map_err(|_| error("Invalid custom provider settings"))?;
        if let Some(endpoint) = value["endpoint"].as_str() { slots.push(Slot::custom(endpoint)); }
    }
    for slot in slots {
        if legacy(pool, &slot).await?.is_some() { read_with(pool, slot, store.clone()).await?; }
    }
    let table: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name='credential_cleanup'").fetch_one(pool).await?;
    if table > 0 {
        let pending: i64 = sqlx::query_scalar("SELECT coalesce(max(pending),0) FROM credential_cleanup").fetch_one(pool).await?;
        if pending != 0 { purge_database_history(pool).await?; }
    }
    Ok(())
}

/// Clean only the app-owned legacy copy; callers must never pass the external import source.
pub async fn cleanup_legacy_copy(path: &std::path::Path) -> Result<(), sqlx::Error> {
    if !path.exists() { return Ok(()); }
    if path.symlink_metadata()?.file_type().is_symlink() { return Err(error("Legacy database copy cannot be a symbolic link")); }
    let options=sqlx::sqlite::SqliteConnectOptions::new().filename(path).create_if_missing(false);
    let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options).await?;
    let result=migrate_legacy(&pool).await;
    pool.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};

    #[derive(Default)]
    struct MemoryStore { values: Mutex<HashMap<String, String>>, fail_writes: bool, fail_reads: bool, fail_deletes: bool, lose_writes: bool }
    impl SecretStore for MemoryStore {
        fn read(&self, a: &str) -> Result<Option<String>, String> { if self.fail_reads { return Err("Access denied".into()); } Ok(self.values.lock().unwrap().get(a).cloned()) }
        fn write(&self, a: &str, s: &str) -> Result<(), String> {
            if self.fail_writes { return Err("Credential store locked".into()); }
            if !self.lose_writes { self.values.lock().unwrap().insert(a.into(), s.into()); } Ok(())
        }
        fn delete(&self, a: &str) -> Result<(), String> { if self.fail_deletes { return Err("Access denied".into()); } self.values.lock().unwrap().remove(a); Ok(()) }
    }
    async fn db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE settings(id TEXT PRIMARY KEY, openaiApiKey TEXT, customOpenAIConfig TEXT)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings VALUES('1', 'dummy-legacy-key', NULL)").execute(&pool).await.unwrap(); pool
    }
    #[tokio::test]
    async fn migration_preserves_key_and_removes_plaintext() {
        let pool=db().await; let store=Arc::new(MemoryStore::default()); let slot=Slot::summary("openai").unwrap().unwrap();
        assert_eq!(read_with(&pool,slot.clone(),store.clone()).await.unwrap().as_deref(),Some("dummy-legacy-key"));
        assert!(legacy(&pool,&slot).await.unwrap().is_none());
        assert_eq!(read_with(&pool,slot,store).await.unwrap().as_deref(),Some("dummy-legacy-key"));
    }
    #[tokio::test]
    async fn unavailable_store_retains_original_and_returns_error() {
        let pool=db().await; let store=Arc::new(MemoryStore{fail_writes:true,..Default::default()}); let slot=Slot::summary("openai").unwrap().unwrap();
        assert!(read_with(&pool,slot.clone(),store.clone()).await.is_err());
        assert!(write_with(&pool,slot.clone(),"dummy-new-key",store).await.is_err());
        assert_eq!(legacy(&pool,&slot).await.unwrap().as_deref(),Some("dummy-legacy-key"));
    }
    #[tokio::test]
    async fn replacement_and_deletion_do_not_resurrect_legacy_keys() {
        let pool=db().await; let store=Arc::new(MemoryStore::default()); let slot=Slot::summary("openai").unwrap().unwrap();
        write_with(&pool,slot.clone(),"dummy-replacement",store.clone()).await.unwrap();
        assert_eq!(read_with(&pool,slot.clone(),store.clone()).await.unwrap().as_deref(),Some("dummy-replacement"));
        delete_with(&pool,slot.clone(),store.clone()).await.unwrap();
        assert!(read_with(&pool,slot,store).await.unwrap().is_none());
    }
    #[tokio::test]
    async fn custom_json_is_redacted_and_keys_are_bound_to_endpoint() {
        let pool=db().await; let store=Arc::new(MemoryStore::default()); let slot=Slot::custom("https://one.example/v1");
        sqlx::query("UPDATE settings SET customOpenAIConfig=?").bind(r#"{"endpoint":"https://one.example/v1","apiKey":"dummy-custom","model":"test"}"#).execute(&pool).await.unwrap();
        assert_eq!(read_with(&pool,slot,store.clone()).await.unwrap().as_deref(),Some("dummy-custom"));
        let json:String=sqlx::query_scalar("SELECT customOpenAIConfig FROM settings").fetch_one(&pool).await.unwrap();
        assert!(!json.contains("dummy-custom")); assert!(json.contains("test"));
        assert!(read_with(&pool,Slot::custom("https://two.example/v1"),store).await.unwrap().is_none());
    }
    #[test]
    fn credential_slots_are_distinct_and_provider_names_are_not_sql() {
        assert_ne!(Slot::summary("openai").unwrap().unwrap().account,Slot::transcription("openai").unwrap().unwrap().account);
        assert!(Slot::summary("openai; DROP TABLE settings").is_err());
        assert_eq!(Slot::custom("https://one.example/v1/").account,Slot::custom("https://one.example/v1").account);
    }
    #[tokio::test]
    async fn denial_and_unverified_writes_never_erase_legacy_credentials() {
        for store in [MemoryStore { fail_reads: true, ..Default::default() }, MemoryStore { lose_writes: true, ..Default::default() }] {
            let pool = db().await;
            let slot = Slot::summary("openai").unwrap().unwrap();
            assert!(read_with(&pool, slot.clone(), Arc::new(store)).await.is_err());
            assert_eq!(legacy(&pool, &slot).await.unwrap().as_deref(), Some("dummy-legacy-key"));
        }
        let pool = db().await;
        let slot = Slot::summary("openai").unwrap().unwrap();
        assert!(delete_with(&pool, slot.clone(), Arc::new(MemoryStore { fail_deletes: true, ..Default::default() })).await.is_err());
        assert!(legacy(&pool, &slot).await.unwrap().is_some());
    }
    #[tokio::test]
    async fn migration_removes_secret_bytes_from_database_and_wal() {
        use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite");
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(&path).create_if_missing(true).journal_mode(SqliteJournalMode::Wal)).await.unwrap();
        sqlx::query("CREATE TABLE settings(id TEXT PRIMARY KEY, openaiApiKey TEXT)").execute(&pool).await.unwrap();
        let secret = "dummy-file-migration-secret-canary";
        sqlx::query("INSERT INTO settings VALUES('1', ?)").bind(secret).execute(&pool).await.unwrap();
        read_with(&pool, Slot::summary("openai").unwrap().unwrap(), Arc::new(MemoryStore::default())).await.unwrap();
        for file in std::fs::read_dir(dir.path()).unwrap() {
            let bytes = std::fs::read(file.unwrap().path()).unwrap();
            assert!(!bytes.windows(secret.len()).any(|window| window == secret.as_bytes()));
        }
        pool.close().await;
    }
    #[tokio::test]
    async fn both_active_and_legacy_copies_are_cleaned_and_denial_retains_secret() {
        let root=tempfile::tempdir().unwrap();
        let store=Arc::new(MemoryStore::default());
        for name in ["meeting_minutes.sqlite","meeting_minutes.db"] {
            let path=root.path().join(name);
            let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await.unwrap();
            sqlx::query("CREATE TABLE settings(id TEXT PRIMARY KEY, openaiApiKey TEXT)").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO settings VALUES('1','test-legacy-copy-secret')").execute(&pool).await.unwrap();
            let denied=Arc::new(MemoryStore{fail_reads:true,..Default::default()});
            assert!(migrate_legacy_with(&pool,denied).await.is_err());
            let retained:Option<String>=sqlx::query_scalar("SELECT openaiApiKey FROM settings").fetch_one(&pool).await.unwrap();
            assert!(retained.is_some());
            migrate_legacy_with(&pool,store.clone()).await.unwrap();
            pool.close().await;
            assert!(!std::fs::read(&path).unwrap().windows(b"test-legacy-copy-secret".len()).any(|s|s==b"test-legacy-copy-secret"));
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Writes and deletes one random dummy Keychain item; run explicitly on macOS"]
    fn native_keychain_round_trip() {
        let account=format!("security-test/{}",uuid::Uuid::new_v4()); let store=OsStore;
        store.write(&account,"tetro-dummy-credential").unwrap();
        let result=store.read(&account);
        store.delete(&account).unwrap();
        assert_eq!(result.unwrap().as_deref(),Some("tetro-dummy-credential"));
        assert!(store.read(&account).unwrap().is_none());
    }
}
