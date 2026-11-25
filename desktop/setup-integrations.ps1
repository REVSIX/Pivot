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
    $requirements=@('-r','simulator/requirements.txt','-r','simulator/mcap-requirements.txt')
    $legacy=& $python -I -c "from importlib.metadata import distributions; print(any(d.metadata['Name'] == 'mujoco' and int(d.version.split('.', 1)[0]) < 4 for d in distributions(name='mujoco')))"
    if($LASTEXITCODE -ne 0){throw 'Could not inspect the installed MuJoCo version.'}
    $tempRoot=(Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
    $wheelhouse=$null
    $installOptions=@()
    try {
      if($legacy -eq 'True') {
        # Cache the replacement packages before removing the pre-split distribution.
        $wheelhouse=Join-Path $tempRoot ('pivot-python-'+[Guid]::NewGuid().ToString('N'))
        & $python -I -m pip download --only-binary=:all: --dest $wheelhouse @requirements
        if($LASTEXITCODE -ne 0){throw 'Could not download the replacement Python packages. The current installation is intact.'}
        & $python -I -m pip uninstall -y mujoco
        if($LASTEXITCODE -ne 0){throw 'Could not remove the legacy MuJoCo distribution.'}
        $installOptions=@('--no-index','--find-links',$wheelhouse)
      }
      & $python -I -m pip install @installOptions @requirements
      if($LASTEXITCODE -ne 0){throw 'Python integration setup failed.'}
      & $python -I -c "import mcap, mujoco, mujoco.viewer; from importlib.metadata import version; print('MuJoCo ' + mujoco.__version__ + ', MCAP ' + version('mcap'))"
      if($LASTEXITCODE -ne 0){throw 'The installed Python integrations could not be imported.'}
    } finally {
      if($wheelhouse -and (Test-Path -LiteralPath $wheelhouse)){
        $resolved=(Resolve-Path -LiteralPath $wheelhouse).Path
        if($resolved -eq $wheelhouse -and (Split-Path -Parent $resolved) -eq $tempRoot){
          Remove-Item -LiteralPath $resolved -Recurse -Force
        }
      }
    }
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
