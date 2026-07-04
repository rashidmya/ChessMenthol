import { describe, it, expect } from 'vitest';
import type { Command } from '@core/lib/types';

describe('harness', () => {
  it('resolves the @core alias to reused types', () => {
    const cmd: Command = { type: 'set_fen', fen: 'startpos' };
    expect(cmd.type).toBe('set_fen');
  });
});
