<#
.SYNOPSIS
    Runs the Merchan EditMode test suite in a headless Unity editor.

.DESCRIPTION
    Unity must not already have the project open: the editor takes an exclusive
    lock on Library/, and a second instance fails with a lock error.

    Exit code 0 means every test passed. Any other code leaves the NUnit result
    XML and the editor log in place for inspection.

.EXAMPLE
    ./scripts/unity-tests.ps1
    ./scripts/unity-tests.ps1 -TestPlatform PlayMode
    ./scripts/unity-tests.ps1 -CompileOnly
#>
[CmdletBinding()]
param(
    [string]$UnityVersion = "6000.3.9f1",
    [ValidateSet("EditMode", "PlayMode")]
    [string]$TestPlatform = "EditMode",
    [string]$TestFilter = "",
    # Imports and compiles the project without running tests. Useful right after
    # a package or asmdef change, when a compile error would otherwise be
    # reported as a confusing test-runner failure.
    [switch]$CompileOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $repoRoot "Unity"
$unityExe = Join-Path "C:\Program Files\Unity\Hub\Editor" (Join-Path $UnityVersion "Editor\Unity.exe")

if (-not (Test-Path $unityExe)) {
    throw "Unity $UnityVersion was not found at $unityExe. Install it from Unity Hub or pass -UnityVersion."
}

$artifacts = Join-Path $projectPath "Logs"
if (-not (Test-Path $artifacts)) { New-Item -ItemType Directory -Path $artifacts | Out-Null }

$logFile = Join-Path $artifacts "unity-$($TestPlatform.ToLower()).log"
$resultFile = Join-Path $artifacts "test-results-$($TestPlatform.ToLower()).xml"
foreach ($stale in @($logFile, $resultFile)) {
    if (Test-Path $stale) { Remove-Item $stale -Force }
}

$unityArgs = @(
    "-batchmode",
    "-nographics",
    "-projectPath", $projectPath,
    "-logFile", $logFile
)

if ($CompileOnly) {
    $unityArgs += @("-quit")
} else {
    $unityArgs += @(
        "-runTests",
        "-testPlatform", $TestPlatform,
        "-testResults", $resultFile
    )
    if ($TestFilter) { $unityArgs += @("-testFilter", $TestFilter) }
}

Write-Host "Unity $UnityVersion : $(if ($CompileOnly) { 'compile only' } else { "$TestPlatform tests" })"
$process = Start-Process -FilePath $unityExe -ArgumentList $unityArgs -PassThru -Wait -NoNewWindow
$exitCode = $process.ExitCode

# Compile errors are the common failure and are easy to miss in a 10k-line log,
# so surface them before the pass/fail summary.
if (Test-Path $logFile) {
    $compileErrors = Select-String -Path $logFile -Pattern "error CS\d+" -ErrorAction SilentlyContinue
    if ($compileErrors) {
        Write-Host ""
        Write-Host "Compile errors:" -ForegroundColor Red
        $compileErrors | Select-Object -First 40 | ForEach-Object { Write-Host "  $($_.Line.Trim())" }
    }
}

if (-not $CompileOnly -and (Test-Path $resultFile)) {
    [xml]$results = Get-Content $resultFile
    $run = $results.'test-run'
    Write-Host ""
    Write-Host "total=$($run.total) passed=$($run.passed) failed=$($run.failed) skipped=$($run.skipped) duration=$($run.duration)s"

    if ([int]$run.failed -gt 0) {
        $results.SelectNodes("//test-case[@result='Failed']") | ForEach-Object {
            Write-Host ""
            Write-Host "FAILED $($_.fullname)" -ForegroundColor Red
            Write-Host "  $($_.failure.message.'#cdata-section')".Trim()
        }
    }
}

Write-Host ""
Write-Host "log:     $logFile"
if (-not $CompileOnly) { Write-Host "results: $resultFile" }
exit $exitCode
