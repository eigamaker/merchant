<#
.SYNOPSIS
    Compiles and runs the engine-free Merchan.Domain tests without opening Unity.

.DESCRIPTION
    Merchan.Domain has noEngineReferences, so its sources and its EditMode tests
    compile against plain .NET. That makes this loop usable while the Unity
    editor is open and holding the Library lock.

    The domain assembly is compiled against Unity's netstandard 2.1 reference
    assembly, which is the same surface Unity compiles it against, so an API
    that only exists in .NET 8 fails here rather than later in the editor.

    This is a fast pre-check, not a replacement: run scripts/unity-tests.ps1
    before considering a change verified.

.EXAMPLE
    ./scripts/domain-tests.ps1
#>
[CmdletBinding()]
param(
    [string]$UnityVersion = "6000.3.9f1"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$editorData = Join-Path "C:\Program Files\Unity\Hub\Editor" (Join-Path $UnityVersion "Editor\Data")
if (-not (Test-Path $editorData)) {
    throw "Unity $UnityVersion was not found at $editorData. Install it from Unity Hub or pass -UnityVersion."
}

$csc = Join-Path $editorData "DotNetSdkRoslyn\csc.dll"
$netstandardRef = Join-Path $editorData "NetStandard\ref\2.1.0\netstandard.dll"
$nunit = Join-Path $editorData "Resources\PackageManager\BuiltInPackages\com.unity.ext.nunit\net40\unity-custom\nunit.framework.dll"
foreach ($required in @($csc, $netstandardRef, $nunit)) {
    if (-not (Test-Path $required)) { throw "Missing Unity component: $required" }
}

# The netcorerun folder is a complete .NET 6 runtime. Compiling the test host
# against its implementation assemblies means the produced dll runs on the
# installed dotnet runtime with no SDK and no NuGet restore.
$runtimeRefs = Get-ChildItem (Join-Path $editorData "netcorerun") -Filter "*.dll" |
    Where-Object { $_.Name -match '^(System\.|mscorlib|netstandard|Microsoft\.CSharp|Microsoft\.Win32)' -and $_.Name -notmatch 'Native' } |
    ForEach-Object { "/r:`"$($_.FullName)`"" }

$outDir = Join-Path $repoRoot "Unity\Logs\domain-tests"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir | Out-Null

function Invoke-Csc {
    param([string]$Label, [string[]]$Arguments)

    $output = & dotnet $csc /nologo @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "$Label failed to compile:" -ForegroundColor Red
        $output | ForEach-Object { Write-Host "  $_" }
        exit 1
    }
    $output | Where-Object { $_ -match 'warning CS' } | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
}

$domainSources = Get-ChildItem (Join-Path $repoRoot "Unity\Assets\Scripts\Domain") -Recurse -Filter "*.cs" | ForEach-Object { "`"$($_.FullName)`"" }
$testSources = Get-ChildItem (Join-Path $repoRoot "Unity\Assets\Tests\EditMode") -Recurse -Filter "*.cs" | ForEach-Object { "`"$($_.FullName)`"" }
if (-not $domainSources) { throw "No domain sources found." }
if (-not $testSources) { throw "No EditMode test sources found." }

$domainDll = Join-Path $outDir "Merchan.Domain.dll"
# The name matters: Merchan.Domain grants InternalsVisibleTo to exactly this
# assembly name, so the tests must build under it here as well as in Unity.
$testsDll = Join-Path $outDir "Merchan.Domain.Tests.dll"
$hostDll = Join-Path $outDir "DomainTestRunner.dll"

Write-Host "Compiling Merchan.Domain ($($domainSources.Count) files) against netstandard2.1"
Invoke-Csc "Merchan.Domain" (@("/target:library", "/nostdlib+", "/langversion:9.0", "/out:`"$domainDll`"", "/r:`"$netstandardRef`"") + $domainSources)

Write-Host "Compiling Merchan.Domain.Tests ($($testSources.Count) files)"
Invoke-Csc "Merchan.Domain.Tests" (@("/target:library", "/nostdlib+", "/langversion:9.0", "/out:`"$testsDll`"", "/r:`"$nunit`"", "/r:`"$domainDll`"") + $runtimeRefs + $testSources)

Invoke-Csc "DomainTestRunner" (@("/target:exe", "/nostdlib+", "/langversion:9.0", "/out:`"$hostDll`"", "/r:`"$nunit`"", "/r:`"$testsDll`"") + $runtimeRefs + @("`"$(Join-Path $PSScriptRoot 'DomainTestRunner.cs')`""))

Copy-Item $nunit $outDir -Force
@'
{"runtimeOptions":{"tfm":"net6.0","framework":{"name":"Microsoft.NETCore.App","version":"6.0.0"},"rollForward":"LatestMajor"}}
'@ | Set-Content -Encoding utf8 (Join-Path $outDir "DomainTestRunner.runtimeconfig.json")

Write-Host ""
& dotnet $hostDll $testsDll
exit $LASTEXITCODE
