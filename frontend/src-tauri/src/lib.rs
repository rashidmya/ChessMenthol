use xcap::Monitor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![capture_frame])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Capture the primary monitor as RGBA. Returns an 8-byte little-endian header
/// [width u32][height u32] followed by width*height*4 RGBA bytes, sent over
/// Tauri's binary IPC (no JSON serialization of the pixel buffer).
#[tauri::command]
fn capture_frame() -> Result<tauri::ipc::Response, String> {
    let monitors = Monitor::all().map_err(|e| format!("enumerate monitors: {e}"))?;
    // Prefer the primary monitor; fall back to the first available one. On some
    // Wayland compositors `is_primary()` returns Err for every monitor, so a
    // strict primary-only filter would wrongly report "no monitor" on a normal
    // single-display setup. `.iter()` borrows so the fallback can reuse the Vec.
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitor found".to_string())?;
    let img = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;
    let (width, height) = (img.width(), img.height());
    let rgba = img.as_raw();

    let mut buf = Vec::with_capacity(8 + rgba.len());
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(rgba);
    Ok(tauri::ipc::Response::new(buf))
}
