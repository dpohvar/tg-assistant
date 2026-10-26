param(
  [string]$SourceArchive = 'C:\Users\dpohvar\Downloads\Telegram Desktop\wordle.zip'
)

$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$source = Join-Path $repo 'examples\widgets\wordle'
$stage = Join-Path $repo '.temp\react-wordle-package'
$verify = Join-Path $repo '.temp\react-wordle-package-verify'
$dist = Join-Path $repo 'dist\wordle-react.zip'
$expectedSourceHash = '53D0690DF1B0BA9522073134903A60B9A42C2EEDE7F973AFBDFF579F41CCF88B'

foreach ($path in @($source,$stage,$verify,$dist)) {
  $full = [System.IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside worktree: $full" }
}
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'Wordle source directory missing.' }
if (Test-Path -LiteralPath $SourceArchive -PathType Leaf) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $SourceArchive).Hash
  if ($actual -ne $expectedSourceHash) { throw 'Supplied wordle.zip no longer matches the accepted source.' }
}
foreach ($path in @($stage,$verify)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'widgets') | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $stage 'widgets\wordle') -Recurse
$entries = @(Get-ChildItem -LiteralPath (Join-Path $stage 'widgets\wordle') -File -Recurse |
  Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
    [ordered]@{ path=$relative; bytes=$_.Length; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
  })
$manifest = [ordered]@{
  format = 'tg-assistant-react-wordle-v1'
  sourceArchiveSha256 = $expectedSourceHash.ToLowerInvariant()
  entries = $entries
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dist) | Out-Null
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $dist -Force
Expand-Archive -LiteralPath $dist -DestinationPath $verify
foreach ($entry in $entries) {
  $file = Join-Path $verify ($entry.path.Replace('/','\'))
  if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
      (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -ne $entry.sha256) {
    throw "Package verification failed: $($entry.path)"
  }
}
Write-Output "Verified $($entries.Count) files in $dist"
