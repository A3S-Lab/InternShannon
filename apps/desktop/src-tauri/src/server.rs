/// Embedded InternShannon API sidecar — spawns the NestJS process.
///
/// For Tauri bundling, the NestJS binary (built with tsdown) is placed
/// in the app resources directory. During development, we spawn it directly.
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

const DEFAULT_SIDECAR_READY_ATTEMPTS: usize = 120;
const MIN_SIDECAR_READY_ATTEMPTS: usize = 30;
const MAX_SIDECAR_READY_ATTEMPTS: usize = 300;

#[derive(Debug, Clone)]
pub struct SidecarStartupFailure {
    pub stage: &'static str,
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug)]
pub struct ManagedSidecarProcess {
    child: Child,
    stdout_log_path: PathBuf,
    stderr_log_path: PathBuf,
}

impl ManagedSidecarProcess {
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn shutdown(&mut self) {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return;
        }

        let pid = self.child.id();
        tracing::info!("Stopping managed InternShannon sidecar pid={pid}");
        let _ = terminate_process(pid);

        for _ in 0..20 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        tracing::warn!("Managed InternShannon sidecar pid={pid} did not exit after TERM; killing");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for ManagedSidecarProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl SidecarStartupFailure {
    fn new(stage: &'static str, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            stage,
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for SidecarStartupFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}/{}] {}", self.stage, self.code, self.message)
    }
}

impl std::error::Error for SidecarStartupFailure {}

fn truncate_for_log(value: &str, max_len: usize) -> String {
    let mut output = value.trim().replace('\n', " ");
    if output.len() > max_len {
        output.truncate(max_len);
        output.push_str("...");
    }
    output
}

fn sidecar_log_path(stream: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "internshannon_sidecar_{}_{}.log",
        stream,
        std::process::id()
    ))
}

fn open_sidecar_log(path: &PathBuf) -> Result<Stdio, SidecarStartupFailure> {
    fs::File::create(path).map(Stdio::from).map_err(|error| {
        SidecarStartupFailure::new(
            "spawn",
            "sidecar_log_failed",
            format!("Failed to create sidecar log {}: {error}", path.display()),
        )
    })
}

fn read_sidecar_log(path: &PathBuf, max_len: usize) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| truncate_for_log(&value, max_len))
        .filter(|value| !value.is_empty())
}

fn sidecar_exit_details(process: &ManagedSidecarProcess) -> String {
    let stderr = read_sidecar_log(&process.stderr_log_path, 1800);
    let stdout = read_sidecar_log(&process.stdout_log_path, 1000);
    let mut details = Vec::new();
    if let Some(stderr) = stderr {
        details.push(format!("stderr={stderr}"));
    }
    if let Some(stdout) = stdout {
        details.push(format!("stdout={stdout}"));
    }
    details.push(format!("stderr_log={}", process.stderr_log_path.display()));
    details.push(format!("stdout_log={}", process.stdout_log_path.display()));
    format!("; {}", details.join("; "))
}

/// Get the sidecar script path based on platform
/// In development, we spawn `node dist/main.js`. In production, we bundle the script
/// and spawn `node <script>` (requiring node to be available) or use a native executable.
fn get_sidecar_script() -> Result<PathBuf, SidecarStartupFailure> {
    tracing::debug!("Getting sidecar script path...");
    let resource_dir = std::env::var("TAURI_RESOURCE_PATH").unwrap_or_default();
    tracing::debug!("TAURI_RESOURCE_PATH: {:?}", resource_dir);

    if resource_dir.is_empty() {
        // Development mode: use the built CommonJS module
        let dev_path = PathBuf::from("../../../apps/sidecar/dist/main.js");
        tracing::debug!("Checking dev path: {:?}", dev_path);
        tracing::debug!("Dev path exists: {}", dev_path.exists());
        if dev_path.exists() {
            return Ok(dev_path);
        }
        return Err(SidecarStartupFailure::new(
            "path",
            "sidecar_not_found",
            format!("Sidecar script not found at {:?}", dev_path),
        ));
    }

    // Production mode: run the bundled JavaScript entrypoint with bundled Node.
    Ok(bundled_sidecar_script(Path::new(&resource_dir)))
}

