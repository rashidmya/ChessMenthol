# Engine Management — Per-Engine UCI Options Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed global Lines/Threads/Memory controls with a generic, per-engine UCI options form driven by what each engine advertises in its `uci` output.

**Architecture:** A pure parser (`uciOptions.ts`) turns `option …` lines into a typed schema. A localStorage store (`engineOptions.ts`) caches each engine's schema + the user's changed-from-default overrides. The Rust `engine_validate` is generalized to `engine_probe(spec)` returning name + raw option lines; loaders capture option lines during the handshake. The engine controller applies an engine's overrides on load; the orchestrator's `set_engine_option` applies a live change via stop→setoption→restart. A new `EngineOptions.svelte` renders the form in EngineSettings (Search time stays an app control). MultiPV/Threads/Hash stop being special-cased.

**Tech Stack:** Svelte 5 (legacy `export let`), TypeScript, Vitest (jsdom + `@testing-library/svelte` + `vi.hoisted` mocks), Tauri 2 (Rust), `tauri-plugin-shell`/`tauri-plugin-dialog`.

**Spec:** `docs/superpowers/specs/2026-06-30-engine-options-panel-design.md` (read it for rationale + the 5 locked decisions).

---

## File structure

### Created
| File | Responsibility |
|---|---|
| `frontend/src/engine/uciOptions.ts` | Pure UCI option parser + `formatSetOption`. The ONLY option parser. |
| `frontend/src/lib/engineOptions.ts` | Per-engine schema cache + change-from-default overrides (localStorage); `effectiveValues`; `ensureSchema`. |
| `frontend/src/components/EngineOptions.svelte` | Engine-driven options form (spin/check/combo/string/button) for the selected engine. |
| `frontend/src/tests/uciOptions.test.ts` | Parser unit tests. |
| `frontend/src/tests/engineOptions.test.ts` | Store unit tests. |
| `frontend/src/tests/EngineOptions.test.ts` | Form UI tests. |

### Modified
| File | Change |
|---|---|
| `frontend/src-tauri/src/engine.rs` | `engine_validate`→`engine_probe(spec)` returning `{ name, option_lines }`; isolated spawn per spec; rename tests. |
| `frontend/src-tauri/src/lib.rs` | Register `engine::engine_probe` (was `engine_validate`). |
| `frontend/src/engine/engine.ts` | `UciEngine.options?: UciOption[]`; `configure`→generic `applyOptions`; `loadStockfish` captures option lines. |
| `frontend/src/engine/nativeEngine.ts` | Capture option lines during handshake; set `engine.options`. |
| `frontend/src/engine/session.ts` | Drop `lastMultipv` + `StartOptions.multipv`. |
| `frontend/src/lib/engineClient.ts` | Controller: cache schema + apply overrides on load; `setOption` for live change; drop threads/hash desired state (keep wasm Threads clamp). |
| `frontend/src/core/orchestrator.ts` | `setEngineOption`/`resetEngineOption`/`resetEngineOptions`; trim `setOptions` to depth/movetime; read MultiPV from the store. |
| `frontend/src/lib/types.ts` | Add `set_engine_option`/`reset_engine_option`/`reset_engine_options`; drop `multipv`/`threads`/`hash` from `set_options`. |
| `frontend/src/components/EngineList.svelte` | `engine_probe` + `setSchema` on add; `engineOptions.clear` on remove. |
| `frontend/src/components/EngineSettings.svelte` | Remove Lines/Threads/Memory rows; keep Search time; add `<EngineOptions>`. |
| `frontend/src/lib/options.ts` | Drop `DEFAULT_LINES`/`DEFAULT_THREADS`/`DEFAULT_MEMORY_INDEX`/`MEMORY_MB`. |
| Tests touching the old path | `nativeEngine`, `engineClientNative`, `orchestrator`, `EngineSettings`, `EngineList`, session-related. |

### Gates (run from the noted dir)
- `cd frontend && npx vitest run` — all green
- `cd frontend && npm run check` — 0 errors, 0 warnings
- `cd frontend/src-tauri && cargo build && cargo test` — compiles + Rust tests pass

---

## Task 1 — `uciOptions.ts`: the pure option parser (TDD)

**Files:** Create `frontend/src/engine/uciOptions.ts`, `frontend/src/tests/uciOptions.test.ts`.

### Steps

1. - [ ] Write the test first. Create `frontend/src/tests/uciOptions.test.ts`:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { parseOption, parseOptions, formatSetOption, type UciOption } from '../engine/uciOptions';

   describe('parseOption', () => {
     it('parses a spin option with default/min/max', () => {
       expect(parseOption('option name Threads type spin default 1 min 1 max 1024')).toEqual<UciOption>({
         name: 'Threads', type: 'spin', default: '1', min: 1, max: 1024,
       });
     });
     it('parses a check option', () => {
       expect(parseOption('option name Ponder type check default false')).toEqual<UciOption>({
         name: 'Ponder', type: 'check', default: 'false',
       });
     });
     it('parses a combo option with vars', () => {
       expect(parseOption('option name Style type combo default Normal var Solid var Normal var Risky')).toEqual<UciOption>({
         name: 'Style', type: 'combo', default: 'Normal', vars: ['Solid', 'Normal', 'Risky'],
       });
     });
     it('parses a string option (incl. <empty> default)', () => {
       expect(parseOption('option name SyzygyPath type string default <empty>')).toEqual<UciOption>({
         name: 'SyzygyPath', type: 'string', default: '<empty>',
       });
     });
     it('parses a button option (no default)', () => {
       expect(parseOption('option name Clear Hash type button')).toEqual<UciOption>({
         name: 'Clear Hash', type: 'button',
       });
     });
     it('keeps spaces in option names', () => {
       expect(parseOption('option name UCI_LimitStrength type check default false')?.name).toBe('UCI_LimitStrength');
       expect(parseOption('option name Use NNUE type check default true')?.name).toBe('Use NNUE');
     });
     it('returns null for non-option / malformed lines', () => {
       expect(parseOption('id name Stockfish 17.1')).toBeNull();
       expect(parseOption('uciok')).toBeNull();
       expect(parseOption('option name Foo')).toBeNull(); // no type
     });
   });

   describe('parseOptions', () => {
     it('parses many lines, skipping non-options and unparseable', () => {
       const lines = [
         'id name X', 'option name Threads type spin default 1 min 1 max 512',
         'garbage', 'option name Ponder type check default false', 'uciok',
       ];
       expect(parseOptions(lines).map((o) => o.name)).toEqual(['Threads', 'Ponder']);
     });
   });

   describe('formatSetOption', () => {
     it('formats value options', () => {
       expect(formatSetOption('Threads', 4)).toBe('setoption name Threads value 4');
       expect(formatSetOption('SyzygyPath', '/tb')).toBe('setoption name SyzygyPath value /tb');
     });
     it('formats booleans as true/false', () => {
       expect(formatSetOption('Ponder', true)).toBe('setoption name Ponder value true');
       expect(formatSetOption('Ponder', false)).toBe('setoption name Ponder value false');
     });
     it('formats a button (no value)', () => {
       expect(formatSetOption('Clear Hash', undefined)).toBe('setoption name Clear Hash');
     });
   });
   ```

2. - [ ] Run it; expect FAIL (no module):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/uciOptions.test.ts
   ```
   Expected: `Failed to resolve import "../engine/uciOptions"`.

