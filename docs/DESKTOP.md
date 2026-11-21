# Pivot on Windows

The per-user Windows x64 MSI installs into `%LOCALAPPDATA%\Programs\Pivot`. Launch Pivot from Start. It requires Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Evergreen. It includes a pinned Node runtime, the Windows PTY adapter, portable Neovim and the locked LazyVim plugins. Developer credentials are optional. [Latest release](https://github.com/REVSIX/Pivot/releases/latest)

The first desktop launch copies the included pendulum project to `%LOCALAPPDATA%\Pivot\user\projects\pendulum`. When Git is available, Pivot initializes and commits this new copy. Your project files and preferences stay in your user profile across upgrades. Use **Open folder** to choose another trusted workspace. The native picker restarts the local service for the chosen root. Save edits and exit running jobs before switching roots. The shell persists the root, localhost port and maximized state. The web UI persists its preferences in the WebView2 profile.

## Update Pivot

1. Save your editor buffers. Export any simulation clips or telemetry you want to keep, then close every Pivot window.
2. Download the new Windows x64 MSI from the [latest release](https://github.com/REVSIX/Pivot/releases/latest). Run it under the same Windows account you used to install Pivot. Windows Installer replaces the older app in place.
3. Open **Pivot** from Start. The last workspace and theme carry over. The update keeps the existing Python environment, so an already configured simulation and MCAP setup can be used again.

## Install and configure

1. Download the `Pivot-…-windows-x64.msi` and its matching `.sha256` file from the release. In PowerShell, run `Get-FileHash -Algorithm SHA256 .\Pivot-0.4.0-windows-x64.msi`, substituting your downloaded filename. Compare the hash with the first field in the checksum file. Run the MSI, then open **Pivot** from Start. The build is unsigned, so Windows may show an unrecognized publisher.
2. Install Git for Windows for local Git operations. Include ripgrep on PATH for fast search in LazyVim. Private operations can use your existing Git credential manager or SSH setup.
3. For live MuJoCo and MCAP export, install CPython 3.12 with the Python launcher, or install uv. Run the following in PowerShell from a terminal.

```powershell
Set-Location "$env:LOCALAPPDATA\Programs\Pivot\app"
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\desktop\setup-integrations.ps1 -PythonOnly
```

This creates the local Python environment and installs the pinned MuJoCo and MCAP requirements. Restart Pivot, then use `& $env:PIVOT_PYTHON .\controller.py` in a Pivot PowerShell terminal to run the bundled controller with that interpreter. Set `PIVOT_PYTHON` or `PIVOT_NVIM` to an absolute executable path before launch to use an existing installation. The MSI and bundled editor work offline. First-time Python setup needs internet access. For a source checkout, `-EditorOnly` provisions the editor and validates the portable Neovim archive if it needs to download it.

Use the included Node runtime in a terminal to convert telemetry:

```powershell
& "$env:LOCALAPPDATA\Programs\Pivot\node.exe" "$env:LOCALAPPDATA\Programs\Pivot\app\scripts\mcap.mjs" "C:\logs\run.csv"
```

Uninstall via Windows Settings → Apps → Installed apps. Windows Installer removes its registered files and shortcuts. User-created projects and generated development environments are retained.

If the window fails to start, confirm the WebView2 runtime is installed and read `%LOCALAPPDATA%\Pivot\user\startup-error.txt`. If live simulation fails, finish the Python setup and restart the app. If source control is unavailable, install Git for Windows and check `git --version` in a new terminal. [Microsoft WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)

## Development build

Use a Windows x64 shell with Node 24.12+, npm, Git, PowerShell, .NET Framework 4.8 (including its built-in C# compiler) and the .NET 8 runtime for the WiX build tool. The build pins and hashes the WebView2 SDK, WiX CLI and Node distribution. It provisions the pinned editor when the portable runtime or locked plugins are missing.

```powershell
npm ci
.\packaging\build.ps1 -OutputDirectory "$PWD\dist-installer"
```

For a quicker native host build that points to a checked-out workbench:

```powershell
npm run build
.\packaging\build.ps1 -HostOnly -OutputDirectory "$env:TEMP\pivot-host"
& "$env:TEMP\pivot-host\Pivot.exe" --app "$PWD" --root "C:\robot-projects"
```

Use `PIVOT_DESKTOP_PROFILE` to select an isolated test profile. For local test automation only, start the host with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9345`. CDP on that port grants access to the running developer session, so leave this variable unset during normal use. The service picks a loopback port on first launch and reuses it to preserve browser-origin state. If another application occupies a saved port, close Pivot and remove only the `port` element from the profile's `window.xml`. Startup diagnostics are saved in `startup-error.txt` there.

## Desktop design and distribution

Pivot reuses the machine's Evergreen WebView2 runtime, .NET Framework and the existing Express service. The native host starts one backend, waits for readiness, confines navigation to the assigned loopback origin and accepts a small origin-checked set of window messages. A Windows Job Object contains the backend, PTYs and simulation workers so closing or crashing the window releases its processes. Ctrl shortcuts reach the workbench. WebView2 can use accelerated graphics for the simulator. WSL shells are launched by the PTY service when a suitable WSL installation is available.

Tauri on Windows also uses WebView2 and requires Rust/MSVC build tooling; a Tauri wrapper would still need to integrate the Node PTY service or replace its functionality. This iteration chose WinForms and Microsoft's WebView2 SDK to keep the existing service and ship one small native host. The installer carries Node's complete license text, WebView2's SDK LICENSE and NOTICE, npm dependency notices and the browser asset notices. The bundled LazyVim plugins and Neovim retain their upstream terms. Git and Python use the workstation installation. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) · [Microsoft WebView2 WinForms guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winforms) · [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
