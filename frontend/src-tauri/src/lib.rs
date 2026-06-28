#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Placeholder; replaced by capture_frame in Task i.2.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