fn bundled_sidecar_script(resource_dir: &Path) -> PathBuf {
    resource_dir.join("main.js")
}

fn executable_file(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|_| path.to_string_lossy().to_string())
}

fn node_from_env() -> Option<String> {
    std::env::var("INTERNSHANNON_NODE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .and_then(|value| executable_file(Path::new(&value)))
}

fn bundled_node_candidate(resource_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        resource_dir.join("node").join("node.exe")
    } else {
        resource_dir.join("node").join("bin").join("node")
    }
}

fn node_from_bundled_resource_dir(resource_dir: &Path) -> Option<String> {
    executable_file(&bundled_node_candidate(resource_dir))
}

fn node_from_bundled_resource() -> Option<String> {
    let resource_dir = std::env::var("TAURI_RESOURCE_PATH").ok()?;
    let resource_dir = resource_dir.trim();
    if resource_dir.is_empty() {
        return None;
    }
    node_from_bundled_resource_dir(Path::new(resource_dir))
}

fn node_from_path(binary_name: &str) -> Option<String> {
    let path_value = std::env::var_os("PATH")?;
    std::env::split_paths(&path_value)
        .map(|dir| dir.join(binary_name))
        .find_map(|path| executable_file(&path))
}

#[cfg(target_os = "macos")]
fn node_from_macos_common_paths() -> Option<String> {
    [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    .iter()
    .map(Path::new)
    .find_map(executable_file)
}

#[cfg(target_os = "macos")]
fn node_from_login_shell() -> Option<String> {
    let mut shells = vec!["/bin/zsh".to_string(), "/bin/bash".to_string()];
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.trim().is_empty() && !shells.iter().any(|candidate| candidate == shell.trim()) {
            shells.insert(0, shell.trim().to_string());
        }
    }

    shells.into_iter().find_map(|shell| {
        let output = Command::new(shell)
            .args(["-lc", "command -v node"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return None;
        }
        executable_file(Path::new(&path))
    })
}

/// Get the Node.js executable path.
///
/// macOS apps launched from Finder do not inherit the user's interactive shell
/// PATH, so "node" alone often fails even when Terminal can run the bundle.
fn get_node_executable() -> Result<String, SidecarStartupFailure> {
    if let Some(node) = node_from_env() {
        return Ok(node);
    }

    if let Some(node) = node_from_bundled_resource() {
        return Ok(node);
    }

    if cfg!(target_os = "windows") {
        return Ok(node_from_path("node.exe").unwrap_or_else(|| "node.exe".to_string()));
    }

    if let Some(node) = node_from_path("node") {
        return Ok(node);
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(node) = node_from_macos_common_paths() {
            return Ok(node);
        }
        if let Some(node) = node_from_login_shell() {
            return Ok(node);
        }
    }

    Err(SidecarStartupFailure::new(
        "spawn",
        "node_executable_not_found",
        "Node.js executable not found. Bundle Node.js with the app, install Node.js, or set INTERNSHANNON_NODE to an absolute node path.",
    ))
}

fn sidecar_ready_attempts() -> usize {
    std::env::var("INTERNSHANNON_SIDECAR_READY_ATTEMPTS")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_SIDECAR_READY_ATTEMPTS)
        .clamp(MIN_SIDECAR_READY_ATTEMPTS, MAX_SIDECAR_READY_ATTEMPTS)
}

/// Check if the sidecar HTTP server is healthy.
async fn is_sidecar_healthy(port: u16) -> bool {
    let client = match reqwest::Client::builder().no_proxy().build() {
        Ok(client) => client,
        Err(_) => return false,
    };
    match client
        .get(format!("http://127.0.0.1:{}/api/v1/health", port))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => true,
        _ => false,
    }
}

fn model_fetch_route_compatible_status(status: reqwest::StatusCode) -> bool {
    status != reqwest::StatusCode::NOT_FOUND && status != reqwest::StatusCode::METHOD_NOT_ALLOWED
}

