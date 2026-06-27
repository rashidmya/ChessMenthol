# Milestone 5b — Region Select — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning
**Parent:** Milestone 5 (Polish + packaging), decomposed into M5a (interaction & correction, done), M5b (this), M5c (packaging).

## 1. Overview

M5b lets the user **point ChessMenthol at a specific rectangle of the screen** instead of the whole
primary monitor, so detection can ignore everything but the board (useful when there are multiple
boards, browser chrome, or a small board on a large desktop). The user drags the rectangle on a
**custom fullscreen overlay** — our own code, identical on every OS — and the chosen region is then
re-used by **on-demand capture**.

Two product decisions made during brainstorming shape this milestone and shrink it dramatically:

1. **Custom overlay, not an OS-native picker.** We show a pixel-perfect fullscreen screenshot and let
   the user drag a box on it. It *feels* like selecting on the live desktop but is one HTML/JS
   implementation everywhere, and — unlike every OS-native region picker — it yields persistent
   `left/top/width/height` coordinates, which is exactly what we need.
2. **On-demand capture is the only capture model.** Continuous auto-tracking (shipped in M4c) is
   **removed**. With no 300 ms poll there is no need for a streaming capture path, which is what made
   Wayland hard — a single screenshot per capture is enough, and single-shot capture is solvable on
   every platform with no heavy dependency.

The result: the vision feature finally works on the developer's own machine (KDE/Wayland), it is one
overlay implementation for all OSes, and it adds **no new dependency** (the Wayland single-shot shells
out to a screenshot CLI that ships with the desktop, not PipeWire/GStreamer).