3. - [ ] Implement. Create `frontend/src/engine/uciOptions.ts`:
   ```ts
   // frontend/src/engine/uciOptions.ts
   // Pure parser for UCI `option name … type …` advertisement lines, and the inverse
   // `setoption …` formatter. The ONLY place option lines are parsed.

   export type UciOptionType = 'spin' | 'check' | 'combo' | 'string' | 'button';

   export interface UciOption {
     name: string;
     type: UciOptionType;
     default?: string;   // raw engine-reported default token; absent for button
     min?: number;       // spin only
     max?: number;       // spin only
     vars?: string[];    // combo only
   }

   const TYPES: UciOptionType[] = ['spin', 'check', 'combo', 'string', 'button'];

   /**
    * Parse one `option name <N> type <t> [default <d>] [min <m>] [max <M>] [var <v>]…`.
    * Option names may contain spaces, so we split on the keyword tokens, not whitespace.
    * Returns null for non-`option` or malformed lines.
    */
   export function parseOption(line: string): UciOption | null {
     const t = line.trim();
     if (!t.startsWith('option name ')) return null;
     const afterName = t.slice('option name '.length);
     const typeIdx = afterName.indexOf(' type ');
     if (typeIdx < 0) return null;
     const name = afterName.slice(0, typeIdx).trim();
     if (!name) return null;
     const rest = afterName.slice(typeIdx + ' type '.length).trim();
     const toks = rest.split(/\s+/);
     const type = toks[0] as UciOptionType;
     if (!TYPES.includes(type)) return null;

     const opt: UciOption = { name, type };
     // default may be multi-word (rare); capture text between ` default ` and the next keyword.
     const def = between(rest, 'default', ['min', 'max', 'var']);
     if (def !== null) opt.default = def;
     const min = between(rest, 'min', ['max', 'var', 'default']);
     const max = between(rest, 'max', ['min', 'var', 'default']);
     if (min !== null && /^-?\d+$/.test(min)) opt.min = parseInt(min, 10);
     if (max !== null && /^-?\d+$/.test(max)) opt.max = parseInt(max, 10);
     if (type === 'combo') {
       const vars = [...rest.matchAll(/\bvar\s+([^]*?)(?=\s+var\s+|\s+(?:default|min|max)\s+|$)/g)]
         .map((m) => m[1].trim()).filter(Boolean);
       if (vars.length) opt.vars = vars;
     }
     return opt;
   }

   /** Text between ` <key> ` and the next of `stops` (or end). null if `key` absent. */
   function between(s: string, key: string, stops: string[]): string | null {
     const re = new RegExp(`\\b${key}\\s+`);
     const m = re.exec(s);
     if (!m) return null;
     const start = m.index + m[0].length;
     let end = s.length;
     for (const stop of stops) {
       const sm = new RegExp(`\\s${stop}\\s`).exec(s.slice(start));
       if (sm) end = Math.min(end, start + sm.index);
     }
     return s.slice(start, end).trim();
   }

   export function parseOptions(lines: string[]): UciOption[] {
     const out: UciOption[] = [];
     for (const l of lines) { const o = parseOption(l); if (o) out.push(o); }
     return out;
   }

   /** UCI line for a value change; a button (value === undefined) sends no value. */
   export function formatSetOption(name: string, value: string | number | boolean | undefined): string {
     if (value === undefined) return `setoption name ${name}`;
     const v = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
     return `setoption name ${name} value ${v}`;
   }
   ```

4. - [ ] Re-run; expect PASS:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/uciOptions.test.ts
   ```
   Expected: `Test Files 1 passed`.

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): uciOptions parser (option-line → typed schema, setoption formatter)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 2 — `engineOptions.ts`: per-engine schema + overrides store (TDD)

**Files:** Create `frontend/src/lib/engineOptions.ts`, `frontend/src/tests/engineOptions.test.ts`.

> `ensureSchema` (which probes/loads) is added in a later task once the probe exists; this task is the pure localStorage store.

### Steps

1. - [ ] Write the test first. Create `frontend/src/tests/engineOptions.test.ts`:
   ```ts
   import { describe, it, expect, beforeEach } from 'vitest';
   import {
     getSchema, setSchema, getOverrides, setOption, resetOption, resetAll,
     effectiveValues, clear, SCHEMA_KEY, OVERRIDES_KEY,
   } from '../lib/engineOptions';
   import type { UciOption } from '../engine/uciOptions';

   const schema: UciOption[] = [
     { name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 },
     { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 },
     { name: 'Ponder', type: 'check', default: 'false' },
     { name: 'Clear Hash', type: 'button' },
   ];

   describe('engineOptions', () => {
     beforeEach(() => localStorage.clear());

     it('caches + reads a schema per engine id', () => {
       expect(getSchema('e1')).toBeNull();
       setSchema('e1', schema);
       expect(getSchema('e1')).toEqual(schema);
       expect(JSON.parse(localStorage.getItem(SCHEMA_KEY)!).e1).toEqual(schema);
     });

     it('stores + reads overrides per engine id', () => {
       setOption('e1', 'Threads', '4');
       expect(getOverrides('e1')).toEqual({ Threads: '4' });
       expect(JSON.parse(localStorage.getItem(OVERRIDES_KEY)!).e1).toEqual({ Threads: '4' });
     });

     it('effectiveValues = engine defaults merged with overrides', () => {
       setSchema('e1', schema);
       setOption('e1', 'MultiPV', '3');
       expect(effectiveValues('e1')).toEqual({ Threads: '1', MultiPV: '3', Ponder: 'false' });
       // button (no default) is omitted; override wins over default.
     });

     it('resetOption / resetAll clear overrides', () => {
       setSchema('e1', schema);
       setOption('e1', 'Threads', '4'); setOption('e1', 'MultiPV', '3');
       resetOption('e1', 'Threads');
       expect(getOverrides('e1')).toEqual({ MultiPV: '3' });
       resetAll('e1');
       expect(getOverrides('e1')).toEqual({});
     });

     it('isolates engines by id', () => {
       setOption('e1', 'Threads', '4'); setOption('e2', 'Threads', '2');
       expect(getOverrides('e1')).toEqual({ Threads: '4' });
       expect(getOverrides('e2')).toEqual({ Threads: '2' });
     });

     it('clear() drops schema + overrides for one engine', () => {
       setSchema('e1', schema); setOption('e1', 'Threads', '4');
       setSchema('e2', schema);
       clear('e1');
       expect(getSchema('e1')).toBeNull();
       expect(getOverrides('e1')).toEqual({});
       expect(getSchema('e2')).toEqual(schema); // unaffected
     });

     it('falls back to empty on corrupt storage', () => {
       localStorage.setItem(SCHEMA_KEY, '{bad'); localStorage.setItem(OVERRIDES_KEY, '{bad');
       expect(getSchema('e1')).toBeNull();
       expect(getOverrides('e1')).toEqual({});
     });
   });
   ```

2. - [ ] Run it; expect FAIL (no module).
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineOptions.test.ts
   ```

