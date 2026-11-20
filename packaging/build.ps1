# Build a current-user x64 MSI with the system .NET Framework C# compiler and WiX.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$WorkDirectory=(Join-Path ([IO.Path]::GetTempPath()) 'pivot-packaging'),
  [switch]$HostOnly,
  [switch]$UseExistingFrontend
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version=(Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json).version
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'The Windows installer requires a major.minor.patch version.'}
$cache=[IO.Path]::GetFullPath($WorkDirectory)
$build=Join-Path $cache ('build-'+[Guid]::NewGuid().ToString('N').Substring(0,10))
$out=[IO.Path]::GetFullPath($OutputDirectory)
$payload=Join-Path $build 'payload'
New-Item -ItemType Directory -Path $cache,$build,$payload,$out -Force | Out-Null
function Package([string]$name,[string]$url,[string]$sha) {
  $zip=Join-Path $cache ($name+'.zip')
  if(!(Test-Path $zip)) {
    $tmp=$zip+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    curl.exe -fsSL --retry 2 $url -o $tmp
    if($LASTEXITCODE -ne 0 -or (Get-FileHash $tmp).Hash.ToLowerInvariant() -ne $sha){throw "Download verification failed for $name"}
    Move-Item -LiteralPath $tmp -Destination $zip
  }
  if((Get-FileHash $zip).Hash.ToLowerInvariant() -ne $sha){throw "Cached package checksum mismatch for $name"}
  $expanded=Join-Path $build $name
  Expand-Archive -LiteralPath $zip -DestinationPath $expanded
  return $expanded
}
$sdk=Package 'webview2-1.0.4314.35' 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4314.35/microsoft.web.webview2.1.0.4314.35.nupkg' '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4'
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(!(Test-Path $csc)){throw 'Install .NET Framework 4.8. This build targets Windows x64.'}
$hostDir=if($HostOnly){$out}else{$payload}
$wvCore=Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'
$wvForms=Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'
Copy-Item -LiteralPath $wvCore,$wvForms,(Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $hostDir
$notices=Join-Path $hostDir 'licenses'
New-Item -ItemType Directory -Force $notices | Out-Null
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $notices 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $sdk 'NOTICE.txt') -Destination (Join-Path $notices 'WebView2-NOTICE.txt')
& (Join-Path $PSScriptRoot 'icon.ps1') -Destination (Join-Path $hostDir 'pivot.ico')
$exe=Join-Path $hostDir 'Pivot.exe'
$source=(Resolve-Path -LiteralPath (Join-Path $repo 'desktop/Pivot.cs')).Path
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$exe" "/win32icon:$hostDir/pivot.ico" "/win32manifest:$repo/desktop/app.manifest" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Xml.Linq.dll "/r:$wvCore" "/r:$wvForms" $source
if($LASTEXITCODE -ne 0){throw 'Desktop host compilation failed.'}
if($HostOnly){Write-Output $exe;return}