fn knowledge_route_compatible_status(status: reqwest::StatusCode) -> bool {
    status.is_success()
}

/// Check whether the process already on the sidecar port supports the API shape
/// required by this desktop bundle. A healthy old sidecar can otherwise be
/// reused after an app update, leaving the new frontend talking to old routes.
async fn is_sidecar_api_compatible(port: u16) -> bool {
    let client = match reqwest::Client::builder().no_proxy().build() {
        Ok(client) => client,
        Err(_) => return false,
    };

    let model_fetch_compatible = match client
        .post(format!(
            "http://127.0.0.1:{}/api/v1/config/llm/providers/models/fetch",
            port
        ))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(r#"{"providerName":""}"#)
        .send()
        .await
    {
        Ok(resp) => model_fetch_route_compatible_status(resp.status()),
        Err(_) => false,
    };
    if !model_fetch_compatible {
        return false;
    }

    match client
        .get(format!(
            "http://127.0.0.1:{}/api/v1/assets/me/knowledge",
            port
        ))
        .send()
        .await
    {
        Ok(resp) => knowledge_route_compatible_status(resp.status()),
        Err(_) => false,
    }
}

/// Find the PIDs of processes listening on port.
fn find_port_29653_pids() -> Vec<u32> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("lsof")
            .args(["-t", "-iTCP:29653", "-sTCP:LISTEN"])
            .output()
            .ok();

        if let Some(output) = output {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter_map(|line| line.trim().parse::<u32>().ok())
                    .collect();
            }
        }
        Vec::new()
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("lsof")
            .args(["-t", "-iTCP:29653", "-sTCP:LISTEN"])
            .output()
            .ok();

        if let Some(output) = output {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter_map(|line| line.trim().parse::<u32>().ok())
                    .collect();
            }
        }
        Vec::new()
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .output()
            .ok();

        if let Some(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout
                .lines()
                .filter(|line| line.contains(":29653") && line.contains("LISTENING"))
                .filter_map(|line| line.split_whitespace().last())
                .filter_map(|pid_str| pid_str.parse::<u32>().ok())
                .collect();
        }
        Vec::new()
    }
}

