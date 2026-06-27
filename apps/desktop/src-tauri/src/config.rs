//! InternShannon UI configuration
//! Loads settings from ~/.internshannon/config.hcl

use globset::GlobSet;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

/// Editor configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorConfig {
    /// Auto-save delay in milliseconds (0 = disabled)
    #[serde(default = "default_auto_save_delay_ms")]
    pub auto_save_delay_ms: u64,
}

fn default_auto_save_delay_ms() -> u64 {
    30000
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            auto_save_delay_ms: 30000,
        }
    }
}

/// File watcher configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileWatcherConfig {
    /// Glob patterns for paths to skip watching
    #[serde(default)]
    pub skip_patterns: Vec<String>,
    /// Maximum entries per directory before skipping watcher
    #[serde(default = "default_max_entries")]
    pub max_entries: usize,
    /// Debounce delay in milliseconds
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u64,
}

fn default_max_entries() -> usize {
    5000
}

fn default_debounce_ms() -> u64 {
    200
}

impl Default for FileWatcherConfig {
    fn default() -> Self {
        Self {
            skip_patterns: vec![
                "*/target/*".to_string(),
                "*/node_modules/*".to_string(),
                "*/.git/objects/*".to_string(),
                "*/.git/refs/*".to_string(),
                "*/debug/deps/*".to_string(),
            ],
            max_entries: 5000,
            debounce_ms: 200,
        }
    }
}

/// Main InternShannon UI configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternShannonUiConfig {
    /// Editor settings
    #[serde(default)]
    pub editor: EditorConfig,
    /// File watcher settings
    #[serde(default)]
    pub watcher: FileWatcherConfig,
}

impl Default for InternShannonUiConfig {
    fn default() -> Self {
        Self {
            editor: EditorConfig::default(),
            watcher: FileWatcherConfig::default(),
        }
    }
}

/// Global app config state
pub struct AppConfig {
    config: RwLock<InternShannonUiConfig>,
    /// Pre-built globset for skip patterns (rebuilt when config changes)
    skip_globset: RwLock<Option<GlobSet>>,
}

impl AppConfig {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(InternShannonUiConfig::default()),
            skip_globset: RwLock::new(None),
        }
    }

    /// Load config from ~/.internshannon/config.hcl
    pub fn load() -> Self {
        let mut cfg = Self::new();
        cfg.reload().ok();
        cfg
    }

    /// Reload config from disk
    pub fn reload(&mut self) -> Result<(), String> {
        let config_path = Self::config_path()?;

        let content = if config_path.exists() {
            std::fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read config: {}", e))?
        } else {
            // Create default config if doesn't exist
            let default_hcl = Self::default_hcl();
            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create config dir: {}", e))?;
            }
            std::fs::write(&config_path, &default_hcl)
                .map_err(|e| format!("Failed to write default config: {}", e))?;
            default_hcl
        };

        let new_config: InternShannonUiConfig =
            hcl::from_str(&content).map_err(|e| format!("Failed to parse config.hcl: {}", e))?;

        // Rebuild globset
        let globset = Self::build_globset(&new_config.watcher.skip_patterns);

        *self.config.write().unwrap() = new_config;
        *self.skip_globset.write().unwrap() = globset;

        Ok(())
    }

    /// Get the config path
    fn config_path() -> Result<PathBuf, String> {
        dirs::home_dir()
            .ok_or_else(|| "Failed to get home directory".to_string())?
            .join(".internshannon")
            .join("config.hcl")
            .canonicalize()
            .or_else(|_| {
                // Return the path even if it doesn't exist yet
                Ok(dirs::home_dir()
                    .ok_or_else(|| "Failed to get home directory".to_string())?
                    .join(".internshannon")
                    .join("config.hcl"))
            })
    }

    /// Default HCL content
    fn default_hcl() -> String {
        String::from(
            r#"# InternShannon UI Configuration
# https://github.com/A3S-Lab/InternShannon

# Editor settings
editor {
  # Auto-save delay in milliseconds (0 = disabled, default 30000 = 30 seconds)
  auto_save_delay_ms = 30000
}

# File watcher settings
watcher {
  # Glob patterns for paths to skip watching
  skip_patterns = [
    "*/target/*",
    "*/node_modules/*",
    "*/.git/objects/*",
    "*/.git/refs/*",
    "*/debug/deps/*",
  ]

  # Maximum entries per directory before skipping watcher
  max_entries = 5000

  # Debounce delay in milliseconds
  debounce_ms = 200
}
"#,
        )
    }

    /// Build a GlobSet from skip patterns
    fn build_globset(patterns: &[String]) -> Option<GlobSet> {
        if patterns.is_empty() {
            return None;
        }
        let mut builder = globset::GlobSetBuilder::new();
        for pattern in patterns {
            if let Ok(glob) = globset::Glob::new(pattern) {
                builder.add(glob);
            }
        }
        builder.build().ok()
    }

    /// Get the skip globset for use in watcher callbacks
    pub fn skip_globset(&self) -> GlobSet {
        self.skip_globset
            .read()
            .unwrap()
            .clone()
            .unwrap_or_else(|| {
                // Return an empty globset that matches nothing
                let builder = globset::GlobSetBuilder::new();
                builder.build().unwrap()
            })
    }

    /// Get file watcher config
    pub fn watcher_config(&self) -> FileWatcherConfig {
        self.config.read().unwrap().watcher.clone()
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self::new()
    }
}
