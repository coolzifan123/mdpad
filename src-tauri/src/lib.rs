// Native side of the app: small commands the frontend calls with `invoke`.
// See src/platform.ts for the TypeScript side.

use std::fs;
use std::path::Path;
use tauri::Manager;

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
const UTF16LE_BOM: &[u8] = b"\xFF\xFE";
const UTF16BE_BOM: &[u8] = b"\xFE\xFF";

/// A text file as read from disk, with what's needed to write it back the
/// same way.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFile {
    content: String,
    /// "UTF-8", "UTF-16LE", "UTF-16BE" or "GB18030" (older Chinese files).
    encoding: String,
    /// Whether a UTF-8 file starts with a byte order mark (Notepad adds one).
    bom: bool,
    /// When the file last changed, in ms since 1970; to notice outside edits.
    modified: u64,
}

#[tauri::command]
fn read_text_file(path: String) -> Result<TextFile, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let file = |content: String, encoding: &str, bom: bool| TextFile {
        content,
        encoding: encoding.into(),
        bom,
        modified: modified_ms(&path),
    };
    let decode = |encoding: &'static encoding_rs::Encoding, bytes: &[u8]| {
        let (text, had_errors) = encoding.decode_without_bom_handling(bytes);
        (!had_errors).then(|| text.into_owned())
    };
    if let Some(rest) = bytes.strip_prefix(UTF16LE_BOM) {
        if let Some(text) = decode(encoding_rs::UTF_16LE, rest) {
            return Ok(file(text, "UTF-16LE", true));
        }
    }
    if let Some(rest) = bytes.strip_prefix(UTF16BE_BOM) {
        if let Some(text) = decode(encoding_rs::UTF_16BE, rest) {
            return Ok(file(text, "UTF-16BE", true));
        }
    }
    let (bom, body) = match bytes.strip_prefix(UTF8_BOM) {
        Some(rest) => (true, rest),
        None => (false, &bytes[..]),
    };
    if let Ok(text) = std::str::from_utf8(body) {
        return Ok(file(text.to_owned(), "UTF-8", bom));
    }
    // Not UTF-8: most likely an older Chinese file (GBK / GB18030).
    match decode(encoding_rs::GB18030, body) {
        Some(text) => Ok(file(text, "GB18030", false)),
        None => Err(format!("{path} is not a text file MdPad can read")),
    }
}

/// Writes `contents` in the given encoding (default UTF-8) and returns the
/// file's new modification time.
#[tauri::command]
fn write_text_file(path: String, contents: String, encoding: Option<String>, bom: Option<bool>) -> Result<u64, String> {
    let mut bytes = Vec::new();
    match encoding.as_deref().unwrap_or("UTF-8") {
        "GB18030" => bytes.extend_from_slice(&encoding_rs::GB18030.encode(&contents).0),
        "UTF-16LE" => {
            bytes.extend_from_slice(UTF16LE_BOM);
            contents.encode_utf16().for_each(|unit| bytes.extend_from_slice(&unit.to_le_bytes()));
        }
        "UTF-16BE" => {
            bytes.extend_from_slice(UTF16BE_BOM);
            contents.encode_utf16().for_each(|unit| bytes.extend_from_slice(&unit.to_be_bytes()));
        }
        _ => {
            if bom.unwrap_or(false) {
                bytes.extend_from_slice(UTF8_BOM);
            }
            bytes.extend_from_slice(contents.as_bytes());
        }
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(modified_ms(&path))
}

/// When the file last changed (ms since 1970), or None if it's gone.
#[tauri::command]
fn file_modified(path: String) -> Option<u64> {
    Path::new(&path).exists().then(|| modified_ms(&path))
}

fn modified_ms(path: &str) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|age| age.as_millis() as u64)
        .unwrap_or(0)
}

/// Opens another MdPad window (a new copy of the program).
#[tauri::command]
fn new_window() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe).spawn().map_err(|e| e.to_string())?;
    Ok(())
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

/// The folder for custom CSS themes, created if missing.
fn theme_folder(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let folder = app.path().app_config_dir().map_err(|e| e.to_string())?.join("themes");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

#[tauri::command]
fn theme_folder_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(theme_folder(&app)?.to_string_lossy().into_owned())
}

/// The names of the .css files in the theme folder.
#[tauri::command]
fn list_themes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = fs::read_dir(theme_folder(&app)?)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.to_lowercase().ends_with(".css"))
        .collect();
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

#[tauri::command]
fn read_theme(app: tauri::AppHandle, name: String) -> Result<String, String> {
    // Only files directly inside the theme folder.
    if name.contains(['/', '\\']) || name.contains("..") {
        return Err(format!("Not a theme name: {name}"));
    }
    fs::read_to_string(theme_folder(&app)?.join(name)).map_err(|e| e.to_string())
}

fn is_markdown(name: &str) -> bool {
    let name = name.to_lowercase();
    [".md", ".markdown", ".mdown", ".mkd", ".txt"]
        .iter()
        .any(|ext| name.ends_with(ext))
}

/// Copies an image into the image folder next to the document ("assets"
/// unless the preferences say otherwise) and returns the relative path to
/// use in the Markdown, e.g. `assets/image-1.png`.
#[tauri::command]
fn save_image(doc_path: String, file_name: String, bytes: Vec<u8>, folder: Option<String>) -> Result<String, String> {
    store_image(&doc_path, folder.as_deref(), &file_name, &bytes)
}

/// Copies an image file chosen with "Insert Image" into the image folder.
#[tauri::command]
fn import_image(doc_path: String, source: String, folder: Option<String>) -> Result<String, String> {
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    let file_name = Path::new(&source)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    store_image(&doc_path, folder.as_deref(), file_name, &bytes)
}

fn store_image(doc_path: &str, folder_name: Option<&str>, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    // A folder inside the document's folder, like "assets" or "images/notes".
    let folder_name = folder_name.map(|f| f.trim().trim_matches(['/', '\\'])).filter(|f| !f.is_empty()).unwrap_or("assets");
    if folder_name.contains("..") || folder_name.contains(':') {
        return Err(format!("Not a folder inside the document's folder: {folder_name}"));
    }
    let folder = Path::new(doc_path)
        .parent()
        .ok_or("The document has no folder")?
        .join(folder_name);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let (stem, ext) = split_file_name(file_name);
    let mut name = format!("{stem}.{ext}");
    let mut n = 1;
    while folder.join(&name).exists() {
        name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    fs::write(folder.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("{}/{name}", folder_name.replace('\\', "/")))
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            initial_file,
            save_image,
            import_image,
            list_dir,
            find_markdown_files,
            theme_folder_path,
            list_themes,
            read_theme,
            file_modified,
            new_window
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
