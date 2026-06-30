//! Native UCI engine bridge. Spawns either the bundled Stockfish sidecar (with CWD
//! set to the bundled net folder so Stockfish auto-loads the default net) or a
//! user-provided external binary, writes UCI lines to its stdin, and streams stdout
//! lines to the frontend over an ipc::Channel. One engine at a time (held in
//! EngineState).
use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the live child so `engine_send` can write to its stdin and `engine_stop`
/// can kill it. `None` when no engine is running.
#[derive(Default)]
pub struct EngineState(pub Mutex<Option<CommandChild>>);

/// Which native engine `engine_start` should spawn. Sent from JS as
/// `{ kind: "bundled" }` or `{ kind: "external", path: "/abs/path" }`.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EngineSpec {
    /// The app's bundled Stockfish sidecar.
    Bundled,
    /// A user-provided UCI binary referenced by absolute path.
    External { path: String },
}

/// Spawn a native UCI engine — the bundled Stockfish sidecar or a user-provided
/// external binary — and stream its stdout lines to `on_line`. One engine at a
/// time (held in EngineState); any previous engine is killed first.
#[tauri::command]
pub fn engine_start(
    app: AppHandle,
    state: State<'_, EngineState>,
    spec: EngineSpec,
    on_line: Channel<String>,
) -> Result<(), String> {
    // Kill any previous engine first.
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }

    let cmd = match spec {
        EngineSpec::Bundled => {
            // The net is bundled under resources/engine/; run Stockfish with that
            // folder as CWD so it auto-loads its default net without an explicit
            // EvalFile.
            let net_dir = app
                .path()
                .resolve("resources/engine", tauri::path::BaseDirectory::Resource)
                .map_err(|e| format!("resolve net dir: {e}"))?;
            let cmd = app
                .shell()
                .sidecar("stockfish")
                .map_err(|e| format!("sidecar: {e}"))?;
            // Packaged build: the bundled net is here and Stockfish auto-loads it
            // from CWD. `tauri dev` doesn't copy resources next to the dev binary,
            // so fall back to the engine's embedded net instead of failing spawn
            // with ENOENT.
            if net_dir.is_dir() { cmd.current_dir(net_dir) } else { cmd }
        }
        EngineSpec::External { path } => {
            // The user explicitly picked this binary (exactly like any desktop
            // chess GUI), so it runs Rust-side and is NOT gated by the JS shell
            // ACL. Its own net handling is the engine's concern (no CWD set).
            app.shell().command(path)
        }
    };

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;

    *state.0.lock().unwrap() = Some(child);

    // Forward stdout lines (already split on newline by the shell plugin) to the channel.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let _ = on_line.send(line);
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[engine stderr] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(err) => {
                    eprintln!("[engine error] {err}");
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
