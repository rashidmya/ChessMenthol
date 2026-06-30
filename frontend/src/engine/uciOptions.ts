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

// Known limitation: if a `string`/`combo` default value contains a UCI keyword
// (min/max/var) surrounded by spaces, the keyword is misread as a token. This does
// not occur in any known real engine.
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
