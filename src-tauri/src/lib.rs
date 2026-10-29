// Native side of the app: small commands the frontend calls with `invoke`.
// See src/platform.ts for the TypeScript side.

use std::fs;
use std::path::Path;

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    // Windows Notepad sometimes adds a BOM; drop it.
    let bytes = bytes.strip_prefix(UTF8_BOM).unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| format!("{path} is not a UTF-8 text file"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// The file passed on the command line (e.g. "Open with" in Explorer).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args().skip(1).find(|arg| !arg.starts_with('-'))
}

/// A file or folder in the sidebar's file tree.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// The folders and Markdown files in `path`: folders first, then by name.
/// Hidden entries (".git") are left out.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().ok()?.is_dir();
            if name.starts_with('.') || (!is_dir && !is_markdown(&name)) {
                return None;
            }
            let path = entry.path().to_string_lossy().into_owned();
            Some(DirEntry { name, path, is_dir })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Every Markdown file under `root` (for Quick Open), at most `limit`.
/// Skips hidden folders and node_modules.
#[tauri::command]
fn find_markdown_files(root: String, limit: usize) -> Vec<String> {
    let mut found = Vec::new();
    let mut folders = vec![std::path::PathBuf::from(root)];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => folders.push(entry.path()),
                Ok(kind) if kind.is_file() && is_markdown(&name) => {
                    found.push(entry.path().to_string_lossy().into_owned());
                    if found.len() >= limit {
                        return found;
                    }
                }
                _ => {}
            }
        }
    }
    found
}

fn is_markdown(name: &str) -> bool {
    let name = name.to_lowercase();
    [".md", ".markdown", ".mdown", ".mkd", ".txt"]
        .iter()
        .any(|ext| name.ends_with(ext))
}

/// Copies an image into an `assets` folder next to the document and returns
/// the relative path to use in the Markdown, e.g. `assets/image-1.png`.
#[tauri::command]
fn save_image(doc_path: String, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    store_image(&doc_path, &file_name, &bytes)
}

/// Copies an image file chosen with "Insert Image" into the `assets` folder.
#[tauri::command]
fn import_image(doc_path: String, source: String) -> Result<String, String> {
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    let file_name = Path::new(&source)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    store_image(&doc_path, file_name, &bytes)
}

fn store_image(doc_path: &str, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let folder = Path::new(doc_path)
        .parent()
        .ok_or("The document has no folder")?
        .join("assets");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let (stem, ext) = split_file_name(file_name);
    let mut name = format!("{stem}.{ext}");
    let mut n = 1;
    while folder.join(&name).exists() {
        name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    fs::write(folder.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("assets/{name}"))
}

/// "My Photo.PNG" -> ("My-Photo", "png"). Keeps names safe for Markdown links.
fn split_file_name(file_name: &str) -> (String, String) {
    let path = Path::new(file_name);
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect()
    };
    let stem = path.file_stem().and_then(|s| s.to_str()).map(clean);
    let ext = path.extension().and_then(|s| s.to_str()).map(|s| clean(s).to_lowercase());
    (
        stem.filter(|s| !s.is_empty()).unwrap_or_else(|| "image".into()),
        ext.filter(|s| !s.is_empty()).unwrap_or_else(|| "png".into()),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            initial_file,
            save_image,
            import_image,
            list_dir,
            find_markdown_files
        ])
        .setup(|app| {
            // The window is described in tauri.conf.json ("create": false),
            // and made here so tests can turn on the debugging port.
            let config = app.config().app.windows[0].clone();
            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
            if let Some(port) = debug_port() {
                window = window.additional_browser_args(&format!("{WEBVIEW_DEFAULT_ARGS} --remote-debugging-port={port}"));
            }
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MdPad");
}

/// The browser arguments Tauri uses by default on Windows; keep them when
/// adding our own.
const WEBVIEW_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// For automated tests: starting MdPad with MDPAD_DEBUG_PORT=9333 lets a
/// test script drive the page through the DevTools protocol on that port.
/// It only listens on this computer (127.0.0.1).
fn debug_port() -> Option<u16> {
    std::env::var("MDPAD_DEBUG_PORT").ok()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::split_file_name;

    #[test]
    fn cleans_image_names() {
        assert_eq!(split_file_name("My Photo.PNG"), ("My-Photo".into(), "png".into()));
        assert_eq!(split_file_name(""), ("image".into(), "png".into()));
        assert_eq!(split_file_name("截图 1.jpg"), ("截图-1".into(), "jpg".into()));
    }
}
