use std::path::PathBuf;
use std::process::Command;

use tauri::Manager;
use xcap::Monitor;

mod engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![
            capture_frame,
            engine::engine_start,
            engine::engine_send,
            engine::engine_stop,
            engine::engine_probe
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The shell plugin only auto-kills JS-spawned children, not our Rust-side
            // CommandChild — so kill the native engine here to avoid an orphaned process.
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app.state::<engine::EngineState>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

/// Capture the full desktop as RGBA. Returns an 8-byte little-endian header
/// [width u32][height u32] followed by width*height*4 RGBA bytes, sent over
/// Tauri's binary IPC (no JSON serialization of the pixel buffer).
///
/// Wayland needs special handling: `xcap` relies on the `wlr-screencopy`
/// protocol, which KWin/Mutter do NOT expose (capture fails with "Cannot find
/// required wayland protocol"). So on Wayland we shell out to a desktop
/// screenshot tool and decode the PNG. X11/Windows/macOS capture directly via `xcap`.
#[tauri::command]
fn capture_frame() -> Result<tauri::ipc::Response, String> {
    let (width, height, rgba) = if is_wayland() {
        capture_wayland_cli()?
    } else {
        capture_xcap()?
    };

    let mut buf = Vec::with_capacity(8 + rgba.len());
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(&rgba);
    Ok(tauri::ipc::Response::new(buf))
}

fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var("WAYLAND_DISPLAY")
            .map(|v| !v.is_empty())
            .unwrap_or(false)
}

/// Direct grab via `xcap` (X11/Windows/macOS). Prefers the primary monitor and
/// falls back to the first one — on some setups `is_primary()` returns Err for
/// every monitor, so a strict filter would wrongly report "no monitor".
fn capture_xcap() -> Result<(u32, u32, Vec<u8>), String> {
    let monitors = Monitor::all().map_err(|e| format!("enumerate monitors: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitor found".to_string())?;
    let img = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;
    Ok((img.width(), img.height(), img.as_raw().clone()))
}

/// Env vars an AppImage's `AppRun` injects to point the *bundled* app at its own
/// libraries/modules. A *system* helper we shell out to (spectacle/grim/gnome-screenshot)
/// must NOT inherit them, or it resolves against the bundle instead of the system —
/// e.g. spectacle picks up the bundle's older `libwayland-client` and dies with
/// `undefined symbol: wl_display_create_queue_with_name` (exit 127), which is why the
/// AppImage build silently failed to capture while `tauri dev` (unpoisoned) worked.
const APPIMAGE_ENV_VARS: [&str; 10] = [
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_BACKEND",
    "GSETTINGS_SCHEMA_DIR",
    "GIO_EXTRA_MODULES",
];

/// A `Command` for a *system* binary, with the AppImage's bundle-pointing env stripped
/// so it resolves against the system exactly as if launched from a normal shell. Outside
/// an AppImage these vars are unset, so `env_remove` is a harmless no-op.
fn system_command(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    for var in APPIMAGE_ENV_VARS {
        cmd.env_remove(var);
    }
    cmd
}

/// Wayland fallback: run a desktop screenshot CLI to a temp PNG, then decode it
/// to RGBA. Candidates in priority order: spectacle (KDE) -> grim (wlroots) -> gnome-screenshot (GNOME).
/// The fullscreen flags grab the whole (multi-monitor) desktop.
fn capture_wayland_cli() -> Result<(u32, u32, Vec<u8>), String> {
    let path = std::env::temp_dir().join(format!("chessmenthol_shot_{}.png", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    // (binary, args with a "{path}" placeholder)
    let candidates: [(&str, &[&str]); 3] = [
        ("spectacle", &["-b", "-n", "-f", "-o", "{path}"]),
        ("grim", &["{path}"]),
        ("gnome-screenshot", &["-f", "{path}"]),
    ];

    let mut last_err =
        "no Wayland screenshot tool found (install spectacle, grim, or gnome-screenshot)".to_string();
    let mut ok = false;
    for (bin, args) in candidates {
        if which(bin).is_none() {
            continue;
        }
        let real: Vec<String> = args.iter().map(|a| a.replace("{path}", &path_str)).collect();
        match system_command(bin).args(&real).status() {
            Ok(status) if status.success() && path.exists() => {
                ok = true;
                break;
            }
            Ok(status) => last_err = format!("{bin} exited with {status} without producing an image"),
            Err(e) => last_err = format!("failed to run {bin}: {e}"),
        }
    }
    if !ok {
        return Err(format!("screenshot capture failed: {last_err}"));
    }

    // Decode then clean up regardless of decode success (no leftover temp file).
    let decoded = image::open(&path).map_err(|e| format!("decode screenshot PNG: {e}"));
    let _ = std::fs::remove_file(&path);
    let rgba = decoded?.to_rgba8();
    Ok((rgba.width(), rgba.height(), rgba.into_raw()))
}

/// Minimal `which`: first matching file for `bin` across PATH, if any.
fn which(bin: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(bin))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    /// The screenshot helper must strip every AppImage-injected env var, so a system
    /// tool (spectacle/grim/gnome-screenshot) never loads the bundle's libraries.
    #[test]
    fn system_command_strips_appimage_env() {
        let cmd = system_command("spectacle");
        // `get_envs()` yields (key, None) for each var scheduled for removal.
        let removed: Vec<_> = cmd
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_owned())
            .collect();
        for var in APPIMAGE_ENV_VARS {
            assert!(
                removed.iter().any(|k| k == OsStr::new(var)),
                "expected `{var}` to be stripped from the spawned system tool's env"
            );
        }
    }
}
