mod browser;
mod config;
mod server;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Local;
use notify::RecommendedWatcher; // Required for Debouncer type inference
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg(target_os = "windows")]
use std::io;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const MIN_WINDOW_WIDTH: f64 = 800.0;
const MIN_WINDOW_HEIGHT: f64 = 600.0;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn startup_window_size(screen_width: f64, screen_height: f64) -> (f64, f64) {
    let target_width = screen_width * 0.82;
    let target_height = screen_height * 0.86;
    let max_width = (screen_width - 64.0).max(MIN_WINDOW_WIDTH);
    let max_height = (screen_height - 64.0).max(MIN_WINDOW_HEIGHT);

    let width = target_width.clamp(MIN_WINDOW_WIDTH, max_width).round();
    let height = target_height.clamp(MIN_WINDOW_HEIGHT, max_height).round();
    (width, height)
}

#[derive(Debug, Default)]
struct EmbeddedGatewayState {
    status: Mutex<EmbeddedGatewayStatus>,
}

#[derive(Debug, Default)]
struct ManagedSidecarState {
    process: Mutex<Option<server::ManagedSidecarProcess>>,
}

impl ManagedSidecarState {
    fn set(&self, process: server::ManagedSidecarProcess) {
        let pid = process.id();
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut previous) = guard.take() {
                tracing::warn!(
                    "Replacing managed InternShannon sidecar pid={} with pid={pid}",
                    previous.id()
                );
                previous.shutdown();
            }
            tracing::info!("Registered managed InternShannon sidecar pid={pid}");
            *guard = Some(process);
        }
    }

    fn shutdown(&self) {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut process) = guard.take() {
                process.shutdown();
            }
        }
    }
}

