import { describe, it, expect } from 'vitest';
import { STATUS_TEXT } from './statusText';

describe('STATUS_TEXT', () => {
  it('has copy + a capture action for every non-analysis status', () => {
    for (const k of ['engine_unavailable', 'capture_denied', 'adapter_broke', 'no_board', 'unreadable'] as const) {
      expect(STATUS_TEXT[k].msg.length).toBeGreaterThan(10);
    }
    expect(STATUS_TEXT.unreadable.action).toBe('capture');
    expect(STATUS_TEXT.unreadable.msg).toMatch(/pieces/i);
    expect(STATUS_TEXT.engine_unavailable.action).toBeUndefined();
  });
});
