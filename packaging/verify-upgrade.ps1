param([Parameter(Mandatory=$true)][string]$Installer)

$ErrorActionPreference='Stop'
$install=Join-Path $env:LOCALAPPDATA 'Programs/Pivot'
$profile=Join-Path $env:LOCALAPPDATA 'Pivot/user'
if ((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $profile)) {
  throw 'Run the installation check on a fresh Windows account.'
}
$workspace=Join-Path $profile 'projects/upgrade-check'
$version=(Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../package.json') | ConvertFrom-Json).version
$msi=(Get-Item -LiteralPath $Installer).FullName
$python=Join-Path $install 'app/.venv/Scripts/python.exe'
$expectedHash=((Get-Content -LiteralPath ($msi+'.sha256') -TotalCount 1) -split '\s+')[0]
if ((Get-FileHash -LiteralPath $msi).Hash -ine $expectedHash) { throw 'The candidate installer checksum did not match.' }
$windowsInstaller=New-Object -ComObject WindowsInstaller.Installer
$database=$windowsInstaller.OpenDatabase($msi,0)
$query=$database.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''UpgradeCode''')
$query.Execute()
$upgradeCode=$query.Fetch().StringData(1)
$query.Close()
$query=$database=$null

function Installed-PivotProducts {
  foreach ($product in $windowsInstaller.RelatedProducts($upgradeCode)) {
    if ($windowsInstaller.ProductState($product) -eq 5) {
      [pscustomobject]@{Code=$product;Version=$windowsInstaller.ProductInfo($product,'VersionString')}
    }
  }
}

function Invoke-Msi([string]$action,[string]$file) {
  $log=Join-Path $env:RUNNER_TEMP ("pivot-msi-"+[Guid]::NewGuid().ToString('N')+".log")
  $process=Start-Process msiexec.exe -ArgumentList @($action,('"' + $file + '"'),'/quiet','/norestart','/log',('"' + $log + '"')) -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    Get-Content -LiteralPath $log -Tail 25 -ErrorAction SilentlyContinue
    throw "Windows Installer $action failed ($($process.ExitCode)): $file"
  }
}

function Setup-Python {
  python -m venv (Join-Path $install 'app/.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the installed Python environment.' }
  & $python -m pip install -r (Join-Path $install 'app/simulator/requirements.txt') -r (Join-Path $install 'app/simulator/mcap-requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the Python integrations.' }
}

$release=Invoke-WebRequest "https://api.github.com/repos/$env:GITHUB_REPOSITORY/releases/latest" -Headers @{Accept='application/vnd.github+json';Authorization="Bearer $env:GH_TOKEN"} -SkipHttpErrorCheck
if ($release.StatusCode -notin @(200,404)) { throw "GitHub Releases returned HTTP $($release.StatusCode)." }
$previous=if ($release.StatusCode -eq 200) { $release.Content | ConvertFrom-Json }
$upgrade=$previous -and $previous.tag_name -match '^v\d+\.\d+\.\d+$' -and [version]$previous.tag_name.Substring(1) -lt [version]$version
$installed=$null

try {
  if ($upgrade) {
    $asset=$previous.assets | Where-Object name -eq "Pivot-$($previous.tag_name.Substring(1))-windows-x64.msi" | Select-Object -First 1
    if (!$asset -or $asset.digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'The prior installer is missing its GitHub SHA-256 digest.' }
    $previousMsi=Join-Path $env:RUNNER_TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $previousMsi
    if ($asset.digest -ine ('sha256:'+(Get-FileHash -LiteralPath $previousMsi).Hash)) { throw 'The prior installer checksum did not match.' }
    Invoke-Msi '/i' $previousMsi
    $installed=$previousMsi
    $before=@(Installed-PivotProducts)
    if ($before.Count -ne 1 -or $before[0].Version -ne $previous.tag_name.Substring(1)) {
      throw 'Windows Installer did not register the previous Pivot version.'
    }
    Setup-Python
    Write-Output "Prepared installed Pivot $($previous.tag_name) for upgrade."
  }

  New-Item -ItemType Directory -Path $workspace -Force | Out-Null
  $projectFile=Join-Path $workspace 'controller-notes.txt'
  $profileFile=Join-Path $profile 'window.xml'
  Set-Content -LiteralPath $projectFile 'Keep my controller notes.'
  $savedWindow=[System.Xml.Linq.XElement]::new('window',[System.Xml.Linq.XElement]::new('root',$workspace)).ToString()
  Set-Content -LiteralPath $profileFile $savedWindow

  Invoke-Msi '/i' $msi
  $installed=$msi
  $fileVersion=(Get-Item -LiteralPath (Join-Path $install 'Pivot.exe')).VersionInfo.FileVersion
  if ($fileVersion -ne "$version.0") { throw "Unexpected installed version: $fileVersion" }
  $products=@(Installed-PivotProducts)
  if ($products.Count -ne 1 -or $products[0].Version -ne $version) {
    throw ('Expected only Pivot '+$version+' after installation. Found versions: '+($products.Version -join ', '))
  }
  if ((Get-Content -LiteralPath $projectFile) -ne 'Keep my controller notes.' -or (Get-Content -LiteralPath $profileFile -Raw).Trim() -ne $savedWindow) {
    throw 'The installer changed an existing workspace or profile.'
  }
  if ($upgrade) {
    if (!(Test-Path -LiteralPath $python -PathType Leaf)) { throw 'The upgrade removed the Python environment.' }
    & (Join-Path $install 'app/desktop/setup-integrations.ps1') -PythonOnly
  } else { Setup-Python }

  node (Join-Path $PSScriptRoot 'smoke-service.mjs') $install $workspace
  if ($LASTEXITCODE -ne 0) { throw 'Installed runtime smoke test failed.' }
  if ($upgrade) { Write-Output "Pivot $($previous.tag_name) upgraded in place to v$version." }
} finally {
  if ($installed) { Invoke-Msi '/x' $installed }
}
