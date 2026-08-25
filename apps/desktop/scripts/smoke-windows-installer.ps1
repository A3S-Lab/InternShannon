[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Installer,

    [int]$HealthTimeoutSeconds = 150,
    [int]$CleanupTimeoutSeconds = 60,

    [switch]$AllowNonCi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProductName = "InternShannon"
$HealthPort = 29653
$HealthUrl = "http://127.0.0.1:$HealthPort/api/v1/health"
$UninstallRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$ProductName"
$DefaultInstallDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) $ProductName

function Wait-ForCondition {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Description,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) {
            return
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out after $TimeoutSeconds seconds waiting for $Description."
}

function Get-HealthListener {
    return Get-NetTCPConnection -LocalPort $HealthPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    if ($ProcessId -le 0 -or -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return
    }

    $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
    $result = Start-Process -FilePath $taskkill -ArgumentList @("/PID", $ProcessId, "/T", "/F") -Wait -PassThru -NoNewWindow
    if ($result.ExitCode -ne 0 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        throw "taskkill failed for process $ProcessId with exit code $($result.ExitCode)."
    }
}

function Invoke-SilentUninstall {
    param([string]$UninstallerPath)

    if (-not (Test-Path -LiteralPath $UninstallerPath -PathType Leaf)) {
        throw "Uninstaller is missing: $UninstallerPath"
    }

    $process = Start-Process -FilePath $UninstallerPath -ArgumentList "/S" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Uninstaller exited with code $($process.ExitCode)."
    }
}