3. - [ ] Implement. Create `frontend/src/lib/engineOptions.ts`:
   ```ts
   // frontend/src/lib/engineOptions.ts
   // Per-engine UCI option state in localStorage: the engine's advertised SCHEMA
   // (cached) and the user's OVERRIDES (only values changed from the engine default),
   // both keyed by engine id. Mirrors the engineRegistry localStorage idiom.
   import type { UciOption } from '../engine/uciOptions';

   export const SCHEMA_KEY = 'chessmenthol.engineSchema';     // { [id]: UciOption[] }
   export const OVERRIDES_KEY = 'chessmenthol.engineOptions'; // { [id]: { [name]: string } }

   function load<T>(key: string): Record<string, T> {
     try {
       const raw: unknown = JSON.parse(localStorage.getItem(key) || '{}');
       return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, T>) : {};
     } catch {
       return {};
     }
   }
   function save<T>(key: string, obj: Record<string, T>): void {
     try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* ignore */ }
   }

   export function getSchema(id: string): UciOption[] | null {
     return load<UciOption[]>(SCHEMA_KEY)[id] ?? null;
   }
   export function setSchema(id: string, schema: UciOption[]): void {
     const all = load<UciOption[]>(SCHEMA_KEY); all[id] = schema; save(SCHEMA_KEY, all);
   }
   export function getOverrides(id: string): Record<string, string> {
     return load<Record<string, string>>(OVERRIDES_KEY)[id] ?? {};
   }
   export function setOption(id: string, name: string, value: string): void {
     const all = load<Record<string, string>>(OVERRIDES_KEY);
     all[id] = { ...(all[id] ?? {}), [name]: value }; save(OVERRIDES_KEY, all);
   }
   export function resetOption(id: string, name: string): void {
     const all = load<Record<string, string>>(OVERRIDES_KEY);
     if (all[id]) { delete all[id][name]; save(OVERRIDES_KEY, all); }
   }
   export function resetAll(id: string): void {
     const all = load<Record<string, string>>(OVERRIDES_KEY);
     if (all[id]) { delete all[id]; save(OVERRIDES_KEY, all); }
   }

   /** Engine defaults (from schema) merged with overrides — what the form shows. */
   export function effectiveValues(id: string): Record<string, string> {
     const out: Record<string, string> = {};
     for (const o of getSchema(id) ?? []) if (o.default !== undefined) out[o.name] = o.default;
     return { ...out, ...getOverrides(id) };
   }

   /** Drop all stored state for one engine (called when the engine is removed). */
   export function clear(id: string): void {
     const s = load<UciOption[]>(SCHEMA_KEY); if (id in s) { delete s[id]; save(SCHEMA_KEY, s); }
     const o = load<Record<string, string>>(OVERRIDES_KEY); if (id in o) { delete o[id]; save(OVERRIDES_KEY, o); }
   }
   ```

