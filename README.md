# MdPad

A free, open-source, Typora-like Markdown editor built with
[Tauri 2](https://tauri.app) and [Milkdown Crepe](https://milkdown.dev).

## Features

- **Live preview** editing like Typora: type `# `, `**bold**`, `- `, `> `… and
  the formatting appears; its Markdown symbols show around it at the cursor
- Tables, task lists, highlighted code, math, Mermaid diagrams, footnotes,
  `[TOC]`, `==highlight==`, emoji shortcodes (`:smile:`), YAML front matter
- **Sidebar** with the document outline and a folder's files; Quick Open
- **Find and replace**, spell check, focus and typewriter modes, zoom
- Export to **HTML** and **PDF**, print
- **Saves carefully**: parts of a file you didn't edit stay exactly as they
  were, with their line endings and encoding (UTF-8, GBK, UTF-16)
- Recent files, auto save, light/dark and custom CSS themes, Preferences
- Updates itself from GitHub Releases

| Shortcut | Action | Shortcut | Action |
| --- | --- | --- | --- |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | New / Open / Save | `Ctrl+1`…`6`, `Ctrl+0` | Heading, paragraph |
| `Ctrl+P` | Quick Open | `Ctrl+B` / `I` / `K` | Bold / italic / link |
| `Ctrl+F` / `Ctrl+H` | Find / replace | `Ctrl+T` | Table |
| `Ctrl+Shift+L` | Sidebar | `Ctrl+Shift+K` / `M` | Code / math block |
| `Ctrl+/` | Source mode | `Ctrl+Shift+H` | Highlight |
| `F8` / `F9` / `F11` | Focus / typewriter / full screen | `Ctrl+,` | Preferences |

All shortcuts are listed in the menus.

## Download

Get the installer (`MdPad_x.y.z_x64-setup.exe`) from the
[**Releases** page](https://github.com/coolzifan123/mdpad/releases). After
that, MdPad updates itself (Help → Check for Updates).

Windows may warn that the app is from an unknown publisher, because it isn't
code-signed yet: click **More info → Run anyway**.

Builds of every change are on the **Actions** tab, under **Artifacts** (sign in
to GitHub first). How to publish a release: [docs/releasing.md](docs/releasing.md).

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
  preserve.ts            Saving without reformatting: unedited blocks are copied from the file
  image-blocks.ts        Which images become resizable blocks (keeps image descriptions)
  markdown-style.ts      Line endings, and each file's Markdown style for rewritten blocks
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
- Saving keeps the parts of a file you didn't edit exactly as they were, and
  keeps its line endings (CRLF or LF). A block you did edit is rewritten in
  the file's own style (bullet character, `---` rules, ...), but small things
  can still change in that block: tables get padded columns, and an empty
  paragraph is written as `<br />`. Source mode saves exactly what you typed.
- An image on a line of its own can be resized only if it has no
  description (`![](photo.png)`). Images with a description
  (`![A cat](cat.png)`) stay normal images, because a resizable image stores
  its size where the description would go.
- Only UTF-8 files can be opened.
- Dragging a file onto the window doesn't open it yet; use `Ctrl+O`.
- Not yet: outline sidebar, file tree, find and replace, Mermaid diagrams,
  export to PDF/HTML, auto-save.

## Licence

MIT — see [LICENSE](LICENSE).