function Normalize-DirectoryPath {
    param([string]$PathValue)

    return ([IO.Path]::GetFullPath($PathValue)).TrimEnd([char[]]@('\', '/'))
}

function Invoke-CleanupAction {
    param(
        [string]$Description,
        [scriptblock]$Action
    )

    try {
        & $Action
    } catch {
        $script:CleanupErrors.Add("${Description}: $($_.Exception.Message)")
    }
}

if ($env:GITHUB_ACTIONS -ne "true" -and -not $AllowNonCi) {
    throw "Installer smoke changes the current Windows profile. Run it in GitHub Actions or pass -AllowNonCi explicitly on an ephemeral Windows test machine."
}

$InstallerPath = (Resolve-Path -LiteralPath $Installer).Path
if (-not $InstallerPath.EndsWith("-setup.exe", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Expected a Tauri NSIS *-setup.exe, got: $InstallerPath"
}
if (Test-Path $UninstallRegistryPath) {
    throw "Refusing to overwrite an existing $ProductName installation registered at $UninstallRegistryPath."
}
if (Test-Path -LiteralPath $DefaultInstallDir) {
    throw "Refusing to overwrite an existing install directory: $DefaultInstallDir"
}
if (Get-HealthListener) {
    throw "Port $HealthPort is already in use before the installer smoke test."
}

$DefaultInstallDir = Normalize-DirectoryPath $DefaultInstallDir
$UserDataDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".internshannon"
$TauriRoamingDataDir = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "com.a3s.internshannon"
$TauriLocalDataDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "com.a3s.internshannon"
$OwnedProfileDirs = @($UserDataDir, $TauriRoamingDataDir, $TauriLocalDataDir)
foreach ($profileDir in $OwnedProfileDirs) {
    if (Test-Path -LiteralPath $profileDir) {
        throw "Refusing to run installer smoke with existing app data: $profileDir"
    }
}
$OwnerMarkerName = ".internshannon-installer-smoke-owner"
$OwnerMarkerToken = [Guid]::NewGuid().ToString("N")
$SmokeDataDir = Join-Path ([IO.Path]::GetTempPath()) "internshannon-windows-install-smoke.$([Guid]::NewGuid().ToString('N'))"
$HadPreviousDataDir = Test-Path Env:INTERNSHANNON_DATA_DIR
$PreviousDataDir = $env:INTERNSHANNON_DATA_DIR

$InstallerStarted = $false
$InstallDir = $DefaultInstallDir
$MainProcess = $null
$ListenerProcessId = $null
$UninstallerPath = Join-Path $InstallDir "uninstall.exe"
$PrimaryError = $null
$CleanupErrors = [Collections.Generic.List[string]]::new()

try {
    foreach ($profileDir in $OwnedProfileDirs) {
        New-Item -ItemType Directory -Path $profileDir | Out-Null
        Set-Content -LiteralPath (Join-Path $profileDir $OwnerMarkerName) -Value $OwnerMarkerToken -NoNewline
    }
    New-Item -ItemType Directory -Path $SmokeDataDir | Out-Null
    $env:INTERNSHANNON_DATA_DIR = $SmokeDataDir

    Write-Host "Installing $InstallerPath"
    $InstallerStarted = $true
    # NSIS requires /D to be the final argument and treats the remaining text as
    # the directory, including spaces.
    $installerArguments = "/S /NS /D=$DefaultInstallDir"
    $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList $installerArguments -Wait -PassThru
    if ($installerProcess.ExitCode -ne 0) {
        throw "Installer exited with code $($installerProcess.ExitCode)."
    }

    Wait-ForCondition -Description "the uninstall registry entry" -TimeoutSeconds 30 -Condition {
        Test-Path $UninstallRegistryPath
    }

    $installInfo = Get-ItemProperty -Path $UninstallRegistryPath
    $RawInstallDir = ([string]$installInfo.InstallLocation).Trim().Trim('"')
    $MainBinaryName = ([string]$installInfo.MainBinaryName).Trim()
    if ([string]::IsNullOrWhiteSpace($RawInstallDir) -or [string]::IsNullOrWhiteSpace($MainBinaryName)) {
        throw "Installer registry entry is missing InstallLocation or MainBinaryName."
    }
    $InstallDir = Normalize-DirectoryPath $RawInstallDir
    if (-not [string]::Equals($InstallDir, $DefaultInstallDir, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to inspect or uninstall an unexpected install directory. Expected $DefaultInstallDir, got $InstallDir."
    }

    $MainExecutable = Join-Path $InstallDir $MainBinaryName
    $UninstallerPath = Join-Path $InstallDir "uninstall.exe"
    $SidecarDir = if (Test-Path -LiteralPath (Join-Path $InstallDir "main.js") -PathType Leaf) {
        $InstallDir
    } else {
        Join-Path $InstallDir "sidecar"
    }
    $BundledNode = Join-Path $InstallDir "node\node.exe"

    foreach ($requiredFile in @($MainExecutable, $UninstallerPath, (Join-Path $SidecarDir "main.js"), $BundledNode)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Installed package is missing required file: $requiredFile"
        }
    }
    $SidecarNodeModules = Join-Path $SidecarDir "node_modules"
    if (-not (Test-Path -LiteralPath $SidecarNodeModules -PathType Container)) {
        throw "Installed package is missing standalone sidecar dependencies: $SidecarNodeModules"
    }

    Write-Host "Launching installed application: $MainExecutable"
    $MainProcess = Start-Process -FilePath $MainExecutable -PassThru
    Wait-ForCondition -Description "sidecar health at $HealthUrl" -TimeoutSeconds $HealthTimeoutSeconds -Condition {
        $MainProcess.Refresh()
        if ($MainProcess.HasExited) {
            throw "Installed application exited before sidecar health was ready with code $($MainProcess.ExitCode)."
        }
        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 2 -UseBasicParsing
            return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
        } catch {
            return $false
        }
    }
    $MainProcess.Refresh()
    if ($MainProcess.HasExited) {
        throw "Installed application exited after sidecar startup with code $($MainProcess.ExitCode)."
    }

    $listener = Get-HealthListener
    if (-not $listener) {
        throw "Health endpoint responded but no listener was found on port $HealthPort."
    }
    $ListenerProcessId = [int]$listener.OwningProcess
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ListenerProcessId"
    if (-not $listenerProcess -or [string]::IsNullOrWhiteSpace([string]$listenerProcess.ExecutablePath)) {
        throw "Could not resolve the executable for the port $HealthPort listener (PID $ListenerProcessId)."
    }

    $actualNode = [IO.Path]::GetFullPath([string]$listenerProcess.ExecutablePath)
    $expectedNode = [IO.Path]::GetFullPath($BundledNode)
    if (-not [string]::Equals($actualNode, $expectedNode, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Sidecar used unexpected Node.js executable. Expected $expectedNode, got $actualNode."
    }

    Write-Host "Installed application smoke OK: $HealthUrl; bundled Node PID $ListenerProcessId"
} catch {
    $PrimaryError = $_
} finally {
    Invoke-CleanupAction -Description "stop installed application process tree" -Action {
        if ($MainProcess) {
            $MainProcess.Refresh()
            if (-not $MainProcess.HasExited) {
                Stop-ProcessTree -ProcessId $MainProcess.Id
            }
        }
    }

    Invoke-CleanupAction -Description "stop installed sidecar listener" -Action {
        $currentListener = Get-HealthListener
        if (-not $currentListener) {
            return
        }
        $currentProcessId = [int]$currentListener.OwningProcess
        $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $currentProcessId"
        $expectedNode = Normalize-DirectoryPath (Join-Path $DefaultInstallDir "node\node.exe")
        $actualExecutable = if ($currentProcess) {
            [string]$currentProcess.ExecutablePath
        } else {
            ""
        }
        if ([string]::IsNullOrWhiteSpace($actualExecutable)) {
            throw "Could not resolve executable for remaining port $HealthPort listener (PID $currentProcessId)."
        }
        $actualExecutable = Normalize-DirectoryPath $actualExecutable
        if (-not [string]::Equals($actualExecutable, $expectedNode, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to stop unexpected port $HealthPort listener: $actualExecutable"
        }
        Stop-ProcessTree -ProcessId $currentProcessId
    }

    if ($InstallerStarted) {
        Invoke-CleanupAction -Description "wait for port $HealthPort to be released" -Action {
            Wait-ForCondition -Description "port $HealthPort to be released" -TimeoutSeconds $CleanupTimeoutSeconds -Condition {
                -not (Get-HealthListener)
            }
        }

        Invoke-CleanupAction -Description "uninstall $ProductName" -Action {
            $safeUninstaller = Join-Path $DefaultInstallDir "uninstall.exe"
            if (Test-Path -LiteralPath $safeUninstaller -PathType Leaf) {
                Write-Host "Uninstalling $ProductName from $DefaultInstallDir"
                Invoke-SilentUninstall -UninstallerPath $safeUninstaller
            } elseif (Test-Path -LiteralPath $DefaultInstallDir) {
                throw "Install directory exists but its uninstaller is missing: $safeUninstaller"
            }
        }

        Invoke-CleanupAction -Description "verify uninstall registry cleanup" -Action {
            Wait-ForCondition -Description "the uninstall registry entry to be removed" -TimeoutSeconds $CleanupTimeoutSeconds -Condition {
                -not (Test-Path $UninstallRegistryPath)
            }
        }

        Invoke-CleanupAction -Description "verify install directory cleanup" -Action {
            Wait-ForCondition -Description "the install directory to be removed" -TimeoutSeconds $CleanupTimeoutSeconds -Condition {
                -not (Test-Path -LiteralPath $DefaultInstallDir)
            }
        }
    }

    Invoke-CleanupAction -Description "remove isolated smoke data" -Action {
        if (Test-Path -LiteralPath $SmokeDataDir) {
            Remove-Item -LiteralPath $SmokeDataDir -Recurse -Force
        }
    }
    Invoke-CleanupAction -Description "remove profile data created by installer smoke" -Action {
        foreach ($profileDir in $OwnedProfileDirs) {
            if (-not (Test-Path -LiteralPath $profileDir)) {
                continue
            }
            $profileItem = Get-Item -LiteralPath $profileDir -Force
            if (($profileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to remove reparse-point app data directory: $profileDir"
            }
            $markerPath = Join-Path $profileDir $OwnerMarkerName
            if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
                throw "Refusing to remove app data without smoke ownership marker: $profileDir"
            }
            $markerValue = (Get-Content -LiteralPath $markerPath -Raw).Trim()
            if ($markerValue -ne $OwnerMarkerToken) {
                throw "Refusing to remove app data with an unexpected ownership marker: $profileDir"
            }
            Remove-Item -LiteralPath $profileDir -Recurse -Force
        }
    }
    if ($HadPreviousDataDir) {
        $env:INTERNSHANNON_DATA_DIR = $PreviousDataDir
    } else {
        Remove-Item Env:INTERNSHANNON_DATA_DIR -ErrorAction SilentlyContinue
    }
}

if ($PrimaryError) {
    if ($CleanupErrors.Count -gt 0) {
        throw "$($PrimaryError.Exception.Message)`nCleanup failures:`n- $($CleanupErrors -join "`n- ")"
    }
    throw $PrimaryError
}
if ($CleanupErrors.Count -gt 0) {
    throw "Installer smoke cleanup failed:`n- $($CleanupErrors -join "`n- ")"
}

Write-Host "Windows installer smoke and cleanup OK: $InstallerPath"