impl Drop for ManagedSidecarState {
    fn drop(&mut self) {
        if let Ok(guard) = self.process.get_mut() {
            if let Some(mut process) = guard.take() {
                process.shutdown();
            }
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedGatewayLogEntry {
    at: String,
    stage: String,
    message: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedGatewayStatus {
    configured_url: String,
    host: String,
    port: u16,
    started: bool,
    last_error: Option<String>,
    last_error_stage: Option<String>,
    last_error_code: Option<String>,
    diagnostic_report_path: Option<String>,
    port_in_use: bool,
    port_owner_pid: Option<u32>,
    port_owner_name: Option<String>,
    startup_log: Vec<EmbeddedGatewayLogEntry>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogWorkspaceStatus {
    workspace_root: Option<String>,
    log_directory: Option<String>,
    active_log_file: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopbackHttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoopbackHttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchBrowserStatus {
    backend: String,
    installed: bool,
    path: Option<String>,
    version: Option<String>,
    supported: bool,
    verified: bool,
    snapshot: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSearchOptions {
    is_regex: bool,
    is_case_sensitive: bool,
    is_whole_word: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSearchMatch {
    file: String,
    line: usize,
    column: usize,
    content: String,
}

#[derive(Debug, Deserialize)]
struct BrowserBinaryManifest {
    snapshot: String,
    platforms: HashMap<String, BrowserBinaryPlatform>,
}

#[derive(Debug, Deserialize)]
struct BrowserBinaryPlatform {
    url: String,
    sha256: String,
}

const BROWSER_BINARY_MANIFEST: &str = include_str!("../../../sidecar/config/browser-binary.json");

fn current_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn startup_log_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

fn push_embedded_gateway_log(
    status: &mut EmbeddedGatewayStatus,
    stage: impl Into<String>,
    message: impl Into<String>,
) {
    status.startup_log.push(EmbeddedGatewayLogEntry {
        at: startup_log_timestamp(),
        stage: stage.into(),
        message: message.into(),
    });
    const MAX_ENTRIES: usize = 80;
    if status.startup_log.len() > MAX_ENTRIES {
        let overflow = status.startup_log.len() - MAX_ENTRIES;
        status.startup_log.drain(0..overflow);
    }
}

fn default_gateway_host() -> String {
    "127.0.0.1".to_string()
}

fn default_gateway_port() -> u16 {
    29653
}

const GATEWAY_FALLBACK_PORT_COUNT: u16 = 20;

fn select_available_gateway_port(
    preferred_port: u16,
    mut port_in_use: impl FnMut(u16) -> bool,
) -> Result<(u16, bool), String> {
    if !port_in_use(preferred_port) {
        return Ok((preferred_port, false));
    }

    for offset in 1..=GATEWAY_FALLBACK_PORT_COUNT {
        let Some(candidate) = preferred_port.checked_add(offset) else {
            break;
        };
        if !port_in_use(candidate) {
            return Ok((candidate, true));
        }
    }

    Err(format!(
        "No free loopback gateway port was found in {}-{}",
        preferred_port,
        preferred_port.saturating_add(GATEWAY_FALLBACK_PORT_COUNT)
    ))
}

fn gateway_owner_is_internshannon_sidecar(owner_command: Option<&str>) -> bool {
    owner_command
        .map(server::is_internshannon_sidecar_command)
        .unwrap_or(false)
}

fn show_blocking_message_dialog<R: tauri::Runtime>(
    app: &impl Manager<R>,
    title: &str,
    message: String,
    kind: MessageDialogKind,
    buttons: MessageDialogButtons,
) -> bool {
    let handle = app.app_handle().clone();
    let title = title.to_string();
    std::thread::spawn(move || {
        handle
            .dialog()
            .message(message)
            .title(title)
            .kind(kind)
            .buttons(buttons)
            .blocking_show()
    })
    .join()
    .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn run_hidden_command_output(program: &str, args: &[&str]) -> io::Result<std::process::Output> {
    let mut command = std::process::Command::new(program);
    command.args(args).creation_flags(CREATE_NO_WINDOW).output()
}

fn ensure_default_gateway_port_available<R: tauri::Runtime>(
    _app: &impl Manager<R>,
) -> Result<(String, u16, bool, Option<u32>, Option<String>), String> {
    let host = default_gateway_host();
    let preferred_port = default_gateway_port();
    let (port, preferred_port_in_use) =
        select_available_gateway_port(preferred_port, |candidate| inspect_port_owner(candidate).0)?;

    if !preferred_port_in_use {
        return Ok((host, port, false, None, None));
    }

    let (_, owner_pid, owner_name) = inspect_port_owner(preferred_port);
    let owner_label = match (owner_name.as_deref(), owner_pid) {
        (Some(name), Some(pid)) => format!("{name} (PID {pid})"),
        (None, Some(pid)) => format!("PID {pid}"),
        (Some(name), None) => name.to_string(),
        (None, None) => "unknown-process".to_string(),
    };
    let owner_command = owner_pid.and_then(server::process_command);
    if gateway_owner_is_internshannon_sidecar(owner_command.as_deref()) {
        return Err(format!(
            "Another 书小安 desktop sidecar is already running on the default gateway port {preferred_port} ({owner_label}). Close the older app before starting this build so both versions cannot write the same session store."
        ));
    }
    tracing::warn!(
        "Preferred gateway port {preferred_port} is already in use by {owner_label}; \
         starting an isolated sidecar on port {port} instead"
    );

    Ok((host, port, true, owner_pid, owner_name))
}

#[tauri::command]
fn get_gateway_url() -> String {
    std::env::var("INTERNSHANNON_GATEWAY_URL").unwrap_or_else(|_| {
        format!(
            "http://{}:{}",
            default_gateway_host(),
            default_gateway_port()
        )
    })
}

#[tauri::command]
fn get_embedded_gateway_status(
    state: tauri::State<'_, EmbeddedGatewayState>,
) -> Result<EmbeddedGatewayStatus, String> {
    state
        .status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "embedded gateway status lock poisoned".to_string())
}

#[tauri::command]
fn get_log_workspace_status() -> LogWorkspaceStatus {
    let workspace_root = dirs::home_dir().map(|p| p.join(".internshannon").join("workspace"));
    let log_directory = workspace_root.as_ref().map(|p| p.join("logs"));
    let active_log_file = log_directory.as_ref().and_then(|dir| {
        let entries = std::fs::read_dir(dir).ok()?;
        entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                if !metadata.is_file() {
                    return None;
                }
                let modified = metadata.modified().ok()?;
                Some((modified, entry.path()))
            })
            .max_by_key(|(modified, _)| *modified)
            .map(|(_, path)| path.display().to_string())
    });

    LogWorkspaceStatus {
        workspace_root: workspace_root.map(|p| p.display().to_string()),
        log_directory: log_directory.map(|p| p.display().to_string()),
        active_log_file,
    }
}

#[tauri::command]
fn write_client_diagnostic_report(payload: serde_json::Value) -> Result<String, String> {
    let report_dir = std::env::temp_dir();
    let report_path = report_dir.join(format!(
        "internshannon_client_diagnostic_{}_{}.json",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    let report = serde_json::json!({
        "kind": "client-diagnostic",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "payload": payload,
    });
    std::fs::write(
        &report_path,
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(report_path.display().to_string())
}

#[tauri::command]
fn open_url_in_browser(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http/https URLs can be opened".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn search_browser_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(|| dirs::home_dir().map(|home| home.join(".internshannon")))
        .ok_or_else(|| "Unable to resolve a writable data directory".to_string())?;
    Ok(base_dir.join("InternShannon").join("search-browsers"))
}

fn default_lightpanda_path() -> Result<PathBuf, String> {
    let file_name = if cfg!(target_os = "windows") {
        "lightpanda.exe"
    } else {
        "lightpanda"
    };
    Ok(search_browser_dir()?.join(file_name))
}

fn bundled_lightpanda_path() -> Option<PathBuf> {
    let resource_dir = std::env::var("TAURI_RESOURCE_PATH").ok()?;
    let file_name = if cfg!(target_os = "windows") {
        "lightpanda.exe"
    } else {
        "lightpanda"
    };
    Some(
        PathBuf::from(resource_dir)
            .join("search-browser")
            .join(file_name),
    )
}

fn executable_exists(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn browser_version(path: &Path) -> Option<String> {
    for argument in ["--version", "version"] {
        let Ok(output) = std::process::Command::new(path).arg(argument).output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(stdout);
        }
    }
    None
}

fn browser_manifest() -> Result<BrowserBinaryManifest, String> {
    serde_json::from_str(BROWSER_BINARY_MANIFEST)
        .map_err(|error| format!("Invalid bundled browser manifest: {error}"))
}

fn browser_platform_key() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        (os, arch) => Err(format!("Unsupported Lightpanda platform: {os}/{arch}")),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn verify_lightpanda_file(path: &Path, expected_sha256: &str) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "Failed to read Lightpanda binary {}: {error}",
            path.display()
        )
    })?;
    let actual = sha256_hex(&bytes);
    if actual.eq_ignore_ascii_case(expected_sha256) {
        Ok(())
    } else {
        Err(format!(
            "Lightpanda checksum mismatch: expected {expected_sha256}, got {actual}"
        ))
    }
}

fn find_chrome_path(configured_path: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = configured_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
    {
        if executable_exists(&path) {
            return Some(path);
        }
    }

    let candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
        macos_chromium_browser_candidates()
    } else if cfg!(target_os = "windows") {
        let mut paths = Vec::new();
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let root = PathBuf::from(program_files);
            paths.push(root.join("Google/Chrome/Application/chrome.exe"));
            paths.push(root.join("Microsoft/Edge/Application/msedge.exe"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            let root = PathBuf::from(program_files_x86);
            paths.push(root.join("Google/Chrome/Application/chrome.exe"));
            paths.push(root.join("Microsoft/Edge/Application/msedge.exe"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let root = PathBuf::from(local_app_data);
            paths.push(root.join("Google/Chrome/Application/chrome.exe"));
            paths.push(root.join("Microsoft/Edge/Application/msedge.exe"));
        }
        paths
    } else {
        vec![
            "/usr/bin/google-chrome".into(),
            "/usr/bin/google-chrome-stable".into(),
            "/usr/bin/chromium".into(),
            "/usr/bin/chromium-browser".into(),
            "/usr/bin/microsoft-edge".into(),
            "/usr/bin/microsoft-edge-stable".into(),
            "/usr/bin/brave-browser".into(),
        ]
    };

    candidates.into_iter().find(|path| executable_exists(path))
}

fn macos_chromium_browser_candidates() -> Vec<PathBuf> {
    vec![
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into(),
        "/Applications/Chromium.app/Contents/MacOS/Chromium".into(),
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".into(),
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser".into(),
    ]
}

fn lightpanda_asset_name() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("lightpanda-aarch64-macos"),
        ("macos", "x86_64") => Ok("lightpanda-x86_64-macos"),
        ("linux", "aarch64") => Ok("lightpanda-aarch64-linux"),
        ("linux", "x86_64") => Ok("lightpanda-x86_64-linux"),
        ("windows", _) => Err(
            "Lightpanda does not publish a native Windows binary yet. Use Chrome or run Lightpanda from WSL."
                .to_string(),
        ),
        (os, arch) => Err(format!("Unsupported Lightpanda platform: {os}/{arch}")),
    }
}

fn pinned_lightpanda_platform() -> Result<(String, BrowserBinaryPlatform), String> {
    let manifest = browser_manifest()?;
    let platform_key = browser_platform_key()?;
    let platform = manifest
        .platforms
        .into_iter()
        .find_map(|(key, value)| (key == platform_key).then_some(value))
        .ok_or_else(|| format!("Browser manifest has no entry for {platform_key}"))?;
    Ok((manifest.snapshot, platform))
}

#[tauri::command]
fn get_search_browser_status(
    backend: String,
    configured_path: Option<String>,
) -> Result<SearchBrowserStatus, String> {
    match backend.as_str() {
        "lightpanda" => {
            let path = configured_path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
                .or_else(|| bundled_lightpanda_path().filter(|path| executable_exists(path)))
                .unwrap_or(default_lightpanda_path()?);
            let installed = executable_exists(&path);
            let (snapshot, pinned) = match pinned_lightpanda_platform() {
                Ok(value) => value,
                Err(message) => {
                    return Ok(SearchBrowserStatus {
                        backend,
                        installed: false,
                        path: Some(path.display().to_string()),
                        version: None,
                        supported: false,
                        verified: false,
                        snapshot: None,
                        message: Some(message),
                    });
                }
            };
            let verification = installed.then(|| verify_lightpanda_file(&path, &pinned.sha256));
            let verified = matches!(verification, Some(Ok(())));
            let message = verification.and_then(Result::err).or_else(|| {
                verified.then(|| {
                    format!(
                        "已通过 {snapshot} SHA-256 校验；若刚完成安装，请重启书小安以启用 Web 搜索。"
                    )
                })
            });
            Ok(SearchBrowserStatus {
                backend,
                installed: installed && verified,
                path: Some(path.display().to_string()),
                version: verified.then(|| browser_version(&path)).flatten(),
                supported: lightpanda_asset_name().is_ok(),
                verified,
                snapshot: Some(snapshot),
                message,
            })
        }
        "chrome" => {
            let path = find_chrome_path(configured_path.as_deref());
            let version = path.as_deref().and_then(browser_version);
            let installed = path.is_some();
            Ok(SearchBrowserStatus {
                backend,
                installed,
                path: path.map(|path| path.display().to_string()),
                version,
                supported: true,
                verified: installed,
                snapshot: None,
                message: None,
            })
        }
        other => Err(format!("Unsupported browser backend: {other}")),
    }
}

#[tauri::command]
async fn download_search_browser(backend: String) -> Result<SearchBrowserStatus, String> {
    if backend != "lightpanda" {
        return Err("Only Lightpanda can be downloaded automatically. Chrome must be installed by the user.".to_string());
    }

    lightpanda_asset_name()?;
    let (_snapshot, pinned) = pinned_lightpanda_platform()?;
    let target_path = default_lightpanda_path()?;
    let temporary_path = target_path.with_extension("download");
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create browser directory: {error}"))?;
    }

    let bytes = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Failed to build download client: {error}"))?
        .get(&pinned.url)
        .header(reqwest::header::USER_AGENT, "InternShannon")
        .send()
        .await
        .map_err(|error| format!("Failed to download Lightpanda: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Lightpanda download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Failed to read Lightpanda download: {error}"))?;

    if sha256_hex(&bytes) != pinned.sha256.to_ascii_lowercase() {
        return Err("Downloaded Lightpanda failed the pinned SHA-256 check; the existing runtime was not replaced.".to_string());
    }

    std::fs::write(&temporary_path, &bytes)
        .map_err(|error| format!("Failed to write Lightpanda binary: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&temporary_path)
            .map_err(|error| format!("Failed to read Lightpanda metadata: {error}"))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&temporary_path, permissions)
            .map_err(|error| format!("Failed to make Lightpanda executable: {error}"))?;
    }

    std::fs::rename(&temporary_path, &target_path)
        .map_err(|error| format!("Failed to install verified Lightpanda binary: {error}"))?;

    get_search_browser_status(
        "lightpanda".to_string(),
        Some(target_path.display().to_string()),
    )
}

fn resolve_sidecar_search_browser_runtime() -> Option<server::SearchBrowserRuntime> {
    for (env_name, value) in [
        ("LIGHTPANDA", std::env::var("LIGHTPANDA").ok()),
        ("CHROME", std::env::var("CHROME").ok()),
    ] {
        let path = value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        if let Some(path) = path.filter(|path| executable_exists(path)) {
            return Some(server::SearchBrowserRuntime::new(
                env_name,
                path,
                "explicit environment pin",
            ));
        }
    }

    if let Ok((snapshot, pinned)) = pinned_lightpanda_platform() {
        let lightpanda_candidates = [bundled_lightpanda_path(), default_lightpanda_path().ok()];
        for path in lightpanda_candidates.into_iter().flatten() {
            if executable_exists(&path) && verify_lightpanda_file(&path, &pinned.sha256).is_ok() {
                return Some(server::SearchBrowserRuntime::new(
                    "LIGHTPANDA",
                    path,
                    snapshot.clone(),
                ));
            }
        }
    }

    find_chrome_path(None)
        .map(|path| server::SearchBrowserRuntime::new("CHROME", path, "system browser detection"))
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

#[tauri::command]
async fn loopback_http_request(
    request: LoopbackHttpRequest,
) -> Result<LoopbackHttpResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|error| format!("invalid url: {error}"))?;
    if url.scheme() != "http" {
        return Err("loopback request only supports http URLs".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "loopback request URL is missing host".to_string())?;
    if !is_loopback_host(host) {
        return Err(format!(
            "loopback request rejected non-loopback host: {host}"
        ));
    }

    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .map_err(|error| format!("invalid method: {error}"))?;
    let timeout = std::time::Duration::from_millis(request.timeout_ms.unwrap_or(30_000));
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("failed to build loopback client: {error}"))?;

    let mut builder = client.request(method, url);
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|error| format!("invalid header name '{key}': {error}"))?;
            let value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|error| format!("invalid header value for '{key}': {error}"))?;
            builder = builder.header(name, value);
        }
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("loopback request failed: {error}"))?;
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            headers.insert(key.as_str().to_string(), value.to_string());
        }
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read loopback response: {error}"))?
        .to_vec();

    Ok(LoopbackHttpResponse {
        status,
        headers,
        body,
    })
}

