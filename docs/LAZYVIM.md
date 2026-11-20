# LazyVim in Pivot

Open a project file and click the editor to focus it. **Ctrl+Shift+P** opens Pivot’s palette from the editor or the terminal. Inside LazyVim, press **Esc** for Normal mode, then **Space** to see available leader shortcuts.

## 1. Edit and save

| Keys | Action |
| --- | --- |
| `i`, `a`, `o` | Insert before the cursor, after it, or on a new line below. |
| `Esc` | Return to Normal mode. |
| `w`, `b`, `0`, `$` | Move by word or to the start or end of the line. |
| `gg`, `G` | Jump to the first or last line. |
| `u`, `Ctrl+r` | Undo and redo. |
| `v`, `V`, then `y` or `d` | Select text or lines, then copy or cut. Use `p` to paste. |
| `dd`, `yy` | Cut or copy the current line. |
| `:w` | Save. Press Enter after typing it. |

## 2. Find files and jump around

| Keys | Action |
| --- | --- |
| `Space f f` | Find a project file. |
| `Space s g` | Search project text. Install ripgrep for this search. |
| `/`, then `n` or `N` | Search the current buffer, then move through matches. |
| `Shift+h` / `Shift+l` | Previous or next buffer. |
| `Space b b` / `Space b d` | Return to the previous buffer or close the current one. |
| `Ctrl+o` / `Ctrl+i` | Jump backward or forward through navigation history. |

## 3. Navigate code and run it

| Keys or command | Action |
| --- | --- |
| `gd`, `gr`, `K` | Go to definition, find references, or show hover documentation when an LSP server is attached. |
| `Space c r` / `Space c a` | Rename a symbol or show code actions. |
| `Space c f` | Format with the configured formatter. |
| `:LspInfo` | Inspect active language servers. |
| **Run current file** | From Pivot’s palette, run the saved active file in the integrated terminal. |
| **Focus LazyVim fullscreen** / **Open existing terminal** | Switch between editing and terminal work using Pivot’s palette. |

Use the bundled profile for these defaults. To load your own Neovim distribution and configuration, choose **Editor profile** in Pivot. [LazyVim getting started](https://www.lazyvim.org/) · [Full LazyVim keymaps](https://www.lazyvim.org/keymaps)
