import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import SourceBadge from '../../entrypoints/sidepanel/SourceBadge.svelte';

describe('SourceBadge', () => {
  it('shows the source label and side to move', () => {
    const { getByTestId } = render(SourceBadge, { source: 'vision', sideToMove: 'black' });
    const el = getByTestId('source');
    expect(el.textContent).toContain('vision');
    expect(el.textContent?.toLowerCase()).toContain('black');
  });

  it('labels the four sources', () => {
    for (const src of ['manual', 'vision', 'chesscom', 'lichess'] as const) {
      const { getByTestId } = render(SourceBadge, { source: src, sideToMove: 'white' });
      expect(getByTestId('source').textContent).toContain(src === 'chesscom' ? 'chess.com' : src);
      cleanup();
    }
  });
});