fn write_diagnostic_report(
    kind: &str,
    summary: &str,
    error: &str,
    mut details: Vec<(String, String)>,
) -> Option<String> {
    details.push(("ui_version".to_string(), current_app_version()));
    details.push((
        "gateway_url".to_string(),
        std::env::var("INTERNSHANNON_GATEWAY_URL").unwrap_or_else(|_| {
            format!(
                "http://{}:{}",
                default_gateway_host(),
                default_gateway_port()
            )
        }),
    ));
    details.push((
        "app_config_file".to_string(),
        dirs::home_dir()
            .map(|p| p.join(".internshannon").join("config.json"))
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "-".to_string()),
    ));
    details.push((
        "internshannon_config".to_string(),
        dirs::home_dir()
            .map(|p| p.join(".internshannon").join("config.hcl"))
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "-".to_string()),
    ));

    // Write diagnostic report to temp directory
    let report_path = std::env::temp_dir().join(format!(
        "internshannon_diagnostic_{}.json",
        std::process::id()
    ));
    let details_map: serde_json::Map<String, serde_json::Value> = details
        .into_iter()
        .map(|(k, v)| (k, serde_json::Value::String(v)))
        .collect();
    let report = serde_json::json!({
        "kind": kind,
        "summary": summary,
        "error": error,
        "details": details_map,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    match std::fs::write(
        &report_path,
        serde_json::to_string_pretty(&report).unwrap_or_default(),
    ) {
        Ok(_) => Some(report_path.display().to_string()),
        Err(report_error) => {
            tracing::warn!("Failed to write diagnostic report for {kind}: {report_error}");
            None
        }
    }
}

fn embedded_gateway_stage_label(stage: &str) -> &'static str {
    match stage {
        "port-check" => "端口预检查",
        "config-load" => "配置加载",
        "runtime-build" => "运行时构建",
        "agent-state-build" => "智能体状态初始化",
        "runtime-start" => "运行时服务启动",
        "process" => "本地后端进程",
        "health_check" => "本地后端健康检查",
        "skill-registry" => "技能注册表初始化",
        "placeholder-memory-store" => "本地占位存储初始化",
        "bind-address-parse" => "监听地址解析",
        "bind-listener" => "本地监听绑定",
        "status-read" => "状态读取",
        _ => "未分类阶段",
    }
}

