// app/src/lib/platform.ts
// Single source of truth for "are we on a Tauri mobile (Android/iOS) shell?".
// Reads the OS plugin's synchronous platform() but only inside Tauri, and never
// throws — a plain browser (or a context where the OS plugin isn't registered)
// simply reads as "not mobile".
import { platform } from '@tauri-apps/plugin-os';
import { isTauri } from '@tauri-apps/api/core';

/** True only inside a Tauri mobile (Android/iOS) shell; false everywhere else. */
export function isMobile(): boolean {
  if (!isTauri()) return false;
  try {
    const p = platform();
    return p === 'android' || p === 'ios';
  } catch {
    return false;
  }
}
