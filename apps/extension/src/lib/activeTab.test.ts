import { describe, it, expect, vi } from 'vitest';
import { getMyWindowId, requestPosition, isFromActiveTab, onActiveTabChanged, type TabsApi } from './activeTab';

const POS = { kind: 'position', site: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white', turn: 'w' };

function api(over: Partial<TabsApi> = {}): TabsApi {
  return {
    windows: { getCurrent: async () => ({ id: 5 }), onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() }, WINDOW_ID_NONE: -1 },
    tabs: {
      query: vi.fn(async () => [{ id: 42 }]),
      sendMessage: vi.fn(async () => POS),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    ...over,
  };
}

describe('getMyWindowId', () => {
  it('returns the current window id', async () => { expect(await getMyWindowId(api())).toBe(5); });
  it('is null when the windows API is unavailable (plain-browser dev / tests)', async () => {
    expect(await getMyWindowId({})).toBeNull();
    expect(await getMyWindowId(api({ windows: { getCurrent: async () => { throw new Error('nope'); } } }))).toBeNull();
    expect(await getMyWindowId(api({ windows: { getCurrent: async () => ({}) } }))).toBeNull();
  });
});

describe('requestPosition', () => {
  it('asks the active tab of the given window and returns its position', async () => {
    const a = api();
    expect(await requestPosition(a, 5)).toEqual(POS);
    expect(a.tabs!.query).toHaveBeenCalledWith({ active: true, windowId: 5 });
    expect(a.tabs!.sendMessage).toHaveBeenCalledWith(42, { kind: 'position-request' });
  });
  it('returns null on a no-position reply, a rejected send, an undefined reply, or no tabs API', async () => {
    expect(await requestPosition(api({ tabs: { ...api().tabs!, sendMessage: async () => ({ kind: 'no-position', boardPresent: false }) } }), 5)).toBeNull();
    expect(await requestPosition(api({ tabs: { ...api().tabs!, sendMessage: async () => { throw new Error('Receiving end does not exist'); } } }), 5)).toBeNull();
    expect(await requestPosition(api({ tabs: { ...api().tabs!, sendMessage: async () => undefined } }), 5)).toBeNull();
    expect(await requestPosition(api({ tabs: { ...api().tabs!, query: async () => [] } }), 5)).toBeNull();
    expect(await requestPosition({}, 5)).toBeNull();
  });
  it('falls back to the current window when the window id is unknown', async () => {
    const query = vi.fn(async () => [{ id: 1 }]);
    await requestPosition(api({ tabs: { ...api().tabs!, query } }), null);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });
});

describe('isFromActiveTab', () => {
  it('accepts only the active tab of the panel window', () => {
    expect(isFromActiveTab({ tab: { active: true, windowId: 5 } }, 5)).toBe(true);
    expect(isFromActiveTab({ tab: { active: false, windowId: 5 } }, 5)).toBe(false);
    expect(isFromActiveTab({ tab: { active: true, windowId: 6 } }, 5)).toBe(false);
    expect(isFromActiveTab({}, 5)).toBe(false);          // an extension page, not a tab
  });
  it('accepts everything when affinity is unavailable (window id unknown)', () => {
    expect(isFromActiveTab(undefined, null)).toBe(true);
    expect(isFromActiveTab({ tab: { active: false, windowId: 9 } }, null)).toBe(true);
  });
});

describe('onActiveTabChanged', () => {
  it('fires for activations in the panel window and refocus of that window; unsubscribes both', () => {
    const a = api();
    const cb = vi.fn();
    const off = onActiveTabChanged(a, 5, cb);
    const onAct = (a.tabs!.onActivated!.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const onFocus = (a.windows!.onFocusChanged!.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    onAct({ tabId: 1, windowId: 6 }); expect(cb).not.toHaveBeenCalled();
    onAct({ tabId: 2, windowId: 5 }); expect(cb).toHaveBeenCalledTimes(1);
    onFocus(-1);                      expect(cb).toHaveBeenCalledTimes(1);   // WINDOW_ID_NONE
    onFocus(5);                       expect(cb).toHaveBeenCalledTimes(2);
    off();
    expect(a.tabs!.onActivated!.removeListener).toHaveBeenCalledWith(onAct);
    expect(a.windows!.onFocusChanged!.removeListener).toHaveBeenCalledWith(onFocus);
  });
  it('is a no-op without the events API', () => {
    expect(() => onActiveTabChanged({}, 5, () => {})()).not.toThrow();
  });
});
