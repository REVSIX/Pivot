# Pivot


<img width="1598" height="854" alt="Recording 2026-11-20 003855" src="https://github.com/user-attachments/assets/24f30fac-d770-479b-95a8-ca1d27fcb160" />



Pivot is a local-first robotics IDE for editing a controller in LazyVim, running it in a terminal, and watching your robot and its telemetry in MuJoCo. Open a project folder to keep its code, simulations, terminals, and Git changes in one workspace.

[Download for Windows x64](https://github.com/REVSIX/Pivot/releases/latest) · [Example projects](https://github.com/REVSIX/pivot-pendulum-pid) · [Contribute](CONTRIBUTING.md)

<!-- Add the main workspace GIF here. Suggested path: docs/media/workspace.gif -->

## Update an existing installation

Save your work, close Pivot, and run the newer Windows x64 MSI from the [latest release](https://github.com/REVSIX/Pivot/releases/latest). Open **Pivot** again from the Start menu. The installer upgrades the existing copy in place. Your projects, last workspace, and theme stay in your user profile. See [Windows upgrade steps](docs/DESKTOP.md#update-pivot).

## Quick start

1. Download the `Pivot-…-windows-x64.msi` file under **Assets** in the [latest release](https://github.com/REVSIX/Pivot/releases/latest). Run it and open **Pivot** from the Start menu. The installer bundles Node, Neovim, and the pinned LazyVim plugins. Windows 10/11 x64 requires .NET Framework 4.8 and Microsoft Edge WebView2 Evergreen. The installer is unsigned.
2. On first launch, Pivot opens a writable copy of the pendulum lab. Switch to **Simulation** and press the play button under the viewport to replay the included capture. You can edit the sample files immediately.
3. For live MuJoCo, install Python 3.12 or uv and run the one-time setup in PowerShell. Restart Pivot afterward. See the [Windows setup guide](docs/DESKTOP.md) for dependencies, checksum verification, and troubleshooting.

   ```powershell
   Set-Location "$env:LOCALAPPDATA\Programs\Pivot\app"
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\desktop\setup-integrations.ps1 -PythonOnly
   ```

4. Click **Pick model** and select `pendulum.xml`, then click **Run sim**. Pause or step from the simulation transport. To see controller telemetry, run the command below inside a **Pivot** terminal, then open **Debug** and choose `torque`, `position_error`, and `elbow_velocity` with **Select debug channels**.

   ```powershell
   & $env:PIVOT_PYTHON .\controller.py
   ```

## Find your way around

Press **Ctrl+Shift+P** to open the command palette. Type to filter, use **↑/↓** to select, **Enter** to run, and **Esc** to close. Use **Ctrl+1** for Code, **Ctrl+2** for Debug, **Ctrl+3** for Simulation, and **Ctrl+4** for Split.

| What you want to do | What to use |
| --- | --- |
| Open a project | **Open project folder** → **Browse computer** in the Windows app. Pivot remembers your last folder. |
| Find or edit a file | **Find file in project** or the Explorer. **Focus LazyVim fullscreen** gives the editor the whole workspace. |
| Switch to the terminal | **Open existing terminal** or **New terminal**. Each terminal keeps its own state and history. |
| Copy or paste terminal text | Right-click for **Copy**, **Paste**, and **Select all**, or use **Ctrl+Shift+C** and **Ctrl+Shift+V**. |
| Run the active saved buffer | **Run current file**. Python, JavaScript, shell, and PowerShell output appear in the integrated terminal. **Stop** interrupts the selected terminal and pauses simulation while keeping the recorded frames available for replay. |
| Review a patch | **Show source control sidebar**. Select a changed file to compare both versions. Stage files, commit, or find branch and remote commands from the palette. |
| Preview or run a model | **Select MJCF model**, or click an MJCF in Explorer while in Simulation, to inspect its initial pose. **Run simulation** starts physics and playback. The fullscreen button fills the display. Move the pointer to show its controls and press **Esc** to exit. |
| Inspect body origins | **Simulation options → Show body origins** adds bearing-shaped markers. The default view shows the model geometry without those overlays. |
| Plot or export data | **Select debug channels**, **Export CSV**, and **Export telemetry as MCAP**. CSV can export a simulation capture or SDK telemetry. MCAP exports SDK telemetry. |
| Share a simulation clip | Use the download icon next to **Reset camera** for JPEG, MP4, or GIF. Drag the range ticks, play the loop to review it, then confirm the export in the viewport. |
| Change the look | Type **Theme**, then press **Enter**. The picker opens at your active theme. Browse to preview and press **Enter** to apply. University themes are after Monkeytype. The footer shows the active theme. |
| Run a build or inspect a device | Search for **Task** to run a project task. **Serial Monitor** uses PlatformIO Core when installed and configured. |

## LazyVim essentials

Start with **Esc** for Normal mode, **i** to type, **:w** to save, **u** to undo, and **Space** to discover commands. Use **Space f f** to find files, **Space s g** to search project text, and **Shift+h / Shift+l** to switch buffers. See the [Pivot LazyVim cheat sheet](docs/LAZYVIM.md) and the [official LazyVim keymaps](https://www.lazyvim.org/keymaps).

For completion, definitions, and diagnostics, install the language server for your project and put it on PATH before launching Pivot. The bundled profile detects `clangd`, `pyright-langserver`, and `lua-language-server`. For C and C++, configure `compile_commands.json` so clangd sees your actual compiler flags and headers. Use `:LspInfo` to check which server attached to the buffer.

## Run your own robotics project

1. Open the folder containing your model and controller. **Pick model** lists project MJCF (`.xml`) files and built-in models. The embedded renderer supports single-file MJCF with supported hinge and slide joints and primitive geometry. See [project workflows](docs/PROJECTS.md) for workspace and tool details.
2. Start with **Run sim** to check geometry and basic dynamics. Run your Python controller from the terminal when you want it to own the simulation. In a Pivot terminal, use `pivot_viewer.launch_passive(model, data, model_path)` in place of the standalone MuJoCo viewer, then call `viewer.sync()` in the loop to stream frames to the Simulation panel.
3. Use `ide_telem.log("tracking_error", error, unit="rad", timestamp=data.time)` in Python to send a named signal to Debug. Sample at a frequency appropriate for plots and call `ide_telem.flush()` before your script exits.
4. Use **Export CSV** or **Export telemetry as MCAP** to take the data into other tools. For repeatable terminal commands, put named tasks in `.pivot-tasks.json` or `package.json`.

<img width="1512" height="612" alt="train" src="https://github.com/user-attachments/assets/4be98be4-e257-4d53-9cf3-292ac6d4788d" />

### Example code to learn from

- [Bundled pendulum lab](examples/pendulum) starts with a two-link MJCF, a small PD controller, and configurable gains. Use it to learn how model selection, terminal runs, tasks, and Debug plots fit together.
- [Pivot Pendulum PID](https://github.com/REVSIX/pivot-pendulum-pid) is the companion project with pendulum, cart-pole, and other control experiments. Clone it and open the checkout as a separate workspace. [`train_cartpole_updated.py`](https://github.com/REVSIX/pivot-pendulum-pid/blob/main/train_cartpole_updated.py) shows a training loop publishing updated gains while an embedded viewer runs.

  To try the cart-pole reference, install CPU PyTorch into Pivot’s Python environment and run the script from a Pivot terminal. Switch to **Simulation** to see the viewer stream and open **Debug** to inspect the logged signals. [PyTorch install options](https://pytorch.org/get-started/locally/)

  ```powershell
  & $env:PIVOT_PYTHON -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  & $env:PIVOT_PYTHON .\train_cartpole_updated.py
  ```

## Build and contribute

To run the workbench from a checkout, install Node.js 24.12+ and Git:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4317`. To choose a workspace at startup, use `npm start -- --root "/path/to/project"`. For native editing, install Neovim and run `npm run setup:editor`, or use the Windows setup script with `-EditorOnly`. Run `npm run doctor` to check tool discovery. Pivot runs tools under your local user account. Open trusted project folders and keep the service on loopback.

The UI starts in `client/src/main.ts`. The loopback API is in `server/app.ts`. Neovim integration is in `server/editor.ts` and `editor/`. Live simulation is in `server/live-simulation.ts` and `simulator/`. The Python SDK lives in `telemetry/`.

Fork the repo, open an issue for a bug or proposal, or send a pull request. See the [contributor guide](CONTRIBUTING.md) for development checks and the release process. Pivot is [MIT-licensed](LICENSE). Bundled components have their own [third-party notices](THIRD_PARTY.md).