fn build_embedded_gateway_failure_dialog(
    gateway_url: &str,
    failure: &server::SidecarStartupFailure,
    diagnostic_report_path: Option<&str>,
) -> String {
    let stage_label = embedded_gateway_stage_label(failure.stage);
    let mut message = format!(
        "书小安本地服务暂时没有准备好。\n\n界面会继续显示启动状态，并在“查看详情”中提供诊断信息。请先点击界面里的“重新检测”；如果仍未恢复，再重启应用。\n\n检测地址: {gateway_url}\n失败阶段: {stage_label}"
    );

    if let Some(path) = diagnostic_report_path {
        message.push_str(&format!("\n\n诊断报告已生成:\n{}", path));
    }

    tracing::warn!(
        stage = failure.stage,
        code = failure.code,
        gateway_url,
        error = %failure.message,
        "Embedded gateway startup failed"
    );

    message
}

fn inspect_port_owner(port: u16) -> (bool, Option<u32>, Option<String>) {
    #[cfg(target_os = "windows")]
    {
        let output = run_hidden_command_output("netstat", &["-ano", "-p", "tcp"]);
        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let needle = format!(":{port}");
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("TCP") {
                    continue;
                }
                let cols: Vec<&str> = trimmed.split_whitespace().collect();
                if cols.len() < 5 {
                    continue;
                }
                let local_addr = cols.get(1).copied().unwrap_or_default();
                let state = cols.get(3).copied().unwrap_or_default();
                if !local_addr.ends_with(&needle) {
                    continue;
                }
                if state != "LISTENING" {
                    continue;
                }
                let pid = cols.last().and_then(|value| value.parse::<u32>().ok());
                let process_name = pid.and_then(|pid| {
                    let filter = format!("PID eq {pid}");
                    run_hidden_command_output("tasklist", &["/FI", &filter, "/FO", "CSV", "/NH"])
                        .ok()
                        .and_then(|output| {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            stdout.lines().find_map(|line| {
                                let cleaned = line.trim().trim_matches('"');
                                if cleaned.is_empty() || cleaned.starts_with("INFO:") {
                                    return None;
                                }
                                cleaned.split("\",\"").next().map(|value| value.to_string())
                            })
                        })
                });
                return (true, pid, process_name);
            }
        }
        return (false, None, None);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fpc"])
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut pid: Option<u32> = None;
                let mut process_name: Option<String> = None;
                for line in stdout.lines() {
                    if let Some(value) = line.strip_prefix('p') {
                        pid = value.trim().parse::<u32>().ok();
                    } else if let Some(value) = line.strip_prefix('c') {
                        let value = value.trim();
                        if !value.is_empty() {
                            process_name = Some(value.to_string());
                        }
                    }
                    if pid.is_some() {
                        return (true, pid, process_name);
                    }
                }
            }
        }

        let listener = std::net::TcpListener::bind(("127.0.0.1", port));
        match listener {
            Ok(listener) => {
                drop(listener);
                (false, None, None)
            }
            Err(_) => {
                let owner_pid = std::process::Command::new("lsof")
                    .args(["-nP", "-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
                    .output()
                    .ok()
                    .and_then(|output| {
                        if !output.status.success() {
                            return None;
                        }
                        String::from_utf8_lossy(&output.stdout)
                            .lines()
                            .find_map(|line| line.trim().parse::<u32>().ok())
                    });
                let owner_name = owner_pid.and_then(|pid| {
                    std::process::Command::new("ps")
                        .args(["-p", &pid.to_string(), "-o", "comm="])
                        .output()
                        .ok()
                        .and_then(|output| {
                            if !output.status.success() {
                                return None;
                            }
                            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
                            if value.is_empty() {
                                None
                            } else {
                                Some(value)
                            }
                        })
                });
                (true, owner_pid, owner_name)
            }
        }
    }
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(
            Path::new(&path)
                .parent()
                .unwrap_or_else(|| Path::new(&path)),
        )
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeSourceFile {
    name: String,
    original_path: String,
    content_base64: String,
    size: u64,
}

#[tauri::command]
fn read_knowledge_source(path: String) -> Result<KnowledgeSourceFile, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_absolute() || !source.is_file() {
        return Err(
            "The selected knowledge source must be an existing absolute file path".to_string(),
        );
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "Invalid knowledge source filename".to_string())?
        .to_string();
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    Ok(KnowledgeSourceFile {
        name,
        original_path: source.to_string_lossy().to_string(),
        content_base64: BASE64_STANDARD.encode(&bytes),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
fn save_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let destination = PathBuf::from(path.trim());
    if destination.as_os_str().is_empty() || !destination.is_absolute() {
        return Err("The selected save path must be absolute".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(destination, bytes).map_err(|e| e.to_string())
}

fn validate_workspace_write_target(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Target file path is empty".to_string());
    }

    if path.is_dir() {
        return Err("Target path is a directory".to_string());
    }

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Target file path must include a parent directory".to_string())?;

    if !parent.exists() {
        return Err(format!(
            "Target directory does not exist: {}",
            parent.display()
        ));
    }

    if !parent.is_dir() {
        return Err(format!(
            "Target parent is not a directory: {}",
            parent.display()
        ));
    }

    Ok(())
}

#[tauri::command]
fn workspace_write_file(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Target file path is empty".to_string());
    }

    let target = PathBuf::from(path);
    validate_workspace_write_target(&target)?;
    fs::write(&target, content)
        .map_err(|error| format!("Failed to write file {}: {error}", target.display()))?;
    Ok(())
}

/// Execute a shell command and return its output
#[tauri::command]
async fn execute_command(
    command: String,
    working_directory: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = working_directory;
        let output =
            run_hidden_command_output("cmd", &["/C", &command]).map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let cwd = working_directory
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(&command)
            .current_dir(&cwd)
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// File change event emitted to frontend
#[derive(Clone, Serialize)]
struct FileChangeEvent {
    path: String,
}

/// State that holds all active file watchers
struct WatcherState {
    watchers: std::sync::Mutex<
        std::collections::HashMap<String, notify_debouncer_mini::Debouncer<RecommendedWatcher>>,
    >,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watchers: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

/// Start a file watcher for the given directory.
/// Emits "file-change" events when files are modified.
#[tauri::command]
async fn start_file_watcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<WatcherState>>,
    config_state: tauri::State<'_, Arc<config::AppConfig>>,
    path: String,
) -> Result<(), String> {
    use notify::RecursiveMode;
    use notify_debouncer_mini::{new_debouncer, DebouncedEvent};

    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path_buf.display()));
    }

    // Get config settings
    let watcher_config = config_state.watcher_config();
    let skip_globset = config_state.skip_globset();

    let path_str = path_buf.to_string_lossy();
    if skip_globset.is_match(&*path_str) {
        tracing::debug!("Skipping watcher for path matching skip patterns: {}", path);
        return Ok(());
    }

    // Count entries to check if directory is too large (configurable)
    if let Ok(entries) = std::fs::read_dir(&path_buf) {
        let count = entries.count();
        if count > watcher_config.max_entries {
            tracing::warn!(
                "Directory has too many entries ({}), skipping watcher: {}",
                count,
                path
            );
            return Ok(());
        }
    }

    let app_handle = app.clone();
    let watch_path = path.clone();

    // Check if already watching this path
    {
        let watchers = state.watchers.lock().unwrap();
        if watchers.contains_key(&path) {
            tracing::debug!("Already watching: {}", path);
            return Ok(());
        }
    }

    // Clone globset for use in the callback
    let skip_glob = skip_globset.clone();
    let debounce_ms = watcher_config.debounce_ms;

    // Use debounced watcher to avoid flooding with rapid events
    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(debounce_ms),
        move |res: Result<Vec<DebouncedEvent>, notify::Error>| {
            match res {
                Ok(events) => {
                    for event in events {
                        let path_str = event.path.to_string_lossy().to_string();
                        // Skip paths matching skip patterns (e.g., .git internal files)
                        if skip_glob.is_match(&path_str) {
                            continue;
                        }
                        let _ = app_handle.emit("file-change", FileChangeEvent { path: path_str });
                    }
                }
                Err(e) => {
                    // SideX pattern: only warn once for ENOSPC/EMFILE errors to avoid log spam
                    let err_str = e.to_string();
                    if err_str.contains("No space left on device") || err_str.contains("EMFILE") {
                        // These errors indicate system limits reached, don't restart watcher
                        tracing::error!("File watcher error (will not restart): {:?}", e);
                    } else {
                        tracing::warn!("File watcher error: {:?}", e);
                    }
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    // Watch the directory recursively
    let watcher = debouncer.watcher();
    watcher
        .watch(&path_buf, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    tracing::info!("Started file watcher for: {}", watch_path);

    // Store the watcher
    let mut watchers = state.watchers.lock().unwrap();
    watchers.insert(watch_path, debouncer);

    Ok(())
}

/// Stop the file watcher for the given directory
#[tauri::command]
fn stop_file_watcher(
    state: tauri::State<'_, Arc<WatcherState>>,
    path: String,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    watchers.remove(&path);
    tracing::info!("Stopped file watcher for: {}", path);
    Ok(())
}

fn should_skip_search_path(path: &Path) -> bool {
    const SKIP_DIRS: &[&str] = &[
        ".git",
        ".svn",
        ".hg",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".cache",
        "coverage",
    ];
    const SKIP_EXTS: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "pdf", "zip", "gz", "tar",
        "rar", "7z", "woff", "woff2", "ttf", "otf", "mp4", "mov", "avi", "mkv", "mp3", "wav",
        "dmg", "exe", "dll", "so", "dylib", "class", "jar",
    ];

    for component in path.components() {
        if let Some(name) = component.as_os_str().to_str() {
            if SKIP_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip)) {
                return true;
            }
        }
    }

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SKIP_EXTS.iter().any(|skip| ext.eq_ignore_ascii_case(skip)))
        .unwrap_or(false)
}