fn process_command(pid: u32) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let filter = format!("PID eq {pid}");
        let output = std::process::Command::new("tasklist")
            .args(["/FI", &filter, "/FO", "CSV", "/NH"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.lines().find_map(|line| {
            let cleaned = line.trim().trim_matches('"');
            if cleaned.is_empty() || cleaned.starts_with("INFO:") {
                return None;
            }
            cleaned.split("\",\"").next().map(str::to_string)
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
}

fn process_command_label(pid: u32) -> Option<String> {
    process_command(pid).map(|value| truncate_for_log(&value, 160))
}

fn describe_port_29653_owners() -> String {
    let pids = find_port_29653_pids();
    if pids.is_empty() {
        return "owner unavailable".to_string();
    }

    pids.into_iter()
        .map(|pid| match process_command_label(pid) {
            Some(command) => format!("pid={pid} command={command}"),
            None => format!("pid={pid}"),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn is_internshannon_sidecar_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/");
    if !normalized.contains("main.js") {
        return false;
    }

    normalized.contains("internShannon.app/Contents/Resources/main.js")
        || normalized.contains("InternShannon.app/Contents/Resources/main.js")
        || normalized.contains("/apps/sidecar/dist/main.js")
}

fn terminate_process(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

async fn wait_for_port_to_be_free(port: u16) -> bool {
    for _ in 0..20 {
        if !is_port_in_use(port) {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    !is_port_in_use(port)
}

async fn restart_incompatible_internshannon_sidecar<F>(on_progress: &mut F) -> bool
where
    F: FnMut(&'static str, String),
{
    let pids = find_port_29653_pids();
    if pids.is_empty() {
        return false;
    }

    let mut terminated_any = false;
    for pid in pids {
        let Some(command) = process_command(pid) else {
            continue;
        };
        if !is_internshannon_sidecar_command(&command) {
            continue;
        }
        on_progress(
            "reuse",
            format!("Terminating incompatible existing InternShannon sidecar pid={pid}"),
        );
        if terminate_process(pid) {
            terminated_any = true;
        }
    }

    terminated_any && wait_for_port_to_be_free(29653).await
}

/// Ensure port 29653 is usable: reuse a healthy sidecar or report the owner.
async fn ensure_port_available<F>(on_progress: &mut F) -> Result<(), SidecarStartupFailure>
where
    F: FnMut(&'static str, String),
{
    if !is_port_in_use(29653) {
        on_progress("port-check", "Port 29653 is free".to_string());
        return Ok(());
    }

    on_progress(
        "port-check",
        "Port 29653 is already in use, checking whether it is a healthy sidecar".to_string(),
    );

    // Port is in use — check if existing sidecar is healthy
    if is_sidecar_healthy(29653).await {
        if is_sidecar_api_compatible(29653).await {
            tracing::info!("Port 29653 is occupied by a compatible healthy sidecar, reusing it");
            on_progress(
                "reuse",
                "Existing process on port 29653 passed health and API compatibility checks, reusing it".to_string(),
            );
            return Err(SidecarStartupFailure::new(
                "reuse",
                "sidecar_already_running",
                "Compatible healthy sidecar already running on port 29653",
            ));
        }

        let owners = describe_port_29653_owners();
        tracing::warn!(
            "Port 29653 has a healthy but API-incompatible sidecar: {}",
            owners
        );
        on_progress(
            "reuse",
            format!("Existing process on port 29653 is healthy but API-incompatible: {owners}"),
        );
        if restart_incompatible_internshannon_sidecar(on_progress).await {
            on_progress(
                "reuse",
                "Incompatible existing InternShannon sidecar stopped; starting bundled sidecar"
                    .to_string(),
            );
            return Ok(());
        }

        return Err(SidecarStartupFailure::new(
            "reuse",
            "sidecar_incompatible",
            format!(
                "Port 29653 is occupied by a healthy but API-incompatible process ({owners}). Quit the old internShannon app or stop that process, then retry."
            ),
        ));
    }

    let owners = describe_port_29653_owners();
    tracing::warn!(
        "Port 29653 is occupied by a process that did not pass /api/v1/health: {}",
        owners
    );
    on_progress(
        "port-check",
        format!("Port 29653 is occupied but not healthy: {owners}"),
    );

    Err(SidecarStartupFailure::new(
        "port-check",
        "gateway_port_occupied",
        format!(
            "Port 29653 is occupied by a process that did not pass /api/v1/health ({owners}). Stop that process or free the port, then retry."
        ),
    ))
}

/// Start the InternShannon API sidecar process.
pub async fn start_sidecar_with_progress<F>(
    mut on_progress: F,
) -> Result<Option<ManagedSidecarProcess>, SidecarStartupFailure>
where
    F: FnMut(&'static str, String) + Send,
{
    tracing::info!("start_sidecar() called - getting sidecar script...");
    on_progress("path", "Resolving sidecar script".to_string());
    let script_path = get_sidecar_script()?;
    on_progress(
        "path",
        format!("Using sidecar script {}", script_path.display()),
    );
    tracing::info!("Sidecar script path: {:?}", script_path);
    let node_exe = get_node_executable()?;
    on_progress("spawn", format!("Using Node executable {node_exe}"));
    let sidecar_cwd = script_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let node_env = if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    };
    on_progress(
        "spawn",
        format!(
            "Using sidecar cwd {} with NODE_ENV={node_env}",
            sidecar_cwd.display()
        ),
    );

    tracing::info!(
        "Starting InternShannon API sidecar: {} {} (cwd {})",
        node_exe,
        script_path.display(),
        sidecar_cwd.display()
    );

    // Ensure port is usable (reuse a healthy sidecar or surface the owner).
    match ensure_port_available(&mut on_progress).await {
        Ok(()) => {
            // Port was free, proceed to spawn
        }
        Err(e) if e.code == "sidecar_already_running" => {
            // Healthy sidecar exists, reuse it
            return Ok(None);
        }
        Err(e) => {
            return Err(e);
        }
    }

    // Spawn the sidecar process with node
    let stdout_log_path = sidecar_log_path("stdout");
    let stderr_log_path = sidecar_log_path("stderr");
    let stdout_log = open_sidecar_log(&stdout_log_path)?;
    let stderr_log = open_sidecar_log(&stderr_log_path)?;

    let child: Child = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;

            Command::new(&node_exe)
                .arg(&script_path)
                .current_dir(&sidecar_cwd)
                .env("APP_PORT", "29653")
                .env("APP_HOST", "127.0.0.1")
                .env("APP_MODE", "desktop")
                .env("KERNEL_WORKSPACE_STORAGE_PROVIDER", "local")
                .env("NODE_ENV", node_env)
                .env("APP_VERSION", env!("CARGO_PKG_VERSION"))
                .env("RUST_LOG", "info")
                .stdout(stdout_log)
                .stderr(stderr_log)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| {
                    SidecarStartupFailure::new("spawn", "sidecar_spawn_failed", e.to_string())
                })?
        }

        #[cfg(not(target_os = "windows"))]
        {
            Command::new(&node_exe)
                .arg(&script_path)
                .current_dir(&sidecar_cwd)
                .env("APP_PORT", "29653")
                .env("APP_HOST", "127.0.0.1")
                .env("APP_MODE", "desktop")
                .env("KERNEL_WORKSPACE_STORAGE_PROVIDER", "local")
                .env("NODE_ENV", node_env)
                .env("APP_VERSION", env!("CARGO_PKG_VERSION"))
                .env("RUST_LOG", "info")
                .stdout(stdout_log)
                .stderr(stderr_log)
                .spawn()
                .map_err(|e| {
                    SidecarStartupFailure::new("spawn", "sidecar_spawn_failed", e.to_string())
                })?
        }
    };

    tracing::info!(
        "InternShannon API sidecar spawned: pid={} node {} on port 29653",
        child.id(),
        script_path.display()
    );
    on_progress(
        "spawn",
        format!("Sidecar process spawned: pid={}", child.id()),
    );
    on_progress(
        "spawn",
        format!(
            "Sidecar logs: stderr={}, stdout={}",
            stderr_log_path.display(),
            stdout_log_path.display()
        ),
    );

    let ready_attempts = sidecar_ready_attempts();
    tracing::info!(
        "Waiting for InternShannon API sidecar health for up to {} seconds",
        ready_attempts
    );

    let mut process = ManagedSidecarProcess {
        child,
        stdout_log_path,
        stderr_log_path,
    };

    wait_for_sidecar(29653, ready_attempts, &mut process, &mut on_progress).await?;

    tracing::info!("InternShannon API sidecar is ready");
    on_progress(
        "health_check",
        "Sidecar /api/v1/health is ready".to_string(),
    );

    Ok(Some(process))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_node_from_explicit_path_candidate() {
        let dir =
            std::env::temp_dir().join(format!("internshannon-node-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let node = dir.join("node");
        fs::write(&node, "").expect("write fake node");

        assert_eq!(
            executable_file(&node),
            Some(node.to_string_lossy().to_string())
        );

        fs::remove_file(&node).ok();
        fs::remove_dir(&dir).ok();
    }

    #[test]
    fn ignores_missing_explicit_path_candidate() {
        let missing =
            std::env::temp_dir().join(format!("internshannon-missing-node-{}", std::process::id()));

        assert_eq!(executable_file(&missing), None);
    }

    #[test]
    fn resolves_node_from_bundled_resource_dir() {
        let dir = std::env::temp_dir().join(format!(
            "internshannon-bundled-node-test-{}",
            std::process::id()
        ));
        let node = bundled_node_candidate(&dir);
        fs::create_dir_all(node.parent().expect("node parent")).expect("create fake node dir");
        fs::write(&node, "").expect("write fake node");

        assert_eq!(
            node_from_bundled_resource_dir(&dir),
            Some(node.to_string_lossy().to_string())
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn bundled_sidecar_script_uses_js_entrypoint() {
        let script =
            bundled_sidecar_script(Path::new(r"C:\Users\15536\AppData\Local\InternShannon"));

        assert_eq!(
            script.file_name().and_then(|value| value.to_str()),
            Some("main.js")
        );
        assert!(!script.to_string_lossy().ends_with("main.js.exe"));
    }

    #[test]
    fn recognizes_bundled_internshannon_sidecar_commands() {
        assert!(is_internshannon_sidecar_command(
            "/Applications/internShannon.app/Contents/Resources/node/bin/node /Applications/internShannon.app/Contents/Resources/main.js"
        ));
        assert!(is_internshannon_sidecar_command(
            "/repo/apps/desktop/node /repo/apps/sidecar/dist/main.js"
        ));
        assert!(!is_internshannon_sidecar_command(
            "/usr/local/bin/node /other/project/main.js"
        ));
    }

    #[test]
    fn treats_model_fetch_route_404_as_incompatible() {
        assert!(!model_fetch_route_compatible_status(
            reqwest::StatusCode::NOT_FOUND
        ));
        assert!(!model_fetch_route_compatible_status(
            reqwest::StatusCode::METHOD_NOT_ALLOWED
        ));
        assert!(model_fetch_route_compatible_status(
            reqwest::StatusCode::BAD_REQUEST
        ));
        assert!(model_fetch_route_compatible_status(
            reqwest::StatusCode::UNAUTHORIZED
        ));
    }

    #[test]
    fn treats_missing_knowledge_route_as_incompatible() {
        assert!(knowledge_route_compatible_status(reqwest::StatusCode::OK));
        assert!(!knowledge_route_compatible_status(
            reqwest::StatusCode::NOT_FOUND
        ));
        assert!(!knowledge_route_compatible_status(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert!(!knowledge_route_compatible_status(
            reqwest::StatusCode::UNAUTHORIZED
        ));
    }
}

/// Wait for the sidecar HTTP server to be ready.
async fn wait_for_sidecar(
    port: u16,
    max_attempts: usize,
    process: &mut ManagedSidecarProcess,
    on_progress: &mut impl FnMut(&'static str, String),
) -> Result<(), SidecarStartupFailure> {
    for attempt in 0..max_attempts {
        if let Some(status) = process.child.try_wait().map_err(|error| {
            SidecarStartupFailure::new(
                "health_check",
                "sidecar_process_probe_failed",
                format!("Failed to inspect sidecar process: {error}"),
            )
        })? {
            return Err(SidecarStartupFailure::new(
                "process",
                "sidecar_exited",
                format!(
                    "Sidecar process exited before becoming ready: status={status}, attempt={}{}",
                    attempt + 1,
                    sidecar_exit_details(process)
                ),
            ));
        }

        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|error| {
                SidecarStartupFailure::new(
                    "health_check",
                    "health_client_failed",
                    format!("Failed to build health check client: {error}"),
                )
            })?;

        match client
            .get(format!("http://127.0.0.1:{}/api/v1/health", port))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                on_progress(
                    "health_check",
                    format!("/api/v1/health returned {}", response.status()),
                );
                return Ok(());
            }
            Ok(response) => {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .map(|value| truncate_for_log(&value, 500))
                    .unwrap_or_else(|error| format!("failed to read response body: {error}"));
                on_progress(
                    "health_check",
                    format!(
                        "/api/v1/health returned {} on attempt {}/{}: {}",
                        status,
                        attempt + 1,
                        max_attempts,
                        body
                    ),
                );
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
            Err(error) => {
                on_progress(
                    "health_check",
                    format!(
                        "/api/v1/health failed on attempt {}/{}: {}",
                        attempt + 1,
                        max_attempts,
                        error
                    ),
                );
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }

    Err(SidecarStartupFailure::new(
        "health_check",
        "sidecar_not_ready",
        format!(
            "Sidecar did not become ready after {} attempts",
            max_attempts
        ),
    ))
}

/// Check if a port is in use.
fn is_port_in_use(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    std::net::TcpListener::bind(&addr[..]).is_err()
}