Push-Location $repo
try {
  if(!$UseExistingFrontend) {
    npm.cmd run build
    if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'}
  }
  if(!(Test-Path dist/index.html)){throw 'Missing frontend build.'}
  if(!(Test-Path '.pivot/bin/nvim-win64/bin/nvim.exe') -or !(Test-Path '.pivot/editor/ready')) {
    & (Join-Path $repo 'desktop/setup-integrations.ps1') -EditorOnly -PortableEditor
  }
  $nodePkg=Package 'node-24.18.0-win-x64' 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip' '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
  $nodeRoot=Join-Path $nodePkg 'node-v24.18.0-win-x64'
  Copy-Item (Join-Path $nodeRoot 'node.exe') $payload
  Copy-Item (Join-Path $nodeRoot 'LICENSE') (Join-Path $notices 'Node-LICENSE.txt')
  $bundle=Join-Path $payload 'app'
  New-Item -ItemType Directory $bundle | Out-Null
  # Explicit runtime directories. Exclude source worktrees, junctions, private tools and caches.
  $runtimeDirs=@('server','scripts','simulator','editor','examples','desktop','sdk','telemetry','python','shared','client/src')
  foreach($dir in $runtimeDirs) {
    if(!(Test-Path -LiteralPath $dir)){continue}
    # Package intentional source files only; never follow ignored user working data or runtime junctions.
    $files=git -c core.quotepath=false ls-files -co --exclude-standard -- $dir
    foreach($file in $files) {
      if(!(Test-Path -LiteralPath $file -PathType Leaf)){continue}
      if($file -match '(^|/)(__pycache__|node_modules|\.pivot|\.venv)(/|$)' -or $file -match '\.(pyc|log)$'){continue}
      $target=Join-Path $bundle $file
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      Copy-Item -LiteralPath $file -Destination $target
    }
  }
  Copy-Item -LiteralPath 'dist' -Destination $bundle -Recurse
  Copy-Item -LiteralPath 'package.json','package-lock.json','LICENSE','README.md','THIRD_PARTY.md' -Destination $bundle
  $portable=Join-Path $bundle '.pivot'
  New-Item -ItemType Directory -Path (Join-Path $portable 'bin'),(Join-Path $portable 'editor') -Force | Out-Null
  Copy-Item -LiteralPath '.pivot/bin/nvim-win64' -Destination (Join-Path $portable 'bin') -Recurse
  $editorBundle=Join-Path $portable 'editor'
  $pluginSource=(Resolve-Path -LiteralPath '.pivot/editor/plugins').Path
  # Plugin test fixtures can exceed Windows Installer's path limit.
  robocopy.exe $pluginSource (Join-Path $editorBundle 'plugins') /E /XJ /MT:8 /R:1 /W:1 /XD .git .github test tests /NFL /NDL /NJH /NJS /NP
  if($LASTEXITCODE -ge 8){throw 'Locked editor plugins could not be staged.'}
  foreach($entry in @('ready','lazy-lock.json')) {
    Copy-Item -LiteralPath (Join-Path '.pivot/editor' $entry) -Destination $editorBundle
  }
  $docs=Join-Path $bundle 'docs'
  New-Item -ItemType Directory -Force $docs | Out-Null
  Copy-Item -LiteralPath 'docs/DESKTOP.md','docs/PROJECTS.md','docs/LAZYVIM.md' -Destination $docs
  npm.cmd ci --prefix $bundle --omit=dev --ignore-scripts --no-fund --no-audit
  if($LASTEXITCODE -ne 0){throw 'Production dependency restore failed.'}
  $pty=Join-Path $bundle 'node_modules/node-pty'
  if(!(Test-Path "$pty/prebuilds/win32-x64/conpty.node")){throw 'Missing Windows x64 PTY binaries.'}
  # ConPTY DLL lookup uses build/Release; stage only the packaged x64 redistributables.
  $conpty=Join-Path $pty 'build/Release/conpty'
  New-Item -ItemType Directory -Force $conpty | Out-Null
  Copy-Item "$pty/prebuilds/win32-x64/conpty/*" $conpty
  Copy-Item -LiteralPath "$pty/deps/winpty/LICENSE" -Destination "$notices/winpty-LICENSE.txt"
  $bundleRoot=(Resolve-Path -LiteralPath $bundle).Path+[IO.Path]::DirectorySeparatorChar
  foreach($item in @('deps','third_party','src','prebuilds/darwin-x64','prebuilds/darwin-arm64','prebuilds/win32-arm64')) {
    $candidate=Join-Path $pty $item
    if(!(Test-Path -LiteralPath $candidate)){continue}
    $abs=(Resolve-Path -LiteralPath $candidate).Path
    if(!$abs.StartsWith($bundleRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected staging path.'}
    Remove-Item -LiteralPath $abs -Recurse -Force
  }
  Get-ChildItem -LiteralPath "$pty/prebuilds/win32-x64" -Filter '*.pdb' -File | ForEach-Object {Remove-Item -LiteralPath $_.FullName -Force}
  $wix=Package 'wix-4.0.6' 'https://api.nuget.org/v3-flatcontainer/wix/4.0.6/wix.4.0.6.nupkg' 'a94dd42ae1fb56b32da180e2173ceda4f0d10b4c8871c5ee59ecb502131a1eb6'
  $wxs=Join-Path $build 'package.wxs'
  & "$payload/node.exe" "$PSScriptRoot/manifest.mjs" $payload $wxs
  if($LASTEXITCODE -ne 0){throw 'MSI manifest generation failed.'}
  $msi=Join-Path $out "Pivot-$version-windows-x64.msi"
  & dotnet "$wix/tools/net6.0/any/wix.dll" build -arch x64 -intermediateFolder "$build/obj" -o $msi $wxs
  if($LASTEXITCODE -ne 0){throw 'MSI build failed.'}
  $debugDB=[IO.Path]::ChangeExtension($msi,'.wixpdb')
  if(Test-Path -LiteralPath $debugDB){Move-Item -LiteralPath $debugDB -Destination $build}
  Write-Output "Windows installer: $msi"
  (Get-FileHash -LiteralPath $msi).Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($msi) | Set-Content -Encoding ascii ($msi+'.sha256')
} finally {Pop-Location}