fn is_word_boundary(text: &str, byte_index: usize) -> bool {
    if byte_index == 0 || byte_index >= text.len() {
        return true;
    }
    text[..byte_index]
        .chars()
        .next_back()
        .map(|ch| !ch.is_alphanumeric() && ch != '_')
        .unwrap_or(true)
}

fn find_literal_matches(line: &str, query: &str, options: &WorkspaceSearchOptions) -> Vec<usize> {
    if query.is_empty() {
        return vec![];
    }

    let haystack = if options.is_case_sensitive {
        line.to_string()
    } else {
        line.to_lowercase()
    };
    let needle = if options.is_case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let mut result = Vec::new();
    let mut offset = 0;
    while offset <= haystack.len() {
        let Some(relative) = haystack[offset..].find(&needle) else {
            break;
        };
        let start = offset + relative;
        let end = start + needle.len();
        let whole_word_ok = !options.is_whole_word
            || (is_word_boundary(line, start) && is_word_boundary(line, end));
        if whole_word_ok {
            result.push(start);
        }
        offset = end.max(start + 1);
    }
    result
}

fn trim_search_line(line: &str) -> String {
    const MAX_CHARS: usize = 260;
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_CHARS {
        return trimmed.to_string();
    }
    let mut value: String = trimmed.chars().take(MAX_CHARS).collect();
    value.push('…');
    value
}