4. - [ ] Re-run; expect PASS.
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineOptions.test.ts
   ```

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): engineOptions store (per-engine schema cache + overrides)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 3 — Rust: `engine_validate` → `engine_probe(spec)` (name + option lines)

Generalize the probe to take an `EngineSpec`, spawn an **isolated** process (not the
`EngineState` engine), and return the engine name **and** the raw `option …` lines.

**Files:** Modify `frontend/src-tauri/src/engine.rs`, `frontend/src-tauri/src/lib.rs`.

### Steps

1. - [ ] In `frontend/src-tauri/src/engine.rs`, replace the `EngineName` struct + `engine_validate` command + `validate_engine` helper with the probe versions. Read the current code first; replace that span with:
   ```rust
   /// What `engine_probe` returns: the engine's `id name` and its raw `option …` lines
   /// (parsed on the JS side by uciOptions.ts — Rust does not parse options).
   #[derive(serde::Serialize)]
   pub struct EngineProbe {
       pub name: String,
       pub option_lines: Vec<String>,
   }

   /// Probe a UCI engine described by `spec` (bundled sidecar OR external path): spawn it
   /// in ISOLATION from the live analysis engine (EngineState), send `uci`, collect the
   /// `id name` line and all `option …` lines until `uciok` (or timeout), then kill it.
   /// Used by "+ Add engine" (validation) and on-demand schema fetch for the options form.
   #[tauri::command]
   pub fn engine_probe(app: AppHandle, spec: EngineSpec) -> Result<EngineProbe, String> {
       match spec {
           EngineSpec::External { path } => probe_path(&path, Duration::from_secs(10)),
           EngineSpec::Bundled => {
               // Resolve the bundled sidecar's on-disk path so we can probe it with the
               // same sync std::process helper (isolated from EngineState).
               let path = bundled_sidecar_path(&app)?;
               probe_path(&path, Duration::from_secs(10))
           }
       }
   }

   /// Best-effort path to the bundled `stockfish` sidecar for the host. In a packaged
   /// build it sits next to the main executable; under `tauri dev` it's in
   /// `src-tauri/binaries/stockfish-<triple>`. Tries the packaged location first.
   fn bundled_sidecar_path(app: &AppHandle) -> Result<String, String> {
       use std::path::PathBuf;
       // Packaged: next to the current exe (Tauri installs the sidecar there, name `stockfish`).
       if let Ok(exe) = std::env::current_exe() {
           if let Some(dir) = exe.parent() {
               let p = dir.join(if cfg!(windows) { "stockfish.exe" } else { "stockfish" });
               if p.is_file() { return Ok(p.to_string_lossy().into_owned()); }
           }
       }
       // Dev: src-tauri/binaries/stockfish-<triple>
       let _ = app; // app currently unused in the dev branch; kept for future resource resolution
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
   /// kill. Timeout-parameterized for fast unit tests. (Same shape as the old validate_engine.)
   fn probe_path(path: &str, timeout: Duration) -> Result<EngineProbe, String> {
       let mut child = Command::new(path)
           .stdin(Stdio::piped())
           .stdout(Stdio::piped())
           .stderr(Stdio::null())
           .spawn()
           .map_err(|e| format!("spawn {path}: {e}"))?;

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
                       name: name.clone().unwrap_or_else(|| "UCI engine".to_string()),
                       option_lines: options.clone(),
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
   ```

2. - [ ] In `frontend/src-tauri/src/lib.rs`, change `engine::engine_validate` to `engine::engine_probe` in the `generate_handler!` list (keep the others).

3. - [ ] Update the Rust tests at the bottom of `engine.rs`: rename `validate_*` to `probe_*`, call `probe_path`, and add an option-lines assertion. Replace the `#[cfg(test)] mod tests` body with:
   ```rust
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
   ```

4. - [ ] Build + test:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build && cargo test
   ```
   Expected: `Finished` and `test result: ok. 4 passed`. (The frontend still calls `engine_validate` until Task 8 — runtime-only, exercised at the manual e2e; automated gates stay green because vitest mocks `invoke` and tsc doesn't type command names.)

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): engine_probe — name + option lines for any EngineSpec (isolated)

   Generalizes engine_validate to take an EngineSpec (bundled sidecar or external
   path), spawn isolated from the live engine, and return the id name plus raw
   option lines (parsed JS-side).

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 4 — Loaders capture option lines; `applyOptions` replaces `configure` (TDD)

Add `options?: UciOption[]` to `UciEngine`; have `loadStockfish` (wasm) and
`loadNativeEngine` (native) capture `option …` lines during the handshake and parse them
onto `engine.options`. Replace `configure(engine,{threads,hash})` with a generic
`applyOptions(engine, values, schema)`.

**Files:** Modify `frontend/src/engine/engine.ts`, `frontend/src/engine/nativeEngine.ts`, `frontend/src/tests/nativeEngine.test.ts`.

### Steps

1. - [ ] In `frontend/src/engine/engine.ts`: add `options?` to the interface, the import, replace `configure`, and capture in `loadStockfish`. Make these edits:

   a. Add the import at the top (after the file header comment):
   ```ts
   import { parseOptions, formatSetOption, type UciOption } from './uciOptions';
   ```

   b. Extend `UciEngine` (add the field after `dispose`):
   ```ts
   export interface UciEngine {
     send(cmd: string): void;
     onLine(cb: (line: string) => void): void;
     dispose(): void;
     /** Options the engine advertised during the `uci` handshake (when captured). */
     options?: UciOption[];
   }
   ```

   c. Replace the `configure` function with the generic applier:
   ```ts
   /** Send `setoption` for each value (skips buttons). `schema` gives each option's type
    *  so booleans/values format correctly; unknown names are skipped. */
   export function applyOptions(
     engine: UciEngine,
     values: Record<string, string>,
     schema: UciOption[],
   ): void {
     const byName = new Map(schema.map((o) => [o.name, o] as const));
     for (const [name, value] of Object.entries(values)) {
       const opt = byName.get(name);
       if (!opt || opt.type === 'button') continue;
       engine.send(formatSetOption(name, value));
     }
   }
   ```

   d. In `loadStockfish`, capture option lines during the handshake. Replace the handshake `await new Promise…` block with:
   ```ts
     const optionLines: string[] = [];
     await new Promise<void>((resolve, reject) => {
       const timer = setTimeout(() => {
         engine.dispose();
         reject(new Error(`stockfish failed to initialize within ${timeoutMs}ms`));
       }, timeoutMs);
       engine.onLine((line: string) => {
         if (line.startsWith('option name ')) optionLines.push(line);
         else if (line === 'uciok') { clearTimeout(timer); resolve(); }
       });
       engine.send('uci');
     });
     engine.options = parseOptions(optionLines);
   ```

2. - [ ] Update `frontend/src/tests/nativeEngine.test.ts` to (a) capture options and (b) keep existing behavior. Add an `option` line into the bundled-start test's stdout and assert `engine.options`. Modify the first test to feed option lines before `uciok` via the channel and assert parsing. Add this test to the `describe('loadNativeEngine')` block:
   ```ts
   it('captures advertised options during the handshake', async () => {
     invokeMock.mockImplementation(async (...a: unknown[]) => {
       const cmd = a[0] as string;
       const args = a[1] as { onLine?: { onmessage?: (m: string) => void } } | undefined;
       if (cmd === 'engine_start') queueMicrotask(() => {
         args?.onLine?.onmessage?.('option name Threads type spin default 1 min 1 max 8\nuciok');
       });
     });
     const engine = await loadNativeEngine({ kind: 'bundled' });
     expect(engine.options).toEqual([{ name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 }]);
   });
   ```

3. - [ ] Implement capture in `frontend/src/engine/nativeEngine.ts`. Add the import and capture option lines during the handshake. Add the import:
   ```ts
   import { parseOptions } from './uciOptions';
   ```
   Then in the handshake promise, collect option lines and set `engine.options` after resolve. Change the handshake block to:
   ```ts
     const optionLines: string[] = [];
     await new Promise<void>((resolve, reject) => {
       const timer = setTimeout(() => {
         engine.dispose();
         reject(new Error(`native engine failed to initialize within ${timeoutMs}ms`));
       }, timeoutMs);
       engine.onLine((line: string) => {
         if (line.startsWith('option name ')) optionLines.push(line);
         else if (line === 'uciok') { clearTimeout(timer); resolve(); }
       });
       engine.send('uci');
     });
     engine.options = parseOptions(optionLines);
   ```
   (Keep the rest of `loadNativeEngine` — the buffering, `send`/`onLine`/`dispose` — unchanged. Note: the post-`uciok` line-drop comment stays accurate.)

4. - [ ] `configure` is now `applyOptions` — its only caller was `engineClient.ts` (`configureEngine`). That caller is updated in Task 5; `npm run check` will flag it until then. Run only the loader tests here:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/nativeEngine.test.ts
   ```
   Expected: PASS (incl. the new capture test).

5. - [ ] Commit (do NOT run full `check` — the `configureEngine` caller is fixed in Task 5):
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): capture handshake options; applyOptions replaces configure

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 5 — Controller: cache schema + apply overrides on load; `setOption` for live change (TDD)

Replace the threads/hash desired-state path with: on load, cache the engine's schema and
apply its stored overrides; expose `setOption(name,value)` to push a single live change.
Preserve the single-threaded-wasm Threads clamp.

**Files:** Modify `frontend/src/lib/engineClient.ts`, `frontend/src/tests/engineClientNative.test.ts`.

### Steps

1. - [ ] In `frontend/src/lib/engineClient.ts`, update imports (line ~18-23): replace `configure as configureEngine` with `applyOptions` and add the stores + parser:
   ```ts
   import { loadStockfish, applyOptions, threadsAvailable } from '../engine/engine';
   import type { UciEngine } from '../engine/engine';
   import { loadNativeEngine } from '../engine/nativeEngine';
   import { get as getEngine, type EngineRecord } from './engineRegistry';
   import { getSchema, setSchema, getOverrides } from './engineOptions';
   import { formatSetOption } from '../engine/uciOptions';
   ```

2. - [ ] Replace the `clampThreads` helper + the `engineController` IIFE with a registry+options-driven version. The new controller:
   - keeps `desiredId` selection (unchanged from BYO);
   - on load, caches `engine.options` as the schema and applies that engine's overrides (clamping `Threads` for single-threaded wasm);
   - drops `configure({threads,hash})`/`desired`; adds `setOption(name, value)` (sends to the live engine) and `applyStored()` (re-applies all overrides);
   - the `OrchestratorEngine` shape changes: replace `configure` with `setOption`.

   Replace the whole `// ─── engine controller …` section through the closing `})();` with:
   ```ts
   // ─── engine controller (lazy loader) ──────────────────────────────────────

   // Single-threaded wasm (WebKitGTK asm.js) cannot honor Threads > 1, so clamp that
   // one option there. Native engines + threaded wasm pass through unchanged.
   function clampValue(name: string, value: string): string {
     if (name === 'Threads' && !isTauri() && !threadsAvailable()) return '1';
     return value;
   }

   export const engineController: OrchestratorEngine & {
     select(id: string): void;
     setOption(name: string, value?: string): void;
     ensureEngine(): Promise<UciEngine>;
     currentEngine(): UciEngine | null;
     dispose(): void;
   } = (() => {
     let engine: UciEngine | null = null;
     let loadPromise: Promise<UciEngine> | null = null;
     let desiredId = 'stockfish';

     function recordFor(id: string): EngineRecord {
       return getEngine(id) ?? getEngine('stockfish')!;
     }

     // Send this engine's stored overrides to the live engine (engine is idle here).
     function applyStored(): void {
       if (!engine) return;
       const schema = getSchema(desiredId) ?? engine.options ?? [];
       const overrides = getOverrides(desiredId);
       const clamped: Record<string, string> = {};
       for (const [n, v] of Object.entries(overrides)) clamped[n] = clampValue(n, v);
       applyOptions(engine, clamped, schema);
     }

     function load(id: string): Promise<UciEngine> {
       const rec = recordFor(id);
       const loader = isTauri()
         ? loadNativeEngine(
             rec.kind === 'external' && rec.path ? { kind: 'external', path: rec.path } : { kind: 'bundled' },
           )
         : loadStockfish();
       return loader.then((e) => {
         if (id !== desiredId) { e.dispose(); return load(desiredId); }
         engine = e;
         // Cache the freshly-advertised schema, then apply the user's overrides.
         if (e.options && e.options.length) setSchema(id, e.options);
         applyStored();
         return e;
       });
     }

     return {
       select(id: string): void {
         if (id !== desiredId) {
           desiredId = id;
           engine?.dispose();
           engine = null;
           loadPromise = null;
         }
       },

       // Push a single option change to the live engine (engine is idle: the orchestrator
       // stops the search before calling this and restarts after). No-op if not loaded.
       // `value === undefined` is a button press → `setoption name X` (no value).
       setOption(name: string, value?: string): void {
         if (!engine) return;
         engine.send(formatSetOption(name, value === undefined ? undefined : clampValue(name, value)));
       },

       ensureEngine(): Promise<UciEngine> {
         if (!loadPromise) {
           const p = load(desiredId);
           loadPromise = p;
           p.catch(() => { if (loadPromise === p) loadPromise = null; });
         }
         return loadPromise;
       },

       currentEngine(): UciEngine | null { return engine; },

       dispose(): void {
         engine?.dispose();
         engine = null;
         loadPromise = null;
         desiredId = 'stockfish';
       },
     };
   })();
   ```
   Note: the controller applies only overrides on load (the engine is already at its
   defaults for everything else — D4). `setOption` sends a single change directly
   (buttons pass `undefined` → no value); `clampValue` keeps Threads ≤ 1 on
   single-threaded wasm.

3. - [ ] Rewrite `frontend/src/tests/engineClientNative.test.ts` for the new controller. Keep the loader-selection + self-heal tests; replace the thread-clamp + configure tests with overrides-on-load + setOption tests. Replace the file with:
   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   const { loadNativeEngine, loadStockfish, isTauriMock } = vi.hoisted(() => {
     const fakeEngine = (options: unknown[] = []) => ({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options });
     return {
       loadNativeEngine: vi.fn(async (..._a: unknown[]) => fakeEngine([{ name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 }, { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 }])),
       loadStockfish: vi.fn(async (..._a: unknown[]) => fakeEngine()),
       isTauriMock: vi.fn(() => true),
     };
   });
   vi.mock('../engine/nativeEngine', () => ({ loadNativeEngine: (...a: unknown[]) => loadNativeEngine(...a) }));
   vi.mock('../engine/engine', async (orig) => ({
     ...(await orig<typeof import('../engine/engine')>()),
     loadStockfish: (...a: unknown[]) => loadStockfish(...a),
     threadsAvailable: () => false,
   }));
   vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => isTauriMock(), Channel: class {} }));
   vi.mock('../lib/capture', () => ({ hasNativeCapture: () => false, Capturer: class {} }));

   beforeEach(async () => {
     localStorage.clear();
     const { engineController } = await import('../lib/engineClient');
     engineController.dispose();
     loadNativeEngine.mockClear();
     loadStockfish.mockClear();
     isTauriMock.mockReturnValue(true);
   });

   describe('engineController loader selection', () => {
     it('loads the bundled native sidecar under Tauri', async () => {
       const { engineController } = await import('../lib/engineClient');
       await engineController.ensureEngine();
       expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'bundled' });
       expect(loadStockfish).not.toHaveBeenCalled();
     });

     it('loads the wasm engine in a plain browser', async () => {
       isTauriMock.mockReturnValue(false);
       const { engineController } = await import('../lib/engineClient');
       await engineController.ensureEngine();
       expect(loadStockfish).toHaveBeenCalledTimes(1);
     });

     it('passes an external engine path to the native loader', async () => {
       const { add } = await import('../lib/engineRegistry');
       add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
       const { engineController } = await import('../lib/engineClient');
       engineController.select('ext1');
       await engineController.ensureEngine();
       expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'external', path: '/opt/engines/foo' });
     });

     it('caches the advertised schema and applies stored overrides on load', async () => {
       const { setOption } = await import('../lib/engineOptions');
       setOption('stockfish', 'MultiPV', '3'); // user override
       const { engineController } = await import('../lib/engineClient');
       const engine = await engineController.ensureEngine();
       const { getSchema } = await import('../lib/engineOptions');
       expect(getSchema('stockfish')?.some((o) => o.name === 'MultiPV')).toBe(true); // schema cached
       expect(engine.send).toHaveBeenCalledWith('setoption name MultiPV value 3');   // override applied
       expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 1'); // no unchanged option sent
     });

     it('does not clamp Threads for the native engine', async () => {
       const { setOption } = await import('../lib/engineOptions');
       setOption('stockfish', 'Threads', '4');
       const { engineController } = await import('../lib/engineClient');
       const engine = await engineController.ensureEngine();
       expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 4');
     });

     it('clamps Threads to 1 for single-threaded wasm (browser)', async () => {
       isTauriMock.mockReturnValue(false);
       const { setOption } = await import('../lib/engineOptions');
       // wasm engine advertises Threads so the schema knows the type
       loadStockfish.mockResolvedValueOnce({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options: [{ name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 }] } as never);
       setOption('stockfish', 'Threads', '4');
       const { engineController } = await import('../lib/engineClient');
       const engine = await engineController.ensureEngine();
       expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 1');
       expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 4');
     });

     it('setOption sends a live change to the loaded engine', async () => {
       const { engineController } = await import('../lib/engineClient');
       const engine = await engineController.ensureEngine();
       (engine.send as ReturnType<typeof vi.fn>).mockClear();
       engineController.setOption('MultiPV', '2');
       expect(engine.send).toHaveBeenCalledWith('setoption name MultiPV value 2');
     });

     it('disposes + reloads when switching to a different engine id', async () => {
       const { add } = await import('../lib/engineRegistry');
       add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
       const { engineController } = await import('../lib/engineClient');
       const a = await engineController.ensureEngine();
       engineController.select('ext1');
       expect(a.dispose).toHaveBeenCalled();
       const b = await engineController.ensureEngine();
       expect(b).not.toBe(a);
     });
   });
   ```

4. - [ ] Run it; expect FAIL first (old controller), then implement (step 2 already), then PASS:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineClientNative.test.ts
   ```
   Expected: PASS after the controller replacement.