## 2. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Selection mechanism | **Custom fullscreen web overlay.** One full-desktop screenshot shown pixel-for-pixel; the user drags a box; we map it to real desktop pixels. Same component in the pywebview window and in a browser (via the Fullscreen API). The OS-native pickers (Spectacle/portal) were rejected because they return only a cropped *image*, never reusable coordinates. |
| Capture model | **On-demand only.** Continuous auto-tracking is dropped entirely (see §4.3 for what is removed). The Source controls become **Region** (pick) + **Capture** (grab + detect now). |
| Coordinate space | The region is stored **relative to the full-desktop screenshot's pixel grid**, not absolute screen geometry. The overlay shows that exact image, so a capture just re-grabs the full desktop and slices the same pixel rectangle — no screen-origin / multi-monitor offset math. |
| Wayland capture | **Why it's different at all:** X11/Windows/macOS expose a direct "read the screen" API that any process can call (`mss` wraps each); Wayland deliberately has *no* such API — capture is brokered by the compositor through **xdg-desktop-portal**. So `grab_full_desktop()` has exactly two implementations: `mss` (X11/Win/macOS) and the portal `Screenshot` (Wayland). Both return one identical BGR frame. |
| Wayland mechanism | A **screenshot CLI** — first present of `spectacle -b -n -f -o` (KDE), `grim` (wlroots), `gnome-screenshot -f` (GNOME) — shelled out to for one frame. **Zero new dependency** (the binaries ship with each desktop; `spectacle` is proven to return real pixels on the dev's machine), so it bundles cleanly with PyInstaller. The portal `Screenshot` D-Bus path (`jeepney`) is a documented future enhancement for desktops without a screenshot CLI, not built in M5b. A short spike (§4.2) confirms the chosen CLI before building on it. |
| Screenshot transport | A one-shot **`region_shot` server→client frame** carrying a downscaled JPEG (base64) plus the *true* full-desktop pixel dimensions, over the existing WebSocket. No new HTTP route. |

The earlier comparison prototypes (`build_inapp_demo.py` / `inapp_demo.html`, `native_overlay_demo.py`)
are saved under `.superpowers/brainstorm/m5b/` (gitignored).

## 3. Architecture

M5b touches the existing layers and adds no new ones; it also **removes** a layer (the tracking
thread).

- **Capture (`chessmenthol/vision/capture.py`)** — backends gain a single-shot full-desktop grab; a
  new Wayland screenshot-CLI backend; the `Capturer` selects the backend and owns region cropping (§4).
- **Tracker (`chessmenthol/vision/tracker.py`)** — unchanged pipeline (detect → crop_squares →
  classify → assemble); it simply grabs a cropped full-desktop frame now. `grab_if_changed` (the
  change-detection used only by the continuous loop) is removed.
- **Server (`chessmenthol/server/orchestrator.py`)** — drop the continuous-tracking machinery; add
  `request_region_shot` / `set_region` / `clear_region` commands; `capture_now` becomes a synchronous
  grab→crop→detect→apply (§5).
- **Frontend (`frontend/src/`)** — new `RegionOverlay.svelte`; Source controls reworked; small `App`
  wiring and a pure `lib/region.ts` for coordinate mapping (§6).

## 4. Capture layer

### 4.1 `grab_full_desktop()` and the backend Protocol
Redefine `CaptureBackend` around a single-shot full-frame grab rather than a region grab:

```
class CaptureBackend(Protocol):
    def list_monitors(self) -> list[Monitor]: ...
    def grab_full(self) -> np.ndarray:   # full virtual desktop, BGR (H,W,3)
        ...
```

`Capturer` owns the region:
- `set_region(region: Region | None)` — stores an **image-relative** rectangle (pixels of the
  full-desktop grab). `None` = whole desktop.
- `grab() -> Frame` — calls `backend.grab_full()`, then, if a region is set, slices
  `image[top:top+height, left:left+width]`. `Frame.origin` is set to `(region.left, region.top)` (or
  `(0, 0)`) so detection/overlay coordinates remain consistent.

`MssBackend.grab_full()` grabs `sct.monitors[0]` (the virtual all-monitors rect). The previous
per-region mss grab is dropped — capture is on-demand, so grabbing the full desktop and slicing in
NumPy is plenty fast and keeps both backends uniform. `select_monitor` is retained for the
`chessmenthol-detect` CLI (selects which rect `grab_full` returns); the region feature always uses
the whole virtual desktop.

### 4.2 `WaylandShotBackend` (Wayland)
New backend used when the session is Wayland. `grab_full()` shells out to the **first available**
screenshot CLI, writing to a temp PNG, then `cv2.imread`s it (BGR) and deletes the file:
1. `spectacle -b -n -f -o <tmp>` (KDE — proven to return real pixels on the dev's machine),
2. `grim <tmp>` (wlroots: Sway/Hyprland),
3. `gnome-screenshot -f <tmp>` (GNOME).

The chosen command is discovered once via `shutil.which` and cached. The backend takes an injectable
`runner` (defaulting to `subprocess.run`) and `which` so tests never spawn a real process. **No new
Python dependency** — the screenshot binary ships with the desktop. (The portal `Screenshot` D-Bus
path via a pure-Python client like `jeepney` is a documented future enhancement for desktops lacking
any screenshot CLI; it is **out of scope for M5b**.)

**Spike first (plan task 0):** a throwaway script that runs the discovered CLI non-interactively and
confirms it returns real pixels (and prompts no GUI), before the backend is built. This de-risks the
only OS-dependent piece.

### 4.3 Backend selection
`Capturer.__init__` picks the backend:
- Linux + `XDG_SESSION_TYPE == "wayland"` → `WaylandShotBackend`.
- Otherwise → `MssBackend`.
- Safety net: if `MssBackend.grab_full()` returns an all-black frame (std ≈ 0) on Linux, fall back to
  `WaylandShotBackend` once and remember the choice. (Covers Wayland sessions that don't set the env var.)

A backend may still be injected for tests (the Protocol is unchanged in spirit — a `FakeBackend`
implements `grab_full`).

### 4.4 Removed (continuous tracking, from M4c)
- `chessmenthol/server/tracking.py` `TrackingLoop` — **deleted** (daemon thread, `grab_if_changed`
  polling).
- `Capturer.grab_if_changed` and `_downsample`, `Tracker.grab_if_changed`.
- `Orchestrator`: `set_auto` / `_set_auto`, `_ensure_loop` simplifies to lazy `Tracker` creation, the
  `_tracking` flag, the `_PAUSE_ON_TRACKING` gate, and `self._lock` + the re-entrant `_on_tracked`
  locking. With capture handled synchronously in the command path, the only remaining concurrency is
  the analysis worker thread calling `_on_update` (pre-existing, unchanged, never lock-guarded), so
  the tracking lock is no longer needed.

## 5. Server changes

### 5.1 New / changed commands
- **`request_region_shot`** — grab the full desktop (`tracker`/`capturer.grab_full`), downscale to
  ≤ 2560 px wide, JPEG-encode, base64, and send a `region_shot` frame (§5.2). Lazily creates the
  tracker/capturer like `capture_now` does.
- **`set_region` `{left, top, width, height}`** — validate (positive size, within the last shot's
  dimensions), store on the capturer, then immediately run one capture (grab→crop→detect→apply) so
  selecting a region updates the board.
- **`clear_region`** — `capturer.set_region(None)`; re-emit state.
- **`capture_now`** (kept) — synchronous: `tracker.detect_position()` → if a legal board is found,
  `_apply_fen`; else report `visionStatus: "no_board"`. No loop, no thread.

`request_region_shot`, `set_region`, `clear_region`, and `capture_now` are vision commands handled in
`handle` without the (now removed) lock.

### 5.2 New server→client frame
```
{ type: "region_shot", jpegBase64: string, width: number, height: number }
```
`width`/`height` are the **true** full-desktop pixel dimensions (e.g. 5120×1440); the JPEG may be
downscaled for transport. The client maps drag coordinates back to true pixels using these.

### 5.3 State-frame changes
`_state_frame` drops `tracking`; updates `visionStatus`; adds `region`:
- Remove `"tracking"` (bool).
- `visionStatus`: `"idle" | "capturing" | "found" | "no_board" | "low_confidence"` — transient
  per-capture status rather than an ongoing tracking state.
- Add `region: { left, top, width, height } | null` so the UI reflects the active region and can
  enable **Clear**.
- Keep `detectedOrientation`, `lowConfidence`.

`_on_tracked` is simplified to a synchronous `_apply_detection(assembled)`: legal → set status
`found`/`low_confidence` + `_apply_fen` when placement changed; `None`/illegal → status `no_board`.

## 6. Frontend

### 6.1 `RegionOverlay.svelte` (new)
A fullscreen, fixed-position overlay shown while picking. Triggered by the **Region** button:
- On open, request fullscreen on the overlay element (`requestFullscreen`, allowed because it runs in
  the Region-button click gesture; in the pywebview window this is a no-op cover) and send
  `request_region_shot`.
- On the `region_shot` frame, render the JPEG to fill the viewport (`object-fit: contain`), with a
  drag-to-draw selection rectangle and a live `W×H` readout (logic ported from the prototype).
- **Use region:** map the displayed-pixel box → true-desktop-pixel `Region` via `lib/region.ts`, send
  `set_region`, close + exit fullscreen.
- **Cancel / Esc:** close without sending anything.

### 6.2 `lib/region.ts` (new, pure)
`toDesktopRegion(box, displayed, real)` — given the drag box in displayed-image pixels, the displayed
image size, and the true desktop size, return `{left, top, width, height}` in true desktop pixels
(clamped to bounds, normalized so width/height are positive). Pure and unit-tested.

### 6.3 `Controls.svelte` (changed — Source section)
- **Remove** the `Auto ●` button and all `tracking` props.
- **Enable** the **Region** button (currently `disabled`) → opens the overlay.
- Keep **Capture** → `capture_now`.
- Add **Clear** (region) → `clear_region`, shown/enabled only when `region` is set.
- `vision-status` text updated to the new `visionStatus` values (e.g. `found ●`, `no board`,
  `● N uncertain`, `capturing…`).

### 6.4 `App.svelte` (wiring)
- Remove the `tracking`-gated orientation follow; instead follow `detectedOrientation` after a capture
  that found a board (still suppressed by `manualFlip`).
- Remove the `set_auto:false` "freeze" sent when entering edit mode (no Auto to pause).
- Own `pickingRegion` state; render `RegionOverlay` when true; pass the latest `region_shot` payload
  into it. Pass `region` from the state frame to `Controls`.

### 6.5 `lib/types.ts`
- `StateFrame`: drop `tracking`; widen `visionStatus`; add `region`.
- Add `RegionShotFrame` to `ServerFrame`.
- `Command`: remove `set_auto`; add `request_region_shot`, `set_region`, `clear_region` (keep
  `capture_now`).
- `lib/ws.ts`: route `region_shot` frames to a `regionShot` store (separate from `state`).

## 7. Data flow

- **Pick region:** Region click → `request_region_shot` → server `grab_full` → `region_shot` frame →
  overlay shows it fullscreen → drag → Use → `toDesktopRegion` → `set_region` → server stores +
  captures once → board updates.
- **Capture:** Capture click → `capture_now` → `grab_full` → crop to region → detect → classify →
  assemble → legal+changed → `_apply_fen` → analyze; else `visionStatus: no_board`.
- **Clear:** Clear click → `clear_region` → next capture uses the whole desktop.

## 8. Error handling

- **No board in the region:** `visionStatus: "no_board"`; the working board is left untouched (never
  overwritten with an illegal/empty position) — same conservatism as M4c.
- **Wayland capture unavailable:** if both the portal and every CLI fallback fail, `grab_full` raises;
  the command emits an `error` frame (`"screen capture unavailable on this session"`) instead of
  crashing.
- **Bad region:** a zero/negative or out-of-bounds region is rejected by `set_region` with an `error`;
  the previous region (or full desktop) stays in effect.
- **Overlay without a shot:** the overlay shows a "capturing…" state until the `region_shot` arrives;
  Cancel/Esc always closes cleanly.
- **Permission prompt (Wayland):** the first portal `Screenshot` may prompt once; subsequent grabs are
  silent. The spike (§4.2) confirms the exact behavior.

## 9. Testing strategy (TDD)

- **Pure unit (`lib/region.ts`):** displayed→desktop mapping for a centered box, an edge-clamped box,
  a reversed drag (drag up-left), and a downscaled-display ratio; width/height always positive.
- **Capture (`Capturer`) with a `FakeBackend`:** `grab_full` + no region → full frame; with a region →
  correct slice and `Frame.origin`; backend selection picks `MssBackend` off-Wayland and `WaylandShotBackend`
  on Wayland (env injected); black-frame fallback triggers once.
- **WaylandShotBackend:** with a fake `which`/`runner`, `grab_full` picks the first available CLI,
  invokes it with the temp path, and returns the image the runner "wrote"; raises a clear error when no
  CLI is found. (Real screenshot CLI exercised only by the manual spike.)
- **Server:** `request_region_shot` emits a `region_shot` frame with true dims; `set_region` stores +
  captures and rejects bad rectangles; `clear_region` resets; `capture_now` applies a legal detection
  and reports `no_board` otherwise; assert the continuous-tracking commands/threads are gone (no
  `set_auto`, no loop).
- **Component:** Region opens the overlay; overlay drag emits the expected `set_region`; Clear emits
  `clear_region` and only shows when a region is set; status text renders each `visionStatus`.
- Reuse existing server/vision fakes and the frontend test setup; update tests that referenced
  `tracking`/`set_auto`/`TrackingLoop`.

## 10. Dependencies & PyInstaller

- **No new Python dependency.** `WaylandShotBackend` shells out to a screenshot binary that ships with
  the desktop (`spectacle`/`grim`/`gnome-screenshot`) — nothing to bundle, no native build (unlike
  PipeWire/GStreamer, which this design specifically avoids). The optional future portal-D-Bus path
  would add one pure-Python dep (`jeepney`) but is out of scope here.
- No change for Windows/macOS/X11 — `mss` already covers them.
- The `.onnx` model and Stockfish/static `--add-data` notes from earlier milestones are unchanged and
  still apply to M5c.

## 11. Out of scope (later milestones / passes)

- Continuous / streaming capture and PipeWire ScreenCast (explicitly dropped — on-demand only).
- Per-monitor or multi-region selection UI (single rectangle on the whole virtual desktop is enough).
- Persisting the chosen region across app restarts (no settings file yet; a later polish pass).
- PyInstaller packaging → win/linux/macos executables (M5c).
