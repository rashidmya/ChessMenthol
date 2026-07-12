import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeBoard } from './observe';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('observeBoard', () => {
  it('debounces a burst of mutations into one onChange', async () => {
    const board = document.createElement('div');
    document.body.appendChild(board);
    const onChange = vi.fn();
    const stop = observeBoard(board, onChange, 50);

    for (let i = 0; i < 5; i++) board.appendChild(document.createElement('span'));
    await Promise.resolve();               // let MutationObserver flush its microtask
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops firing after unsubscribe', async () => {
    const board = document.createElement('div');
    const onChange = vi.fn();
    const stop = observeBoard(board, onChange, 50);
    stop();
    board.appendChild(document.createElement('span'));
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    expect(onChange).not.toHaveBeenCalled();
  });
});
