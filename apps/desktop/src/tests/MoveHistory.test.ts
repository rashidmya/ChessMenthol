import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MoveHistory from '../components/MoveHistory.svelte';

const ml = [
  { ply: 1, san: 'd4', uci: 'd2d4', classification: null },
  { ply: 2, san: 'Nf6', uci: 'g8f6', classification: null },
  { ply: 3, san: 'c4', uci: 'c2c4', classification: { label: 'mistake', cpl: 0, isBest: false } },
];

describe('MoveHistory', () => {
  it('renders columns, figurines, highlights current, navigates on click', async () => {
    const onNavigate = vi.fn();
    const { getByText, getAllByTestId } = render(MoveHistory, { props: { moveList: ml, currentPly: 3, onNavigate } });
    expect(getByText('Nf6')).toBeTruthy();              // raw SAN (figurine glyph drawn by the CSS font)
    const cur = getAllByTestId('mh-mv').find((b) => b.classList.contains('current'))!;
    expect(cur.textContent).toContain('c4');
    await fireEvent.click(getByText('d4'));
    expect(onNavigate).toHaveBeenCalledWith(1);          // ply 1
  });
  it('shows an empty placeholder for a dangling white move', () => {
    const { getByText } = render(MoveHistory, { props: { moveList: [ml[0]], currentPly: 1, onNavigate: vi.fn() } });
    expect(getByText('…')).toBeTruthy();                 // black cell placeholder (U+2026)
  });
  it('colors notable moves but leaves best/ordinary moves neutral', () => {
    const list = [
      { ply: 1, san: 'e4', uci: 'e2e4', classification: { label: 'best', cpl: 0, isBest: true } },
      { ply: 2, san: 'Nf6', uci: 'g8f6', classification: { label: 'mistake', cpl: 0, isBest: false } },
      { ply: 3, san: 'Bc4', uci: 'f1c4', classification: { label: 'brilliant', cpl: 0, isBest: false } },
    ];
    const { getByText } = render(MoveHistory, { props: { moveList: list, currentPly: 0, onNavigate: vi.fn() } });
    expect((getByText('e4') as HTMLElement).style.color).toBe('');      // best -> neutral, no green
    expect((getByText('Nf6') as HTMLElement).style.color).not.toBe(''); // mistake -> colored
    expect((getByText('Bc4') as HTMLElement).style.color).not.toBe(''); // brilliant -> colored
  });

  // MoveBadge renders as <svg class="move-badge" role="img">, so a classified move
  // gets exactly one .move-badge when showBadges is on, and none when it's off (default).
  const classified = [{ ply: 1, san: 'e4', uci: 'e2e4', classification: { label: 'blunder', cpl: 300, isBest: false } }];

  it('renders a quality badge before a classified move when showBadges is on', () => {
    const { container } = render(MoveHistory, { props: { moveList: classified, currentPly: 0, onNavigate: vi.fn(), showBadges: true } });
    expect(container.querySelectorAll('.move-badge').length).toBe(1);
  });

  it('renders no badge when showBadges is off (default)', () => {
    const { container } = render(MoveHistory, { props: { moveList: classified, currentPly: 0, onNavigate: vi.fn() } });
    expect(container.querySelectorAll('.move-badge').length).toBe(0);
  });
});
