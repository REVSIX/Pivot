# Projects, source control and terminals

Pivot opens files and tools in the selected project directory. The server accepts a workspace root when it starts. In the browser, choose a directory beneath that root. To work elsewhere, start Pivot with `npm start -- --root "C:/Robots"` or choose a workspace from the desktop host.

## Explorer

Expanding a folder reads that directory on demand. The explorer applies Git ignore rules through `git check-ignore` and omits dependencies, private dotfiles and linked directory entries. Text previews accept UTF-8 files up to 256 KiB. The Neovim editor can open larger files. Create, rename, reveal, and delete operate on canonical paths inside the selected project. Delete requires the exact selected path and accepts files or empty directories. Drag an explorer file or folder onto a destination folder or the project root to move it. Renames and moves update matching open buffers. The explorer rejects existing destinations.

## Git

Open the repository root for branch and write operations. The Source Control rail button opens a dedicated sidebar. The Git panel exposes working-tree and staged status independently, as well as diffs, stage, unstage, commit, local branches, fetch, fast-forward pull, and push. A checkout or pull with uncommitted changes returns an error. Commit uses the current index, including any files staged in an external tool. Configure your real Git author identity in the terminal before the first commit on a fresh machine.

Clone accepts HTTPS, SSH, scp-style Git SSH URLs and a relative path to another repository under the workspace root. Use the normal credential manager or SSH agent for private repositories. Pivot refuses credentials in HTTPS clone URLs. Fetch, pull, push and clone report Git errors to the UI and time out after two minutes. For remote operations requiring an interactive password or custom authentication, use the terminal.

Automatic status reads disable filesystem-monitor commands and external clean/process filters. Diffs disable external diff and textconv programs. Repositories using custom clean filters may therefore show a working-tree change that their usual Git client normalizes. Explicit Git operations use installed Git and may execute the project's normal hooks.

**GitHub sign-in** appears as a task when the GitHub CLI is available. It launches `gh auth login --hostname github.com --web --git-protocol https` inside a real terminal and lets the user complete the browser/device flow. To inspect the signed-in account, use the account status task. If your configured Git credential helper needs to use GitHub CLI's credentials, run `gh auth setup-git`. Sign-in is independent of local Git operations. [GitHub CLI login](https://cli.github.com/manual/gh_auth_login)

## Editors and shells

The default editor uses the isolated Pivot LazyVim profile. Select the personal profile to start the installed Neovim with its normal config and environment. This is an explicit opt-in for trusted projects. User plugins can run processes and read files with the desktop user's permissions. `PIVOT_NVIM` can point to an absolute Neovim executable.

Opening another file uses Neovim's local RPC server to edit the file in the existing process. Modified buffers stay in that process. Modes and panel visibility are UI state and can change without closing the socket. A project switch, closed tab, or desktop exit ends that window's sessions. Save changes first. Pivot starts each PTY in its own helper process so closing a terminal releases its native handles. [Neovim remote commands](https://neovim.io/doc/user/remote.html)

Native Windows terminal sessions start PowerShell with a clean profile in the project folder. Each terminal has independent history, process state, and scrollback. The terminal environment includes the telemetry SDK, the selected Python interpreter, and the `telem` CLI. On Windows, WSL uses the default installed Linux distribution and maps the Windows working directory with `wsl.exe --cd`. Linux tools and Python packages come from the selected distribution. The Windows telemetry environment is configured for native terminals. [WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)

## Embedded Python runs

1. Clone and open the project folder. Set up its dependencies as usual. Pivot looks for the project’s `.venv` first, then its configured Python, then Python on PATH. The script starts in the project folder, with its own directory available for imports.
2. Open the saved Python entry script and click **Run file**, or choose **Ctrl+Shift+P → Run current file** from any view. The run stays active as you switch between Code, Debug, Simulation, and Split. To pass command-line arguments, choose **Run in Embedded Viewer with arguments** and enter a JSON array such as `["--model", "models/arm.xml", "--seed", "42"]`.
3. The script steps the physics and sends a snapshot when it calls `viewer.sync()`. Pause freezes the displayed stream and recording. **Stop** interrupts the Python process and keeps captured frames available for replay. For model-only physics, use **Run simulation from MJCF model** in the palette.

Pivot embeds `mujoco.viewer.launch_passive()` and the earlier `pivot_viewer.launch_passive()` helper. Regular Python scripts can use **Run file** without installing MuJoCo. To use native viewer keyboard callbacks, camera settings, or custom rendering overlays, launch the script directly from a terminal. Embedded rendering follows Pivot's existing geometry support.

Debug lists up to 48 automatic channels per model under `MuJoCo/`, using simulation time. Set `PIVOT_SIM_HZ` in Pivot’s environment to change the maximum snapshot rate from 20 Hz (range 1–60). `PIVOT_TELEMETRY_OFF=1` disables Debug telemetry while leaving the embedded viewer available. Log application values like controller error, reward, or target position explicitly with `ide_telem.log()`.

## Project tasks

Available npm scripts are offered by name. A Dockerfile makes a build task available and a Compose configuration makes a Compose task available if the Docker client is installed. The user starts every task explicitly. A Docker daemon must be running when executing Docker tasks. Release scripts are regular project tasks and execute only when selected.

Optional `.pivot-tasks.json` example:

```json
{
  "tasks": {
    "Controller smoke test": "python -m unittest discover -v",
    "Run controller": "python src/controller.py"
  }
}
```

Each command runs inside the project terminal with the user's permissions. Use the command syntax for the active shell. Task discovery reads configuration and never executes a command.

## Verification

`node --test tests/projects.test.ts` exercises a real temporary Git repository and local bare remote. It tests explorer actions, ignore handling, confined paths, detected tasks, diff, stage, unstage, commit, branch changes, clone, fetch, pull and push.

`node --test tests/projects-native.test.mjs` uses two simultaneous native PTYs and a real Neovim instance. It verifies independent shell output and switches files with an unsaved buffer before writing both buffers to disk.
