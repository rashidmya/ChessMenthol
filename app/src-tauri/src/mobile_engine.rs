//! Android-only native engine bridge. A thin Tauri plugin registers the Kotlin
//! `EnginePlugin` (which spawns the bundled libstockfish.so from nativeLibraryDir and
//! streams its stdout as `line` events), and three **app commands** forward
//! start/send/stop to it via `run_mobile_plugin`.
//!
//! App commands (not plugin commands) are used deliberately: plugin commands require
//! ACL permission definitions, while app commands are allowed without capability
//! entries — exactly like the desktop `engine_*` commands. The JS UciEngine seam
//! (loadAndroidEngine) calls `mobile_engine_start/send/stop` and listens for the
//! plugin's `line` events via addPluginListener('engine', 'line', …).
//!
//! Commands are pinned to the concrete `Wry` runtime (not a generic `R: Runtime`):
//! `generate_handler!` can only infer `R` inside a plugin's own invoke_handler, not in
//! the app-level handler these are registered in.
use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{command, Manager, State, Wry};

/// Empty payload/response for the argument-less start/stop round-trips.
#[derive(Serialize, Deserialize)]
struct Empty {}

#[derive(Serialize)]
struct SendArgs {
    line: String,
}

/// Buffered stdout lines drained from the Kotlin side on each poll.
#[derive(Deserialize)]
struct PollResult {
    lines: Vec<String>,
}

/// Holds the registered Android plugin handle so the app commands can drive it.
pub(crate) struct EngineHandle(PluginHandle<Wry>);

#[command]
pub(crate) fn mobile_engine_start(state: State<'_, EngineHandle>) -> Result<(), String> {
    state
        .0
        .run_mobile_plugin::<Empty>("start", Empty {})
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[command]
pub(crate) fn mobile_engine_send(state: State<'_, EngineHandle>, line: String) -> Result<(), String> {
    state
        .0
        .run_mobile_plugin::<Empty>("send", SendArgs { line })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Drain and return any engine stdout lines buffered since the last poll.
#[command]
pub(crate) fn mobile_engine_poll(state: State<'_, EngineHandle>) -> Result<Vec<String>, String> {
    state
        .0
        .run_mobile_plugin::<PollResult>("poll", Empty {})
        .map(|r| r.lines)
        .map_err(|e| e.to_string())
}

#[command]
pub(crate) fn mobile_engine_stop(state: State<'_, EngineHandle>) -> Result<(), String> {
    state
        .0
        .run_mobile_plugin::<Empty>("stop", Empty {})
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The plugin exists only to register the Kotlin `EnginePlugin` and hold its handle;
/// the actual JS-facing commands are the app commands above.
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("engine")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.chessmenthol", "EnginePlugin")?;
            app.manage(EngineHandle(handle));
            Ok(())
        })
        .build()
}
