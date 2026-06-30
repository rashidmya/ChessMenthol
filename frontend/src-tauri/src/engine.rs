//! Native UCI engine bridge. Spawns either the bundled Stockfish sidecar (with CWD
//! set to the bundled net folder so Stockfish auto-loads the default net) or a
//! user-provided external binary, writes UCI lines to its stdin, and streams stdout
//! lines to the frontend over an ipc::Channel. One engine at a time (held in
//! EngineState).
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

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

/// The engine's reported `id name …`, returned to JS by `engine_validate`.
#[derive(serde::Serialize)]
pub struct EngineName {
    pub name: String,
}

/// Validate a UCI engine binary: spawn it, send `uci`, and read stdout until
/// `uciok` (or timeout). Returns the engine's reported `id name …` so the
/// frontend can label it in the registry. Used by "+ Add engine" before adding.
#[tauri::command]
pub fn engine_validate(path: String) -> Result<EngineName, String> {
    validate_engine(&path, Duration::from_secs(10)).map(|name| EngineName { name })
}

/// Core of `engine_validate`, timeout-parameterized so unit tests can exercise
/// the timeout branch quickly. Returns the `id name` text on success.
fn validate_engine(path: &str, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {path}: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or("no stdin")?
        .write_all(b"uci\n")
        .map_err(|e| format!("write: {e}"))?;

    // Read stdout on a worker thread and report over a channel, so the caller can
    // enforce a timeout: an engine that never handshakes must not hang us. After
    // we kill the child below its stdout closes, the BufReader hits EOF, and the
    // detached thread exits.
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        let mut name: Option<String> = None;
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("id name ") {
                let trimmed = rest.trim();
                if !trimmed.is_empty() {
                    name = Some(trimmed.to_string());
                }
            }
            if line == "uciok" {
                let _ = tx.send(Ok(name.unwrap_or_else(|| "UCI engine".to_string())));
                return;
            }
        }
        let _ = tx.send(Err("engine exited before announcing uciok".to_string()));
    });

    let outcome = rx.recv_timeout(timeout);
    let _ = child.kill();
    let _ = child.wait();
    match outcome {
        Ok(result) => result,
        Err(_) => Err("engine did not respond to `uci` in time".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// The bundled Stockfish sidecar binary for the host target, if present.
    /// (`src-tauri/binaries/stockfish-<triple>`.) Returns None on a fresh
    /// checkout that hasn't fetched the binary, so the happy-path test skips.
    fn bundled_stockfish() -> Option<PathBuf> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("stockfish"))
                .unwrap_or(false)
        })
    }

    #[test]
    fn validate_reports_name_for_a_real_uci_engine() {
        let Some(sf) = bundled_stockfish() else {
            eprintln!("skip: no bundled stockfish binary in src-tauri/binaries");
            return;
        };
        let name = validate_engine(&sf.to_string_lossy(), Duration::from_secs(10))
            .expect("bundled stockfish should validate");
        assert!(
            name.to_lowercase().contains("stockfish"),
            "expected a Stockfish id name, got {name:?}"
        );
    }

    #[test]
    fn validate_errors_on_a_missing_binary() {
        let err = validate_engine("/nonexistent/engine/binary", Duration::from_secs(1))
            .unwrap_err();
        assert!(err.contains("spawn"), "got {err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn validate_rejects_a_binary_that_exits_without_uciok() {
        // /bin/true exits immediately and never prints `uciok`.
        let err = validate_engine("/bin/true", Duration::from_secs(5)).unwrap_err();
        assert!(err.contains("uciok") || err.contains("exited"), "got {err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn validate_times_out_on_a_binary_that_never_handshakes() {
        // /bin/cat echoes our `uci` but never prints `uciok` and never exits, so the
        // read must hit the timeout. A short timeout keeps the test fast.
        let err = validate_engine("/bin/cat", Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("in time"), "expected a timeout error, got {err:?}");
    }
}
