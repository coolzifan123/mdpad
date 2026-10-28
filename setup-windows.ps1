# MdPad setup for Windows
#
# Installs the tools MdPad needs (Microsoft C++ Build Tools, WebView2,
# Node.js, Rust) with winget, installs the npm packages, then offers to start
# the app or to build and install it. Anything already installed is skipped,
# so it is safe to run again.
#
# Easiest: double-click setup.cmd. Or, from PowerShell in this folder:
#   powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
#
# Keep this file ASCII-only: Windows PowerShell 5.1 misreads other characters.

$ErrorActionPreference = 'Continue'

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host "    $Text" -ForegroundColor Green
}

function Stop-Setup([string]$Text) {
    Write-Host ''
    Write-Host "ERROR: $Text" -ForegroundColor Red
    exit 1
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Installers update PATH in the registry; reload it so this window sees them.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin"
}

function Install-WithWinget([string]$Id, [string[]]$ExtraArgs = @()) {
    Write-Host "    Installing $Id with winget..."
    & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements @ExtraArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    winget exited with code $LASTEXITCODE. Checking whether it worked anyway..." -ForegroundColor Yellow
    }
    Update-SessionPath
}

# --- Project folder ----------------------------------------------------------

$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) {
    # The source zip contains an "mdpad" folder; allow the script one level up.
    $nested = Join-Path $root 'mdpad'
    if (Test-Path (Join-Path $nested 'package.json')) {
        $root = $nested
    } else {
        Stop-Setup 'package.json not found. Put setup.cmd and setup-windows.ps1 in the MdPad folder, next to package.json.'
    }
}
Set-Location $root
Write-Host "MdPad setup. Project folder: $root"

if (-not (Test-Command 'winget')) {
    Stop-Setup "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again."
}

# --- 1. Microsoft C++ Build Tools (Rust needs them on Windows) ---------------

Write-Step '1/5  Microsoft C++ Build Tools'
$cppComponent = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    $cppComponent = 'Microsoft.VisualStudio.Component.VC.Tools.ARM64'
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'

function Test-CppTools {
    if (-not (Test-Path $vswhere)) { return $false }
    $paths = & $vswhere -products * -requires $cppComponent -property installationPath
    return [bool]$paths
}

if (Test-CppTools) {
    Write-Ok 'Already installed.'
} else {
    Write-Host '    This is a large download (a few GB) and can take 10-30 minutes.'
    Write-Host '    Click "Yes" if Windows asks for permission.'
    Install-WithWinget 'Microsoft.VisualStudio.2022.BuildTools' @(
        '--override',
        "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add $cppComponent --includeRecommended"
    )
    if (-not (Test-CppTools)) {
        Stop-Setup 'The C++ Build Tools did not install. Install "Desktop development with C++" from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and run this again.'
    }
    Write-Ok 'Installed.'
}

# --- 2. WebView2 (the browser engine inside MdPad's window) ------------------

Write-Step '2/5  Microsoft Edge WebView2'
$webview2Id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$webview2Keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webview2Id",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webview2Id",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$webview2Id"
)
if (@($webview2Keys | Where-Object { Test-Path $_ }).Count -gt 0) {
    Write-Ok 'Already installed.'
} else {
    Install-WithWinget 'Microsoft.EdgeWebView2Runtime'
}

# --- 3. Node.js (builds the editor's user interface) -------------------------

Write-Step '3/5  Node.js'

function Get-NodeVersion {
    if (-not (Test-Command 'node')) { return $null }
    $text = (& node --version) -replace '^v', ''
    try { return [version]$text } catch { return $null }
}

# Vite needs Node.js 20.19+ or 22.12+.
function Test-NodeVersion {
    $v = Get-NodeVersion
    if ($null -eq $v) { return $false }
    return ($v.Major -eq 20 -and $v.Minor -ge 19) -or ($v.Major -eq 22 -and $v.Minor -ge 12) -or ($v.Major -ge 23)
}

if (Test-NodeVersion) {
    Write-Ok "Node.js $(Get-NodeVersion) is installed."
} else {
    Install-WithWinget 'OpenJS.NodeJS.LTS'
    if (-not (Test-NodeVersion)) {
        Stop-Setup 'Node.js 22 or newer is needed. Install the LTS version from https://nodejs.org and run this again.'
    }
    Write-Ok "Installed Node.js $(Get-NodeVersion)."
}

# --- 4. Rust (compiles MdPad's native part) ----------------------------------

Write-Step '4/5  Rust'
if (-not (Test-Command 'rustup')) {
    Install-WithWinget 'Rustlang.Rustup'
    if (-not (Test-Command 'rustup')) {
        Stop-Setup 'Rust did not install. Install it from https://rustup.rs and run this again.'
    }
}
# A fresh rustup may not have a toolchain selected yet.
& rustc --version *> $null
if ($LASTEXITCODE -ne 0) {
    & rustup default stable
    & rustc --version *> $null
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup 'Rust is installed but not working. Run "rustup default stable" and try again.'
    }
}
Write-Ok "$(& rustc --version)"

# --- 5. npm packages ---------------------------------------------------------

Write-Step '5/5  npm packages'
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
    Stop-Setup 'npm install failed. See the messages above.'
}
Write-Ok 'Done.'

# --- Next step ---------------------------------------------------------------

Write-Host ''
Write-Host 'Setup is complete.' -ForegroundColor Green
Write-Host ''
Write-Host '  1) Start MdPad now (development mode: code changes reload instantly)'
Write-Host '  2) Build the installer and install MdPad like a normal app'
Write-Host '  3) Exit'
Write-Host ''
Write-Host 'The first start or build compiles the Rust code and takes several minutes.'
$choice = Read-Host 'Type 1, 2 or 3 and press Enter'

switch ($choice) {
    '1' {
        & npx.cmd tauri dev
    }
    '2' {
        # NSIS makes a setup .exe; the MSI format has extra requirements.
        & npx.cmd tauri build --bundles nsis
        if ($LASTEXITCODE -ne 0) {
            Stop-Setup 'The build failed. See the messages above.'
        }
        $installer = Get-ChildItem -Path 'src-tauri\target\release\bundle\nsis' -Filter '*-setup.exe' |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($null -eq $installer) {
            Stop-Setup 'The build finished, but the installer was not found.'
        }
        Write-Ok "Installer: $($installer.FullName)"
        Start-Process -FilePath $installer.FullName
    }
    default {
        Write-Host 'Later, run "npm run tauri dev" in this folder to start MdPad.'
    }
}
