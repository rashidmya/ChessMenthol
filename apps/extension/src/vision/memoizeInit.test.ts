import { describe, it, expect, vi } from 'vitest';
import { memoizeInit } from './memoizeInit';

describe('memoizeInit', () => {
  it('runs init once and shares the result', async () => {
    const init = vi.fn(async () => ({ n: 1 }));
    const get = memoizeInit(init);
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toBe(b);
    expect(init).toHaveBeenCalledTimes(1);
    expect(await get()).toBe(a);
  });
  it('forgets a failed init so the next call retries', async () => {
    let calls = 0;
    const get = memoizeInit(async () => { if (++calls === 1) throw new Error('first load failed'); return 'ok'; });
    await expect(get()).rejects.toThrow('first load failed');
    expect(await get()).toBe('ok');
    expect(calls).toBe(2);
  });
});
