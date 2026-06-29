//! Native Stockfish process bridge. Spawns the bundled `stockfish` sidecar, sets
//! its working directory to the bundled net's folder so Stockfish auto-loads the
//! default net from CWD, writes UCI lines to its stdin, and streams stdout lines
//! to the frontend over an ipc::Channel. One engine at a time (held in EngineState).
use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the live child so `engine_send` can write to its stdin and `engine_stop`
/// can kill it. `None` when no engine is running.
#[derive(Default)]
pub struct EngineState(pub Mutex<Option<CommandChild>>);

/// Spawn the bundled Stockfish sidecar and stream its stdout lines to `on_line`.
/// `engine_id` is accepted for forward-compatibility (Phase 2 selects nets/binaries);
/// Phase 1 always launches the bundled engine.
#[tauri::command]
pub fn engine_start(
    app: AppHandle,
    state: State<'_, EngineState>,
    engine_id: String,
    on_line: Channel<String>,
) -> Result<(), String> {
    let _ = engine_id; // Phase 1: single bundled engine.

    // Kill any previous engine first.
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }

    // The net is bundled under resources/engine/; run Stockfish with that folder as
    // CWD so it auto-loads its default net without an explicit EvalFile.
    let net_dir = app
        .path()
        .resolve("resources/engine", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve net dir: {e}"))?;

    let (mut rx, child) = app
        .shell()
        .sidecar("stockfish")
        .map_err(|e| format!("sidecar: {e}"))?
        .current_dir(net_dir)
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;

    *state.0.lock().unwrap() = Some(child);

    // Forward stdout lines (already split on newline by the shell plugin) to the channel.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let _ = on_line.send(line);
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
    });

    Ok(())
}

/// Write a single UCI line to the running engine's stdin (newline appended).
#[tauri::command]
pub fn engine_send(state: State<'_, EngineState>, line: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let child = guard.as_mut().ok_or("no engine running")?;
    let mut buf = line.into_bytes();
    buf.push(b'\n');
    child.write(&buf).map_err(|e| format!("write: {e}"))
}

/// Kill the running engine, if any. Idempotent.
#[tauri::command]
pub fn engine_stop(state: State<'_, EngineState>) -> Result<(), String> {
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }
    Ok(())
}