5. - [ ] `npm run check` will still flag `orchestrator.ts` (it calls `_engine.configure`) until Task 7. Do NOT run full check here. Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   refactor(engine): controller caches schema + applies overrides; setOption

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 6 — Session: drop the MultiPV special-case (TDD)

MultiPV now flows through the generic options path (applied by the controller), so the
session stops sending `setoption MultiPV`. It still reads `multipv` from info lines.

**Files:** Modify `frontend/src/engine/session.ts`, plus any session/orchestrator test that asserted the MultiPV setoption.

### Steps

1. - [ ] In `frontend/src/engine/session.ts`:
   - Change `StartOptions` to drop `multipv`:
     ```ts
     export interface StartOptions { depth: number | null; timeMs: number | null; }
     ```
   - Remove the `private lastMultipv = -1;` field.
   - In `launch`, remove the `if (opts.multipv !== this.lastMultipv) { … }` block (the two `setoption MultiPV` lines). Leave the rest of `launch` (position/go/phase) intact.

2. - [ ] Grep for `multipv` in tests + callers and fix compile/expectations:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && grep -rn "multipv\|StartOptions" src/tests src/engine src/core | grep -vi 'info\|parseInfo\|uci.ts'
   ```
   Update any `StartOptions` literal that passed `multipv` (e.g. in `orchestrator.ts` where it builds start options, and in tests) to drop that field. Remove test assertions expecting `setoption name MultiPV` from the session (those are now covered by `engineClientNative.test.ts`).

3. - [ ] Run the session-affected tests:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/session.test.ts src/tests/orchestrator.test.ts 2>/dev/null || npx vitest run
   ```
   Expected: the session no longer emits `setoption MultiPV`; affected tests pass. (Full check still pending Task 7.)

4. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   refactor(engine): session no longer special-cases MultiPV (generic options path)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 7 — Orchestrator + command surface: `set_engine_option` (TDD)

Replace the option-bits of `set_options` with generic per-engine option commands; keep
Search-time (`movetime`) + `depth`. A change stops, applies via the controller, restarts.

**Files:** Modify `frontend/src/core/orchestrator.ts`, `frontend/src/lib/types.ts`, `frontend/src/tests/orchestrator.test.ts`.

### Steps

1. - [ ] In `frontend/src/lib/types.ts`, update the `Command` union: remove `multipv`/`threads`/`hash` from `set_options` (keep `depth?`, `movetime?`), and add:
   ```ts
     | { type: 'set_engine_option'; name: string; value?: string }
     | { type: 'reset_engine_option'; name: string }
     | { type: 'reset_engine_options' }
   ```

