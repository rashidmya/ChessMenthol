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
    expect(getByText('♞f6')).toBeTruthy();              // toFigurine('Nf6')
    const cur = getAllByTestId('mh-mv').find((b) => b.classList.contains('current'))!;
    expect(cur.textContent).toContain('c4');
    await fireEvent.click(getByText('d4'));
    expect(onNavigate).toHaveBeenCalledWith(1);          // ply 1
  });
  it('shows an empty placeholder for a dangling white move', () => {
    const { getByText } = render(MoveHistory, { props: { moveList: [ml[0]], currentPly: 1, onNavigate: vi.fn() } });
    expect(getByText('…')).toBeTruthy();                 // black cell placeholder (U+2026)
  });
  it('applies the classification class to a move', () => {
    const { getByText } = render(MoveHistory, { props: { moveList: ml, currentPly: 0, onNavigate: vi.fn() } });
    expect(getByText('c4').className).toContain('mist'); // mistake -> mist
  });
});
