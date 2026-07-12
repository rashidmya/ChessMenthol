import { describe, it, expect } from 'vitest';
import { panelStatus } from './panelStatus';

const base = { lastError: null, visionStatus: 'idle' as const, adapterOk: true };

describe('panelStatus', () => {
  it('is analysis when nothing is wrong', () => {
    expect(panelStatus(base)).toBe('analysis');
  });
  it('engine-load errors win over everything', () => {
    expect(panelStatus({ ...base, lastError: 'engine failed to load: boom', visionStatus: 'no_board', adapterOk: false }))
      .toBe('engine_unavailable');
  });
  it('capture failures map to capture_denied', () => {
    expect(panelStatus({ ...base, lastError: 'capture failed: no permission' })).toBe('capture_denied');
  });
  it('a broken adapter beats a no_board vision status', () => {
    expect(panelStatus({ ...base, adapterOk: false, visionStatus: 'no_board' })).toBe('adapter_broke');
  });
  it('no_board when vision found nothing', () => {
    expect(panelStatus({ ...base, visionStatus: 'no_board' })).toBe('no_board');
  });
});