2. - [ ] In `frontend/src/core/orchestrator.ts`:
   - Add imports:
     ```ts
     import { setOption as storeSetOption, resetOption as storeResetOption, resetAll as storeResetAll, effectiveValues } from '../lib/engineOptions';
     ```
   - Replace the option-bits of `setOptions` (the `multipv`/`threads`/`hash` handling + the `_engine.configure?.(…)` call) — keep `depth`/`movetime`. The trimmed `setOptions`:
     ```ts
     setOptions(cmd: { depth?: number; movetime?: number | null }): void {
       let depth = this._depth;
       if (cmd.depth != null) depth = cmd.depth;
       this._session.stop();
       this._depth = depth;
       if ('movetime' in cmd) {
         const mt = cmd.movetime;
         this._movetimeMs = mt === null || mt === 0 || mt === undefined ? null : mt;
       }
       this._restart();
     }
     ```
   - Remove the `_multipv` / `_threads` / `_hash` fields. Grep this file for `_multipv`,
     `_threads`, `_hash` and migrate **every** read:
     - `_multipv` → derive from the store:
       ```ts
       _currentMultipv(): number {
         const v = effectiveValues(this._engineId)['MultiPV'];
         const n = v != null ? parseInt(v, 10) : 1;
         return Number.isFinite(n) && n >= 1 ? n : 1;
       }
       ```
       Replace each `this._multipv` read (e.g. the serialize/state-frame site and the
       degenerate-line builder at the existing lines) with `this._currentMultipv()`.
     - `_threads` / `_hash` are no longer orchestrator state (Threads/Hash are now plain
       engine options). If a serialized state frame exposed `threads`/`hash`, read them from
       `effectiveValues(this._engineId)['Threads'|'Hash']` (or drop those frame fields if the
       UI no longer needs them) and update `core/serialize.ts` + its tests accordingly.
   - Add the new handlers:
     ```ts
     setEngineOption(name: string, value?: string): void {
       this._session.stop();              // go idle
       // Buttons (value === undefined) fire once and are NOT stored; valued options persist.
       if (value !== undefined) storeSetOption(this._engineId, name, value);
       if (this._engineStarted) this._engine.setOption?.(name, value);
       this._restart();
     }

     resetEngineOption(name: string): void {
       this._session.stop();
       storeResetOption(this._engineId, name);
       this._restart(); // engine default re-applies on the restart's reload path / next load
     }

     resetEngineOptions(): void {
       this._session.stop();
       storeResetAll(this._engineId);
       this._restart();
     }
     ```
     (Note: resets take full effect on the next engine (re)load; `_restart` restarts the search. If immediate re-application of defaults is desired without reload, that is acceptable to defer — the value persists and applies on next load. Keep this MVP behavior.)
   - In the command `handle(...)` switch, route the new command types to these methods, and update the `set_options` case to pass only `{ depth, movetime }`.
   - Update `OrchestratorEngine` (in this file): replace `configure?(opts…)` with `setOption?(name: string, value: string): void`.

3. - [ ] Update `frontend/src/tests/orchestrator.test.ts`: replace `set_options` tests that asserted threads/hash/multipv with `set_engine_option` tests. Key assertions: `set_engine_option {name:'MultiPV', value:'3'}` calls the engine's `setOption('MultiPV','3')` (or sends `setoption name MultiPV value 3`) and restarts; `set_options {movetime}` still restarts. Update the fake engine in the test (`fakeEngine()`) to expose `setOption: vi.fn()` instead of `configure`.

4. - [ ] Run the full suite — by now the whole app should compile + pass:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run && npm run check
   ```
   Expected: vitest `0 failed`; `npm run check` `0 errors, 0 warnings`. (EngineSettings still renders the old Lines/Threads/Memory controls + emits the old `set_options` fields — those fields are gone from the type, so EngineSettings WON'T type-check yet. If `npm run check` flags EngineSettings, that is expected and fixed in Task 10; run only vitest here and defer `check` to Task 10. Adjust: run `npx vitest run` only.)

   Run:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run
   ```

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): orchestrator set_engine_option (generic per-engine options)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 8 — EngineList: probe for schema on add; clear options on remove (TDD)

**Files:** Modify `frontend/src/components/EngineList.svelte`, `frontend/src/tests/EngineList.test.ts`.

### Steps

1. - [ ] In `frontend/src/components/EngineList.svelte`:
   - Import the store + parser:
     ```ts
     import { setSchema, clear as clearOptions } from '../lib/engineOptions';
     import { parseOptions } from '../engine/uciOptions';
     ```
   - In `addEngine`, change the `engine_validate` invoke to `engine_probe` (passing a spec) and cache the schema:
     ```ts
       const { name, option_lines } = await invoke<{ name: string; option_lines: string[] }>(
         'engine_probe', { spec: { kind: 'external', path } },
       );
       const record: EngineRecord = { id: crypto.randomUUID(), name, kind: 'external', path };
       add(record);
       setSchema(record.id, parseOptions(option_lines));
       refresh();
       onSetEngine(record.id);
     ```
   - In `removeEngine`, clear the engine's options after `remove`:
     ```ts
     function removeEngine(id: string): void {
       remove(id);
       clearOptions(id);
       refresh();
       if (id === engineId) onSetEngine('stockfish');
     }
     ```

2. - [ ] Update `frontend/src/tests/EngineList.test.ts`: the add-flow mock now returns `{ name, option_lines }` and asserts `engine_probe`. Change `invokeMock` default + the `engine_validate` assertions to `engine_probe` with `{ spec: { kind:'external', path } }`, and have the success mock return `{ name: 'Komodo 14', option_lines: ['option name Threads type spin default 1 min 1 max 8'] }`. Add an assertion that the schema is cached:
   ```ts
   // inside the successful add test, after the add resolves:
   const { getSchema } = await import('../lib/engineOptions');
   const id = onSetEngine.mock.calls[0][0];
   expect(getSchema(id)?.some((o) => o.name === 'Threads')).toBe(true);
   ```
   And in the remove test, assert options cleared:
   ```ts
   const { getSchema } = await import('../lib/engineOptions');
   // after removing ext1:
   expect(getSchema('ext1')).toBeNull();
   ```

