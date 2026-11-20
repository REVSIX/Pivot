# Upstream integration notes

| Project | Upstream terms | How Pivot uses it |
| --- | --- | --- |
| Monkeytype | GPL-3.0 | Visual reference for a quiet workspace, minimal chrome, and a searchable keyboard menu. The Pivot interface, wordmark, diagrams, and source are original. [Repository and license](https://github.com/monkeytypegame/monkeytype) |
| Lucide | ISC | Settings gear. [Icon](https://lucide.dev/icons/settings) |
| LazyVim | Apache-2.0 | Imported as a pinned Neovim plugin spec. Setup and plugin locking are explicit and isolated per checkout. [Repository](https://github.com/LazyVim/LazyVim) · [Requirements](https://www.lazyvim.org/) |
| lazy.nvim and TokyoNight | Apache-2.0 | Upstream plugin manager and native editor theme. Each additional plugin keeps its own license. [lazy.nvim](https://github.com/folke/lazy.nvim) · [TokyoNight](https://github.com/folke/tokyonight.nvim) |
| Neovim | Apache-2.0 with Vim-licensed portions | External executable in a local pseudoterminal. No Neovim binary is distributed in the source archive. [License](https://github.com/neovim/neovim/blob/master/LICENSE.txt) |
| xterm.js and node-pty | MIT | Browser terminal and OS terminal adapter. Native builds vary by platform. [xterm.js](https://github.com/xtermjs/xterm.js) · [node-pty requirements](https://github.com/microsoft/node-pty) |
| lazygit | MIT | Optional Git UI launched within the existing LazyVim session. Uses the user's installed Git and credentials. [Repository](https://github.com/jesseduffield/lazygit) |
| MuJoCo | Apache-2.0 | Official native Python bindings run in a bounded local process. Model compilation uses in-memory XML. [Repository](https://github.com/google-deepmind/mujoco) · [Python API](https://mujoco.readthedocs.io/en/stable/python.html) |
| AdvantageScope | BSD-style three-clause terms with named non-endorsement provisions | Interoperates through its documented numeric CSV Table import. This project ships its own exporter. [License text](https://github.com/Mechanical-Advantage/AdvantageScope/blob/main/LICENSE) · [CSV import](https://docs.advantagescope.org/getting-started/manage-files/) · [Decoder exercised](https://github.com/Mechanical-Advantage/AdvantageScope/blob/92c47d944ce06a94002de715b5daa954490c2f2d/src/hub/dataSources/csv/CSVDecoder.ts) |
| Spotify | Hosted service and platform terms | Official embed, fetched on user action. Spotify determines available playback for the listener. [Embedding](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed) · [Developer terms](https://developer.spotify.com/terms) |
| MCAP | MIT Python library | Optional terminal converter uses the indexed writer and reader, with JSON Schema and simulation-relative nanoseconds. [Repository](https://github.com/foxglove/mcap) · [Writer API](https://mcap.dev/docs/python/mcap-apidoc/mcap.writer) |
| IBM Plex Mono and Instrument Sans | SIL Open Font License 1.1 | Two self-hosted Latin font faces. Their original notices accompany the build. [IBM Plex](https://github.com/IBM/plex) · [Instrument Sans](https://github.com/Instrument/instrument-sans) |

Express, Vite, Tailwind CSS, TypeScript, and ws are installed through npm. The lockfile records exact package versions and integrity hashes. Runtime dependencies and plugins retain the license files from their respective packages. Source distributions include the notices for browser assets in `client/public/licenses`.

