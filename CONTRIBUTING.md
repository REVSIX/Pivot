# Contributing to Pivot

Open a [bug report or feature proposal](https://github.com/REVSIX/Pivot/issues/new/choose), or [fork Pivot](https://github.com/REVSIX/Pivot/fork) and open a PR against `main`. For a bug, include your Pivot and OS versions, the steps to reproduce it, and a small project or model when possible. For UI changes, include a screenshot or recording and describe how you tested the workflow.

## Develop and test

Use Node.js 24.12+ and Git. Take a look at the [project guide](docs/PROJECTS.md) before changing editor, terminal, or Git behavior.

```sh
npm ci
npm run build
npm test
```

For simulation or export changes, install Python 3.12 with both requirements files in `simulator/`, then run `npm run test:sim` and `npm run test:mcap`. For native integration changes, set up the editor and Python using the [desktop guide](docs/DESKTOP.md), then run `node --test tests/*native.test.mjs`. The tests exercise actual Git repos, PTY sessions, editor saves, MuJoCo sessions, and telemetry export.

Keep changes scoped, exercise the feature through its usual entry point, and document new dependencies in [THIRD_PARTY.md](THIRD_PARTY.md). Keep local settings, project data, credentials, and generated runtimes out of patches.

## Cut a release

Pivot uses `vMAJOR.MINOR.PATCH` Git tags. Update the version in `package.json`, `package-lock.json`, and the native host version metadata in `desktop/Pivot.cs` and `desktop/app.manifest` before tagging the release commit. Push a matching tag such as `v0.3.0`.

GitHub Actions builds the Windows x64 MSI, upgrades the latest public installer when one is available, checks that the workspace and Python environment survive, and runs a live MuJoCo step. The tag workflow creates a draft with the installer and its SHA-256 checksum. Before publishing, check the desktop in an interactive Windows session. You can pass the old and new binaries to `node packaging/smoke.mjs <old Pivot.exe> <new Pivot.exe>` to verify that the same profile restores its workspace and theme. Run the **Windows release** workflow manually to try the installer build before tagging. See the [Windows build instructions](docs/DESKTOP.md) to run the build locally.

## Add README GIFs

Put the recordings under `docs/media/` and replace the matching HTML comments in the README with Markdown images and descriptive alt text. Good places to start are the workspace overview and the simulation with live telemetry.