3. - [ ] Run the EngineList tests:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/EngineList.test.ts
   ```
   Expected: PASS.

4. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): EngineList probes schema on add, clears options on remove

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 9 — `engineOptions.ensureSchema` + `EngineOptions.svelte` form (TDD)

Add `ensureSchema` (probe/load when not cached) and the form component.

**Files:** Modify `frontend/src/lib/engineOptions.ts`; create `frontend/src/components/EngineOptions.svelte`, `frontend/src/tests/EngineOptions.test.ts`.

### Steps

1. - [ ] Add to the TOP of `frontend/src/lib/engineOptions.ts` (alongside the existing
   `import type { UciOption }` line) the imports `ensureSchema` needs:
   ```ts
   import { invoke, isTauri } from '@tauri-apps/api/core';
   import { parseOptions } from '../engine/uciOptions';
   import { get as getEngineRecord } from './engineRegistry';
   ```
   Then add `ensureSchema` after `clear`:
   ```ts
   /** Ensure a schema is cached for `id`; probe via Tauri if missing. Never throws.
    *  In a plain browser there is no probe command, and a one-shot wasm load would build
    *  a Worker (unsupported under jsdom and wasteful), so we return [] — the controller
    *  caches the wasm engine's schema on its first real load instead. Desktop (the primary
    *  target) always has engine_probe, satisfying "options available before analysis". */
   export async function ensureSchema(id: string): Promise<UciOption[]> {
     const cached = getSchema(id);
     if (cached) return cached;
     const rec = getEngineRecord(id);
     if (!rec || !isTauri()) return [];
     try {
       const spec = rec.kind === 'external' && rec.path
         ? { kind: 'external', path: rec.path }
         : { kind: 'bundled' };
       const { option_lines } = await invoke<{ name: string; option_lines: string[] }>('engine_probe', { spec });
       const schema = parseOptions(option_lines);
       setSchema(id, schema);
       return schema;
     } catch {
       return [];
     }
   }
   ```

2. - [ ] Write the form test. Create `frontend/src/tests/EngineOptions.test.ts`:
   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';
   import { render, fireEvent } from '@testing-library/svelte';

   const { invokeMock, isTauriMock } = vi.hoisted(() => ({
     invokeMock: vi.fn(async () => ({ name: 'X', option_lines: [] as string[] })),
     isTauriMock: vi.fn(() => true),
   }));
   vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a), isTauri: () => isTauriMock() }));

   import EngineOptions from '../components/EngineOptions.svelte';
   import { setSchema, getOverrides } from '../lib/engineOptions';

   const schema = [
     { name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 },
     { name: 'Ponder', type: 'check', default: 'false' },
     { name: 'Style', type: 'combo', default: 'Normal', vars: ['Solid', 'Normal'] },
     { name: 'Clear Hash', type: 'button' },
   ];

   beforeEach(() => { localStorage.clear(); invokeMock.mockReset(); isTauriMock.mockReturnValue(true); });

   describe('EngineOptions', () => {
     it('renders a control per option from the cached schema', async () => {
       setSchema('stockfish', schema as never);
       const { findByLabelText, getByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand: vi.fn() } });
       expect(await findByLabelText('Threads')).toBeTruthy();      // spin → number
       expect(await findByLabelText('Ponder')).toBeTruthy();       // check → toggle
       expect(await findByLabelText('Style')).toBeTruthy();        // combo → select
       expect(getByText('Clear Hash')).toBeTruthy();               // button
     });

     it('editing a spin option stores the override and emits a command', async () => {
       setSchema('stockfish', schema as never);
       const onCommand = vi.fn();
       const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
       const input = (await findByLabelText('Threads')) as HTMLInputElement;
       await fireEvent.input(input, { target: { value: '4' } });
       await fireEvent.change(input);
       expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Threads', value: '4' });
       expect(getOverrides('stockfish')).toEqual({ Threads: '4' });
     });

     it('clamps a spin value to max', async () => {
       setSchema('stockfish', schema as never);
       const onCommand = vi.fn();
       const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
       const input = (await findByLabelText('Threads')) as HTMLInputElement;
       await fireEvent.input(input, { target: { value: '999' } });
       await fireEvent.change(input);
       expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Threads', value: '8' });
     });

     it('a button emits a valueless command', async () => {
       setSchema('stockfish', schema as never);
       const onCommand = vi.fn();
       const { getByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
       await fireEvent.click(getByText('Clear Hash'));
       expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Clear Hash' });
     });

     it('reset-all emits reset_engine_options', async () => {
       setSchema('stockfish', schema as never);
       const onCommand = vi.fn();
       const { getByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
       await fireEvent.click(getByText(/reset to defaults/i));
       expect(onCommand).toHaveBeenCalledWith({ type: 'reset_engine_options' });
     });

     it('fetches the schema when none is cached', async () => {
       invokeMock.mockResolvedValue({ name: 'X', option_lines: ['option name Threads type spin default 1 min 1 max 8'] });
       const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand: vi.fn() } });
       expect(await findByLabelText('Threads')).toBeTruthy();
       expect(invokeMock).toHaveBeenCalledWith('engine_probe', expect.anything());
     });
   });
   ```

3. - [ ] Run it; expect FAIL (no component).

4. - [ ] Implement. Create `frontend/src/components/EngineOptions.svelte`:
   ```svelte
   <script lang="ts">
     import type { Command } from '../lib/types';
     import type { UciOption } from '../engine/uciOptions';
     import { ensureSchema, effectiveValues, setOption, resetOption, resetAll } from '../lib/engineOptions';

     export let engineId: string = 'stockfish';
     export let onCommand: (cmd: Command) => void = () => {};

     let schema: UciOption[] = [];
     let values: Record<string, string> = {};
     let loading = true;
     let failed = false;

     async function load(): Promise<void> {
       loading = true; failed = false;
       schema = await ensureSchema(engineId);
       values = effectiveValues(engineId);
       failed = schema.length === 0;
       loading = false;
     }
     // Load on mount and whenever the selected engine changes (guarded against re-runs
     // from unrelated reactive updates).
     let lastId = '';
     $: void reloadFor(engineId);
     async function reloadFor(id: string): Promise<void> { if (id !== lastId) { lastId = id; await load(); } }

     function clampSpin(o: UciOption, raw: string): string {
       let n = parseInt(raw, 10);
       if (!Number.isFinite(n)) return o.default ?? '0';
       if (o.min != null) n = Math.max(o.min, n);
       if (o.max != null) n = Math.min(o.max, n);
       return String(n);
     }

     function change(o: UciOption, value: string): void {
       setOption(engineId, o.name, value);
       values = { ...values, [o.name]: value };
       onCommand({ type: 'set_engine_option', name: o.name, value });
     }
     function press(o: UciOption): void { onCommand({ type: 'set_engine_option', name: o.name }); }
     function reset(o: UciOption): void {
       resetOption(engineId, o.name);
       values = effectiveValues(engineId);
       onCommand({ type: 'reset_engine_option', name: o.name });
     }
     function resetEverything(): void {
       resetAll(engineId);
       values = effectiveValues(engineId);
       onCommand({ type: 'reset_engine_options' });
     }
   </script>

   <div class="opts">
     {#if loading}
       <div class="msg">loading options…</div>
     {:else if failed}
       <div class="msg" role="status">options unavailable for this engine</div>
     {:else}
       {#each schema as o (o.name)}
         <div class="orow">
           <label class="k" for={`opt-${o.name}`}>{o.name}</label>
           {#if o.type === 'spin'}
             <input id={`opt-${o.name}`} type="number" min={o.min} max={o.max}
               value={values[o.name] ?? o.default ?? ''}
               on:change={(e) => change(o, clampSpin(o, (e.currentTarget as HTMLInputElement).value))} />
           {:else if o.type === 'check'}
             <input id={`opt-${o.name}`} type="checkbox" aria-label={o.name}
               checked={(values[o.name] ?? o.default) === 'true'}
               on:change={(e) => change(o, (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')} />
           {:else if o.type === 'combo'}
             <select id={`opt-${o.name}`} aria-label={o.name}
               value={values[o.name] ?? o.default ?? ''}
               on:change={(e) => change(o, (e.currentTarget as HTMLSelectElement).value)}>
               {#each o.vars ?? [] as v (v)}<option value={v}>{v}</option>{/each}
             </select>
           {:else if o.type === 'string'}
             <input id={`opt-${o.name}`} type="text" value={values[o.name] ?? o.default ?? ''}
               on:change={(e) => change(o, (e.currentTarget as HTMLInputElement).value)} />
           {:else if o.type === 'button'}
             <button type="button" class="btn" on:click={() => press(o)}>{o.name}</button>
           {/if}
           {#if o.type !== 'button'}
             <button type="button" class="rst" aria-label={`Reset ${o.name}`} on:click={() => reset(o)}>↺</button>
           {/if}
         </div>
       {/each}
       <button type="button" class="resetall" on:click={resetEverything}>Reset to defaults</button>
     {/if}
   </div>

   <style>
     .opts { display: flex; flex-direction: column; gap: 6px; }
     .orow { display: flex; align-items: center; gap: 8px; }
     .orow .k { flex: 1; min-width: 0; font-family: var(--mono); font-size: 9.5px;
       letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3);
       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
     .orow input[type="number"], .orow input[type="text"], .orow select {
       width: 90px; font-family: var(--sans); font-size: 12px; color: var(--ink);
       background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 6px; padding: 4px 6px; }
     .orow .btn { font-family: var(--mono); font-size: 9.5px; text-transform: uppercase;
       border: 1px solid var(--keyline-2); background: var(--paper-2); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
     .orow .rst { flex: none; width: 22px; height: 22px; display: grid; place-items: center;
       border: 1px solid var(--keyline-2); background: var(--paper-2); border-radius: 6px; cursor: pointer; color: var(--ink-3); }
     .resetall { align-self: flex-start; font-family: var(--mono); font-size: 9.5px; text-transform: uppercase;
       color: var(--ink-2); background: transparent; border: 1px dashed var(--keyline-2); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
     .msg { font-family: var(--sans); font-size: 12px; color: var(--ink-3); padding: 4px 0; }
   </style>
   ```

