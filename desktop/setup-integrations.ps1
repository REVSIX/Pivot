# Run explicitly to enable native editing, physics and MCAP in a per-user install.
[CmdletBinding()]
param([switch]$EditorOnly,[switch]$PythonOnly,[switch]$PortableEditor)
$ErrorActionPreference='Stop'
$app=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node=Join-Path (Split-Path $app -Parent) 'node.exe'
if(!(Test-Path $node)) { $node=(Get-Command node -ErrorAction Stop).Source }
Push-Location $app
try {
  if(!$EditorOnly) {
    $python=Join-Path $app '.venv/Scripts/python.exe'
    if(!(Test-Path $python)) {
      if(Get-Command uv -ErrorAction SilentlyContinue){& uv venv --python 3.12 --seed .venv}
      else {& py -3.12 -m venv .venv}
      if($LASTEXITCODE -ne 0){throw 'Install CPython 3.12 or uv, then rerun this command.'}
    }
    & $python -I -m pip install -r simulator/requirements.txt -r simulator/mcap-requirements.txt
    if($LASTEXITCODE -ne 0){throw 'Python integration setup failed.'}
  }
  if(!$PythonOnly) {
    if(!(Get-Command git -ErrorAction SilentlyContinue)){throw 'Install Git for Windows and restart setup.'}
    $portable=Join-Path $app '.pivot/bin/nvim-win64/bin/nvim.exe'
    if(!(Test-Path $portable) -and ($PortableEditor -or (!$env:PIVOT_NVIM -and !(Get-Command nvim -ErrorAction SilentlyContinue)))) {
      $target=Join-Path $app '.pivot/bin'
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      $zip=Join-Path ([IO.Path]::GetTempPath()) ('pivot-nvim-'+[Guid]::NewGuid().ToString('N')+'.zip')
      try {
        curl.exe -fsSL --retry 2 https://github.com/neovim/neovim/releases/download/v0.12.6/nvim-win64.zip -o $zip
        if($LASTEXITCODE -ne 0 -or (Get-FileHash $zip).Hash.ToLowerInvariant() -ne '4e12b7103b601ffc8f25954b4da100f339faa73dccb69a5b135e897fa3d893ed'){throw 'Neovim package checksum failed.'}
        Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
      } finally {if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}}
    }
    $previousNvim=$env:PIVOT_NVIM
    try {
      if($PortableEditor){$env:PIVOT_NVIM=$portable}
      & $node scripts/setup-editor.mjs
      if($LASTEXITCODE -ne 0){throw 'LazyVim integration setup failed.'}
    } finally {$env:PIVOT_NVIM=$previousNvim}
  }
  & $node scripts/doctor.mjs
} finally {Pop-Location}
