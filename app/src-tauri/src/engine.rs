//! Desktop-only. Included via `#[cfg(desktop)] mod engine;` in lib.rs; the whole
//! module is compiled out on mobile, where the Kotlin `engine` plugin drives a
//! native Stockfish process instead.
//!
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

/// What `engine_probe` returns: the engine's `id name` and its raw `option …` lines
/// (parsed on the JS side by uciOptions.ts — Rust does not parse options).
#[derive(Debug, serde::Serialize)]
pub struct EngineProbe {
    pub name: String,
    pub option_lines: Vec<String>,
}

/// Probe a UCI engine described by `spec` (bundled sidecar OR external path): spawn it
/// in ISOLATION from the live analysis engine (EngineState), send `uci`, collect the
/// `id name` line and all `option …` lines until `uciok` (or timeout), then kill it.
/// Used by "+ Add engine" (validation) and on-demand schema fetch for the options form.
#[tauri::command]
pub fn engine_probe(spec: EngineSpec) -> Result<EngineProbe, String> {
    match spec {
        EngineSpec::External { path } => probe_path(&path, Duration::from_secs(10)),
        EngineSpec::Bundled => {
            // Resolve the bundled sidecar's on-disk path so we can probe it with the
            // same sync std::process helper (isolated from EngineState).
            let path = bundled_sidecar_path()?;
            probe_path(&path, Duration::from_secs(10))
        }
    }
}

/// Best-effort path to the bundled `stockfish` sidecar for the host. In a packaged
/// build it sits next to the main executable; under `tauri dev` it's in
/// `src-tauri/binaries/stockfish-<triple>`. Tries the packaged location first.
fn bundled_sidecar_path() -> Result<String, String> {
    use std::path::PathBuf;
    // Packaged: next to the current exe (Tauri installs the sidecar there, name `stockfish`).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(if cfg!(windows) { "stockfish.exe" } else { "stockfish" });
            if p.is_file() { return Ok(p.to_string_lossy().into_owned()); }
        }
    }
    // Dev: src-tauri/binaries/stockfish-<triple>
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("stockfish")).unwrap_or(false)
                && p.is_file()
            {
                return Ok(p.to_string_lossy().into_owned());
            }
        }
    }
    Err("bundled stockfish sidecar not found".to_string())
}

/// Spawn `path`, send `uci`, collect `id name` + `option …` lines until `uciok`/timeout,
/// kill. Timeout-parameterized for fast unit tests.
fn probe_path(path: &str, timeout: Duration) -> Result<EngineProbe, String> {
    let mut child = Command::new(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {path}: {e}"))?;

    // Infallible in practice: both stdin and stdout are always Some because we set
    // Stdio::piped() above. These ? are purely defensive (no zombie risk in real use).
    child.stdin.as_mut().ok_or("no stdin")?.write_all(b"uci\n").map_err(|e| format!("write: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = mpsc::channel::<Result<EngineProbe, String>>();
    std::thread::spawn(move || {
        let mut name: Option<String> = None;
        let mut options: Vec<String> = Vec::new();
        for line in BufReader::new(stdout).lines() {
            let line = match line { Ok(l) => l, Err(_) => break };
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("id name ") {
                let n = rest.trim();
                if !n.is_empty() { name = Some(n.to_string()); }
            } else if line.starts_with("option name ") {
                options.push(line.to_string());
            }
            if line == "uciok" {
                let _ = tx.send(Ok(EngineProbe {
                    name: name.unwrap_or_else(|| "UCI engine".to_string()),
                    option_lines: options,
                }));
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

    fn bundled_stockfish() -> Option<PathBuf> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
            p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("stockfish")).unwrap_or(false)
        })
    }

    #[test]
    fn probe_reports_name_and_options_for_a_real_engine() {
        let Some(sf) = bundled_stockfish() else { eprintln!("skip: no bundled stockfish"); return; };
        let probe = probe_path(&sf.to_string_lossy(), Duration::from_secs(10)).expect("should probe");
        assert!(probe.name.to_lowercase().contains("stockfish"), "got {:?}", probe.name);
        assert!(probe.option_lines.iter().any(|l| l.contains("MultiPV")), "expected MultiPV option line");
        assert!(probe.option_lines.iter().all(|l| l.starts_with("option name ")));
    }

    #[test]
    fn probe_errors_on_a_missing_binary() {
        let err = probe_path("/nonexistent/engine/binary", Duration::from_secs(1)).unwrap_err();
        assert!(err.contains("spawn"), "got {err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn probe_rejects_a_binary_that_exits_without_uciok() {
        let err = probe_path("/bin/true", Duration::from_secs(5)).unwrap_err();
        assert!(err.contains("uciok") || err.contains("exited"), "got {err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn probe_times_out_on_a_binary_that_never_handshakes() {
        let err = probe_path("/bin/cat", Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("in time"), "got {err:?}");
    }
}