5. - [ ] Run the form tests; expect PASS. Fix any Svelte a11y warning with a targeted `<!-- svelte-ignore -->` only if `npm run check` reports one (verified in Task 10).
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/EngineOptions.test.ts
   ```

6. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): EngineOptions form + ensureSchema (probe/load on demand)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 10 — Wire `EngineOptions` into `EngineSettings`; retire global option controls

**Files:** Modify `frontend/src/components/EngineSettings.svelte`, `frontend/src/lib/options.ts`, `frontend/src/tests/EngineSettings.test.ts`.

### Steps

1. - [ ] In `frontend/src/components/EngineSettings.svelte`:
   - Import `EngineOptions`; drop the now-unused options imports (`MEMORY_MB`, `DEFAULT_*` for lines/threads/memory). Keep `SEARCH_TIMES`, `DEFAULT_SEARCH_INDEX`.
   - Remove the **Lines**, **Threads**, and **Memory** `<div class="set-row">…</div>` rows and their `set_options` emits.
   - Keep the **Search time** row (emits `set_options { movetime }` — confirm it does not also send the removed fields).
   - Add the options form below the engine picker / search time:
     ```svelte
     <div class="set-col">
       <span class="k">Engine options</span>
       <EngineOptions {engineId} {onCommand} />
     </div>
     ```
   - Remove now-unused local state (`lines`, `threads`, `memory*`) tied to the deleted rows.

2. - [ ] In `frontend/src/lib/options.ts`, delete `DEFAULT_LINES`, `DEFAULT_THREADS`, `DEFAULT_MEMORY_INDEX`, and `MEMORY_MB` (and `memoryLabel` if it only served Memory). Keep `SearchTime`, `SEARCH_TIMES`, `DEFAULT_SEARCH_INDEX`, `searchLabel`.

3. - [ ] In `frontend/src/tests/EngineSettings.test.ts`: drop the Lines/Threads/Memory slider assertions; keep the Search-time test. Add a smoke assertion that `<EngineOptions>` renders (e.g. the "Engine options" label is present). Under jsdom `isTauri()` is false, so `ensureSchema` short-circuits to `[]` and the form shows "options unavailable" — no probe/Worker runs, so no extra mocking is required (the existing test setup is sufficient). If the test file does mock `@tauri-apps/api/core`, keep `isTauri` returning false.

4. - [ ] Gates:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npm run check
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run
   ```
   Expected: `npm run check` 0 errors/0 warnings (resolve any a11y warning in `EngineOptions.svelte` with a targeted `<!-- svelte-ignore <rule> -->`); vitest all green (incl. `smoke.test.ts` — App renders the new options panel under jsdom with `isTauri() === false`).

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): EngineSettings uses EngineOptions; retire global option sliders

   Replaces the fixed Lines/Threads/Memory controls with the engine-driven options
   form; Search time stays an app control. Drops the dead options.ts constants.

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 11 — Full gate sweep

**Files:** none (verification only).

### Steps

1. - [ ] Frontend tests + type/lint:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run && npm run check
   ```
   Expected: `0 failed`; `0 errors, 0 warnings`.

2. - [ ] Rust build + tests:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build && cargo test
   ```
   Expected: `Finished`; `test result: ok. 4 passed`.

3. - [ ] Grep for dead references to the retired path:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && grep -rn "engine_validate\|configure(\|DEFAULT_LINES\|DEFAULT_MEMORY\|MEMORY_MB\|lastMultipv\|set_options.*multipv" src | grep -v node_modules || echo "  clean"
   ```
   Expected: `clean` (no stale references).

4. - [ ] If a gate surfaced a fix, commit it with a `fix(engine): …` message + the standard trailer. Otherwise no commit.

---

## Task 12 — Manual e2e (human gate)

**Files:** none (manual verification). Run the desktop app per project memory.

### Steps

1. - [ ] Launch:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
   ```
2. - [ ] Open engine settings. Confirm an **Engine options** form renders for **Stockfish 18** with controls matching its advertised options (Threads, Hash, MultiPV, Skill Level, …) and **Search time** still present.
3. - [ ] Set **MultiPV = 3**; enable Analysis → confirm **3 lines** stream (the option took effect via stop+restart). Set MultiPV back to 1 → 1 line.
4. - [ ] Change **Threads** → confirm analysis restarts and uses the new value (nps changes); change **Hash** similarly.
5. - [ ] Add the external **Stockfish 17.1** (`/home/buga/uci-engines/stockfish-17.1`); open its options → confirm its own schema (incl. MultiPV) renders independently; set MultiPV=3 → 3 lines.
6. - [ ] Add **Viridithas** (`/home/buga/uci-engines/viridithas-20`); open its options → confirm **no MultiPV control** appears (engine doesn't advertise it) and analysis shows 1 line — correct, not a bug.
7. - [ ] Switch back to Stockfish → confirm its MultiPV=3 override persisted (still 3 lines); per-engine isolation holds.
8. - [ ] Click a **button** option (e.g. Clear Hash) → no error; **Reset to defaults** → controls return to engine defaults.
9. - [ ] Restart the app → confirm per-engine option overrides persisted (localStorage).
10. - [ ] Record the result in the migration memory note and mark this gate passed.

---

## Self-review / coverage

| Spec section | Covered by |
|---|---|
| §4.1 `uciOptions.ts` parser + `formatSetOption` | Task 1 |
| §4.2 `engineOptions.ts` store (schema/overrides/effectiveValues/clear) | Task 2 (+ `ensureSchema` Task 9) |
| §4.3 Rust `engine_probe(spec)` (name + raw option lines, isolated) | Task 3 |
| §6 loaders capture options; `applyOptions` replaces `configure` | Task 4 |
| §3/§5 controller caches schema + applies overrides on load; `setOption`; wasm Threads clamp | Task 5 |
| §6 session drops MultiPV special-case | Task 6 |
| §5/§6 orchestrator `set_engine_option`/reset; trim `set_options`; read MultiPV from store; command types | Task 7 |
| §5 add-flow probe→schema; remove→clear | Task 8 |
| §4.4/§5 `EngineOptions.svelte` form (each control type, reset, loading/unavailable, ensureSchema) | Task 9 |
| §6 wire into EngineSettings; retire global controls + options.ts constants | Task 10 |
| §8 gates | Task 11 |
| §7/manual | Task 12 |

### Verification points (confirm during impl)
- **Rust bundled-sidecar path resolution** (Task 3 `bundled_sidecar_path`): packaged = next-to-exe `stockfish`; dev = `binaries/stockfish-<triple>`. If neither resolves on the target, the bundled options form falls back to "options unavailable" (the engine still runs); the on-load capture in Task 4 also caches the bundled schema once analysis starts. Confirm the dev path works in the e2e.
- **`OrchestratorEngine` interface change** (`configure` → `setOption`): the controller's public type already exposes `setOption` (Task 5). Confirm no other consumer referenced `configure`.
- **MultiPV reads** in orchestrator (serialize/state frame): replaced by `_currentMultipv()` reading the store. Confirm every `this._multipv` site is migrated (grep in Task 11).
- **EngineSettings `onCommand`/`engineId` props**: `EngineOptions` reuses the same `onCommand` the sliders used and the `engineId` already in scope. Confirm names match the actual component.

### Out of scope (per spec §9)
Curated downloads (Phase 3b); option presets import/export; per-position options; moving Search-time/depth into the form; inter-option constraint validation; auto-seeded defaults.
