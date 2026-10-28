# MdPad

A free, open-source, Typora-like Markdown editor built with
[Tauri 2](https://tauri.app) and [Milkdown Crepe](https://milkdown.dev).

## Features (MVP)

- Live preview editing (WYSIWYG): type `# `, `**bold**`, `- `, `> `, etc.
- Tables, task lists, syntax-highlighted code blocks, LaTeX math
- Source mode (`Ctrl+/`) to edit the raw Markdown
- New / Open / Save / Save As, with "unsaved changes" prompts
- Images: relative paths display correctly; pasted images are copied to an
  `assets/` folder next to the document (once the file has been saved)
- Light and dark theme, word count (CJK aware)

| Shortcut       | Action             |
| -------------- | ------------------ |
| `Ctrl+N`       | New file           |
| `Ctrl+O`       | Open file          |
| `Ctrl+S`       | Save               |
| `Ctrl+Shift+S` | Save as            |
| `Ctrl+/`       | Toggle source mode |

## Download

GitHub builds a Windows installer for every change. Open the **Actions** tab,
click the newest **Windows build** run, and download the `.exe` under
**Artifacts** (sign in to GitHub first). Versions tagged like `v0.1.0` are also
published on the **Releases** page.

Windows may warn that the app is from an unknown publisher, because it isn't
code-signed yet: click **More info → Run anyway**.

## Run it on Windows

**Easiest:** double-click `setup.cmd`. It installs what MdPad needs
(Microsoft C++ Build Tools, WebView2, Node.js and Rust, using `winget`), skips
anything you already have, runs `npm install`, and then lets you start the app
or build and install it. Click "Yes" when Windows asks for permission. The
first run takes a while: the C++ Build Tools alone are a few GB.

**Or by hand.** One-time setup:

1. Install **Node.js** (LTS) from <https://nodejs.org>.
2. Install **Rust** from <https://rustup.rs> (`rustup-init.exe`). When it asks,
   let it install the **Visual Studio C++ Build Tools** ("Desktop development
   with C++"). Rust needs them on Windows.
3. **WebView2** is already included in Windows 10 (recent updates) and 11.

Then, in this folder:

```powershell
npm install
npm run tauri dev
```

The first run compiles the Rust code and takes a few minutes. Later runs are
fast, and changes to `src/` reload instantly.

### Build an installer

```powershell
npx tauri build --bundles nsis
```

The installer is `src-tauri\target\release\bundle\nsis\MdPad_0.1.0_x64-setup.exe`,
and the plain app is `src-tauri\target\release\mdpad.exe`. (Plain
`npm run tauri build` also makes an `.msi` installer, which has extra
requirements on Windows.)

### Try it in a browser (no Rust needed)

```powershell
npm run dev
```

Open <http://localhost:1420>. In the browser, Open uses a file picker and Save
downloads the file. Use the desktop app for real file editing.

## Project structure

```
src/                     Frontend (TypeScript, runs in the webview)
  main.ts                Entry point: finds the page elements, starts the app
  app.ts                 Document state, commands (new/open/save/...), UI updates
  editor.ts              The two editors: live preview (Crepe) and source (textarea)
  platform.ts            Files, dialogs, window title, images (Tauri + browser fallback)
  keymap.ts              Keyboard shortcuts
  theme.ts               Light/dark switching
  wordcount.ts           Word count
  styles/app.css         Layout (toolbar, editor area, status bar)
  styles/theme.css       Colors and fonts. Start here to restyle the app
index.html               Toolbar and status bar markup
setup.cmd                Windows one-click setup (runs setup-windows.ps1)
src-tauri/               Native side (Rust)
  src/lib.rs             Commands called from platform.ts (read/write files, save images)
  tauri.conf.json        App name, window size, bundling
  capabilities/          What the frontend is allowed to do
examples/welcome.md      A sample document
```

## Customizing

- **Colors and fonts:** edit `src/styles/theme.css`.
- **Editor width:** `--editor-max-width` in `src/styles/theme.css`.
- **Add a shortcut:** add an entry to `src/keymap.ts` that names a command
  from the `commands` table in `src/app.ts`.
- **Add a toolbar button:** add `<button data-command="your-command">` to
  `index.html` and the command to `commands` in `src/app.ts`.
- **Turn editor features on or off:** the `features` list in `src/editor.ts`
  (see `Crepe.Feature`: tables, math, code blocks, toolbar, placeholders, ...).
- **Something the browser can't do** (files, OS features): add a
  `#[tauri::command]` in `src-tauri/src/lib.rs`, register it in
  `generate_handler!`, and call it with `invoke()` from `src/platform.ts`.

## Known limitations

- Markdown markers are hidden while editing (like Notion). Typora shows them
  when the cursor is inside the formatted text; that would need a custom plugin.
- Milkdown can reformat Markdown when saving an edited file (for example, it
  pads table columns and writes empty paragraphs as `<br />`). Saving a file
  you haven't changed never rewrites it, and source mode saves exactly what
  you typed.
- Math blocks show the LaTeX source above the rendered preview.
- Only UTF-8 files can be opened.
- Dragging a file onto the window doesn't open it yet; use `Ctrl+O`.
- Not yet: outline sidebar, file tree, find and replace, Mermaid diagrams,
  export to PDF/HTML, file associations, auto-save.