#[tauri::command]
async fn search_in_workspace(
    query: String,
    workspace_path: String,
    options: WorkspaceSearchOptions,
) -> Result<Vec<WorkspaceSearchMatch>, String> {
    const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
    const MAX_RESULTS: usize = 1200;

    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(vec![]);
    }

    let root = PathBuf::from(workspace_path);
    if !root.exists() {
        return Err(format!("Workspace path does not exist: {}", root.display()));
    }

    let regex = if options.is_regex {
        let pattern = if options.is_whole_word {
            format!(r"\b(?:{})\b", query)
        } else {
            query.clone()
        };
        Some(
            regex::RegexBuilder::new(&pattern)
                .case_insensitive(!options.is_case_sensitive)
                .build()
                .map_err(|error| format!("Invalid regex: {error}"))?,
        )
    } else {
        None
    };

    let mut matches = Vec::new();
    let mut stack = vec![root.clone()];

    while let Some(path) = stack.pop() {
        if matches.len() >= MAX_RESULTS || should_skip_search_path(&path) {
            continue;
        }

        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            let entries = match std::fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                stack.push(entry.path());
            }
            continue;
        }

        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            continue;
        }

        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };

        for (line_index, line) in content.lines().enumerate() {
            if matches.len() >= MAX_RESULTS {
                break;
            }

            let positions = if let Some(regex) = regex.as_ref() {
                regex.find_iter(line).map(|match_| match_.start()).collect()
            } else {
                find_literal_matches(line, &query, &options)
            };

            for position in positions {
                if matches.len() >= MAX_RESULTS {
                    break;
                }
                matches.push(WorkspaceSearchMatch {
                    file: path.to_string_lossy().to_string(),
                    line: line_index + 1,
                    column: line[..position].chars().count() + 1,
                    content: trim_search_line(line),
                });
            }
        }
    }

    matches.sort_by(|left, right| {
        left.file
            .cmp(&right.file)
            .then(left.line.cmp(&right.line))
            .then(left.column.cmp(&right.column))
    });

    Ok(matches)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "internshannon=info,a3s_code=debug,a3s_power=debug,tower_http=debug".into()
            }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_menu_event(|app, event| {
            let payload = match event.id().as_ref() {
                "edit-undo" => Some("undo"),
                "edit-redo" => Some("redo"),
                _ => None,
            };
            if let Some(payload) = payload {
                if let Err(error) = app.emit("menu-event", payload) {
                    tracing::warn!("Failed to forward native edit menu event: {error}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            reveal_in_folder,
            read_knowledge_source,
            save_file_bytes,
            workspace_write_file,
            open_url_in_browser,
            execute_command,
            get_gateway_url,
            get_embedded_gateway_status,
            get_log_workspace_status,
            write_client_diagnostic_report,
            get_search_browser_status,
            download_search_browser,
            search_in_workspace,
            start_file_watcher,
            stop_file_watcher,
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_close,
            browser::browser_resize,
            browser::browser_show,
            browser::browser_hide,
            browser::browser_eval,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_reload,
            browser::browser_get_page_text,
            browser::browser_page_event,
            browser::browser_hide_all,
            browser::browser_show_active,
            loopback_http_request,
        ])
        .setup(|app| {
            // Initialize browser state
            app.manage(browser::BrowserState::default());
            app.manage(EmbeddedGatewayState::default());
            app.manage(ManagedSidecarState::default());
            // Initialize file watcher state
            app.manage(Arc::new(WatcherState::default()));
            // Load UI config from ~/.internshannon/config.hcl
            let app_config = config::AppConfig::load();
            tracing::info!("Loaded InternShannon UI config: watcher={:?}", app_config.watcher_config());
            app.manage(Arc::new(app_config));
            let (gateway_host, gateway_port, preferred_port_in_use, owner_pid, owner_name) =
                match ensure_default_gateway_port_available(app) {
                    Ok(binding) => binding,
                    Err(error) => {
                        let report_path = write_diagnostic_report(
                            "embedded-gateway-startup-blocked",
                            "书小安 startup was aborted before the embedded gateway could bind.",
                            &error,
                            vec![
                                (
                                    "default_gateway_url".to_string(),
                                    format!("http://{}:{}", default_gateway_host(), default_gateway_port()),
                                ),
                                (
                                    "port_owner_pid".to_string(),
                                    "-".to_string(),
                                ),
                                (
                                    "port_owner_name".to_string(),
                                    "-".to_string(),
                                ),
                            ],
                        );
                        if let Ok(mut status) = app.state::<EmbeddedGatewayState>().status.lock() {
                            status.configured_url =
                                format!("http://{}:{}", default_gateway_host(), default_gateway_port());
                            status.host = default_gateway_host();
                            status.port = default_gateway_port();
                            status.started = false;
                            status.last_error = Some(error.clone());
                            status.last_error_stage = Some("port-check".to_string());
                            status.last_error_code = Some("gateway_port_occupied".to_string());
                            status.diagnostic_report_path = report_path;
                            let (port_in_use, port_owner_pid, port_owner_name) =
                                inspect_port_owner(default_gateway_port());
                            status.port_in_use = port_in_use;
                            status.port_owner_pid = port_owner_pid;
                            status.port_owner_name = port_owner_name;
                            let configured_url = status.configured_url.clone();
                            status.startup_log.clear();
                            push_embedded_gateway_log(
                                &mut status,
                                "port-check",
                                format!(
                                    "Startup aborted because {} is unavailable",
                                    configured_url
                                ),
                            );
                        }
                        tracing::warn!("Aborting startup because embedded gateway port is unavailable: {error}");
                        app.handle().exit(1);
                        return Ok(());
                    }
                };
            std::env::set_var("INTERNSHANNON_GATEWAY_HOST", &gateway_host);
            std::env::set_var("INTERNSHANNON_GATEWAY_PORT", gateway_port.to_string());
            std::env::set_var(
                "INTERNSHANNON_GATEWAY_URL",
                format!("http://{}:{}", gateway_host, gateway_port),
            );
            #[cfg(not(debug_assertions))]
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    std::env::set_var("TAURI_RESOURCE_PATH", &resource_dir);
                    tracing::info!(
                        "Configured bundled resource dir for sidecar: {}",
                        resource_dir.display()
                    );
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to resolve bundled resource dir for sidecar: {error}"
                    );
                }
            }
            if let Ok(mut status) = app.state::<EmbeddedGatewayState>().status.lock() {
                status.configured_url = get_gateway_url();
                status.host = gateway_host.clone();
                status.port = gateway_port;
                status.port_in_use = preferred_port_in_use;
                status.port_owner_pid = owner_pid;
                status.port_owner_name = owner_name;
                status.last_error = None;
                status.last_error_stage = None;
                status.last_error_code = None;
                status.diagnostic_report_path = None;
                status.started = false;
                let configured_url = status.configured_url.clone();
                status.startup_log.clear();
                push_embedded_gateway_log(
                    &mut status,
                    "desktop-setup",
                    format!("Prepared embedded gateway target {}", configured_url),
                );
            }

            // On macOS the native menu bar is required for system keyboard
            // shortcuts (Cmd+Z/X/C/V/A) and the App menu (Hide, Quit, About).
            // On Windows/Linux the WebView handles those shortcuts natively,
            // so we skip the menu entirely to keep the window chrome clean.
            #[cfg(target_os = "macos")]
            {
            use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};

            let handle = app.handle();

            let app_menu = SubmenuBuilder::new(handle, "书小安")
                .item(&PredefinedMenuItem::about(handle, None, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::hide_others(handle, None)?)
                .item(&PredefinedMenuItem::show_all(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(handle, None)?)
                .build()?;

            // WebKit's predefined Undo/Redo items operate on the WebView's
            // native responder chain, not Monaco's text model. Use explicit
            // menu commands so Cmd+Z/Cmd+Shift+Z are forwarded to the focused
            // application editor through `menu-event`.
            let undo_item = MenuItemBuilder::with_id("edit-undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(handle)?;
            let redo_item = MenuItemBuilder::with_id("edit-redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(handle)?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .item(&PredefinedMenuItem::cut(handle, None)?)
                .item(&PredefinedMenuItem::copy(handle, None)?)
                .item(&PredefinedMenuItem::paste(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::select_all(handle, None)?)
                .build()?;

            let menu = MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;
            }

            // Size window based on current monitor dimensions.
            let window = app
                .get_webview_window("main")
                .expect("main window should exist");
            if let Some(monitor) = window.current_monitor().ok().flatten() {
                let screen_width = monitor.size().width as f64 / monitor.scale_factor();
                let screen_height = monitor.size().height as f64 / monitor.scale_factor();
                let (win_width, win_height) = startup_window_size(screen_width, screen_height);
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: win_width,
                    height: win_height,
                }));
                let _ = window.center();
            }

            // System tray: show the window on click and provide an explicit quit action
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Use app's default window icon for tray
            let tray_icon = app.default_window_icon().cloned().expect("no default icon");

            let _tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("书小安")
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.state::<ManagedSidecarState>().shutdown();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // The desktop app treats the main window's close button as an explicit
            // quit action. Keeping the process hidden in the Dock/tray is surprising
            // here and also leaves the bundled gateway alive after the UI disappears.
            let main_window = app.get_webview_window("main").unwrap();
            let close_app_handle = app.handle().clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    close_app_handle.state::<ManagedSidecarState>().shutdown();
                    close_app_handle.exit(0);
                }
            });

            #[cfg(debug_assertions)]
            {
                window.open_devtools();
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    for delay_ms in [500_u64, 1500, 3000] {
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.open_devtools();
                        }
                    }
                });
            }

            // Spawn embedded InternShannon gateway in background
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let gateway_state = app_handle.state::<EmbeddedGatewayState>();
                if let Ok(mut status) = gateway_state.status.lock() {
                    status.configured_url = get_gateway_url();
                    push_embedded_gateway_log(
                        &mut status,
                        "desktop-setup",
                        "Launching embedded InternShannon gateway task",
                    );
                    let (port_in_use, port_owner_pid, port_owner_name) = inspect_port_owner(status.port);
                    status.port_in_use = port_in_use;
                    status.port_owner_pid = port_owner_pid;
                    status.port_owner_name = port_owner_name;
                }
                let progress_app_handle = app_handle.clone();
                let browser_runtime = resolve_sidecar_search_browser_runtime();
                let gateway_port = gateway_state
                    .status
                    .lock()
                    .ok()
                    .map(|status| status.port)
                    .unwrap_or_else(default_gateway_port);
                let startup_result = server::start_sidecar_with_progress(gateway_port, browser_runtime, move |stage, message| {
                    let gateway_state = progress_app_handle.state::<EmbeddedGatewayState>();
                    let status_result = gateway_state.status.lock();
                    if let Ok(mut status) = status_result {
                        push_embedded_gateway_log(&mut status, stage, message);
                        let (port_in_use, port_owner_pid, port_owner_name) =
                            inspect_port_owner(status.port);
                        status.port_in_use = port_in_use;
                        status.port_owner_pid = port_owner_pid;
                        status.port_owner_name = port_owner_name;
                    }
                })
                .await;
                match startup_result {
                    Err(e) => {
                        let report_path = write_diagnostic_report(
                            "embedded-gateway-start-failed",
                            "Embedded 书小安 gateway failed to start.",
                            &e.to_string(),
                            vec![
                                ("configured_url".to_string(), get_gateway_url()),
                                ("error_stage".to_string(), e.stage.to_string()),
                                ("error_code".to_string(), e.code.to_string()),
                                (
                                    "port".to_string(),
                                    gateway_state
                                        .status
                                        .lock()
                                        .ok()
                                        .map(|status| status.port.to_string())
                                        .unwrap_or_else(|| default_gateway_port().to_string()),
                                ),
                            ],
                        );
                        if let Ok(mut status) = gateway_state.status.lock() {
                            status.started = false;
                            status.last_error = Some(e.message.clone());
                            status.last_error_stage = Some(e.stage.to_string());
                            status.last_error_code = Some(e.code.to_string());
                            status.diagnostic_report_path = report_path.clone();
                            push_embedded_gateway_log(
                                &mut status,
                                e.stage,
                                format!("Startup failed: {}", e.message),
                            );
                            let (port_in_use, port_owner_pid, port_owner_name) =
                                inspect_port_owner(status.port);
                            status.port_in_use = port_in_use;
                            status.port_owner_pid = port_owner_pid;
                            status.port_owner_name = port_owner_name;
                        }
                        let message = build_embedded_gateway_failure_dialog(
                            &get_gateway_url(),
                            &e,
                            report_path.as_deref(),
                        );
                        let _ = show_blocking_message_dialog(
                            &app_handle,
                            "书小安 本地服务暂不可用",
                            message,
                            MessageDialogKind::Error,
                            MessageDialogButtons::Ok,
                        );
                        tracing::error!("Embedded gateway failed: {e:#}");
                    }
                    Ok(managed_process) => {
                        if let Some(process) = managed_process {
                            let pid = process.id();
                            app_handle.state::<ManagedSidecarState>().set(process);
                            if let Ok(mut status) = gateway_state.status.lock() {
                                push_embedded_gateway_log(
                                    &mut status,
                                    "spawn",
                                    format!("Managing embedded sidecar pid={pid} for app shutdown"),
                                );
                            }
                        }
                        if let Ok(mut status) = gateway_state.status.lock() {
                            status.started = true;
                            status.last_error = None;
                            status.last_error_stage = None;
                            status.last_error_code = None;
                            status.diagnostic_report_path = None;
                            let configured_url = status.configured_url.clone();
                            push_embedded_gateway_log(
                                &mut status,
                                "bind-listener",
                                format!("Embedded gateway is listening on {}", configured_url),
                            );
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building 书小安")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                app_handle.state::<ManagedSidecarState>().shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        browser_manifest, browser_platform_key, browser_version,
        gateway_owner_is_internshannon_sidecar, macos_chromium_browser_candidates,
        select_available_gateway_port, sha256_hex, startup_window_size, verify_lightpanda_file,
        workspace_write_file,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "internshannon-ui-{label}-{}-{nanos}",
            std::process::id()
        ))
    }

    #[test]
    fn startup_window_scales_for_large_screens() {
        let (w, h) = startup_window_size(2560.0, 1440.0);
        assert_eq!(w, 2099.0);
        assert_eq!(h, 1238.0);
    }

    #[test]
    fn startup_window_respects_minimum_size_on_small_screens() {
        let (w, h) = startup_window_size(1024.0, 640.0);
        assert_eq!(w, 840.0);
        assert_eq!(h, 600.0);
    }

    #[test]
    fn startup_window_never_exceeds_monitor_bounds() {
        let (w, h) = startup_window_size(820.0, 620.0);
        assert_eq!(w, 800.0);
        assert_eq!(h, 600.0);
    }

    #[test]
    fn gateway_uses_preferred_port_when_it_is_free() {
        assert_eq!(
            select_available_gateway_port(29653, |_| false).expect("select preferred port"),
            (29653, false)
        );
    }

    #[test]
    fn gateway_uses_first_free_fallback_instead_of_reusing_old_app() {
        let selected =
            select_available_gateway_port(29653, |port| matches!(port, 29653 | 29654 | 29655))
                .expect("select isolated fallback port");
        assert_eq!(selected, (29656, true));
    }

    #[test]
    fn gateway_blocks_another_internshannon_sidecar_from_using_a_shared_store() {
        assert!(gateway_owner_is_internshannon_sidecar(Some(
            "/Applications/InternShannon.app/Contents/Resources/node/bin/node /Applications/InternShannon.app/Contents/Resources/main.js"
        )));
        assert!(gateway_owner_is_internshannon_sidecar(Some(
            "/repo/node /repo/apps/sidecar/dist/main.js"
        )));
        assert!(!gateway_owner_is_internshannon_sidecar(Some(
            "/usr/local/bin/node /other/project/main.js"
        )));
        assert!(!gateway_owner_is_internshannon_sidecar(None));
    }

    #[test]
    fn workspace_write_file_rejects_empty_path() {
        let error = workspace_write_file("  ".to_string(), "content".to_string()).unwrap_err();
        assert!(error.contains("empty"));
    }

    #[test]
    fn workspace_write_file_rejects_missing_parent_directory() {
        let dir = unique_test_dir("missing-parent");
        let target = dir.join("session.json");
        let error =
            workspace_write_file(target.display().to_string(), "content".to_string()).unwrap_err();
        assert!(error.contains("does not exist"));
    }

    #[test]
    fn workspace_write_file_rejects_directory_target() {
        let dir = unique_test_dir("directory-target");
        fs::create_dir_all(&dir).expect("create temp test dir");
        let error =
            workspace_write_file(dir.display().to_string(), "content".to_string()).unwrap_err();
        assert!(error.contains("directory"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn workspace_write_file_writes_utf8_content() {
        let dir = unique_test_dir("write");
        fs::create_dir_all(&dir).expect("create temp test dir");
        let target = dir.join("session.json");

        workspace_write_file(
            target.display().to_string(),
            "{\"ok\":\"internShannon\"}\n".to_string(),
        )
        .expect("write workspace file");

        let written = fs::read_to_string(&target).expect("read written file");
        assert_eq!(written, "{\"ok\":\"internShannon\"}\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_browser_manifest_has_a_pinned_platform_checksum() {
        let manifest = browser_manifest().expect("parse bundled browser manifest");
        let platform = manifest
            .platforms
            .get(browser_platform_key().expect("supported test platform"))
            .expect("manifest platform entry");

        assert!(manifest.snapshot.starts_with("0.3.1@"));
        assert_eq!(platform.sha256.len(), 64);
        assert!(platform
            .url
            .starts_with("https://github.com/lightpanda-io/browser/releases/download/0.3.1/"));
    }

    #[test]
    fn chromium_fallbacks_include_edge_and_brave_on_macos() {
        let candidates = macos_chromium_browser_candidates();
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("Microsoft Edge")));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("Brave Browser")));
    }

    #[test]
    fn lightpanda_checksum_verification_rejects_modified_bytes() {
        let dir = unique_test_dir("browser-checksum");
        fs::create_dir_all(&dir).expect("create browser checksum dir");
        let binary = dir.join("lightpanda");
        fs::write(&binary, b"verified-browser").expect("write browser fixture");
        let expected = sha256_hex(b"verified-browser");

        verify_lightpanda_file(&binary, &expected).expect("accept matching checksum");
        assert!(verify_lightpanda_file(&binary, &sha256_hex(b"different-browser")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn browser_version_supports_lightpanda_version_subcommand() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_test_dir("browser-version");
        fs::create_dir_all(&dir).expect("create browser version dir");
        let binary = dir.join("lightpanda");
        fs::write(
            &binary,
            b"#!/bin/sh\nif [ \"$1\" = \"version\" ]; then echo 0.3.1; exit 0; fi\nexit 1\n",
        )
        .expect("write browser version fixture");
        let mut permissions = fs::metadata(&binary)
            .expect("read browser version fixture")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).expect("make browser fixture executable");

        assert_eq!(browser_version(&binary).as_deref(), Some("0.3.1"));
        let _ = fs::remove_dir_all(&dir);
    }
}
