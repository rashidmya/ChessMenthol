import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MoveList from '../../entrypoints/sidepanel/MoveList.svelte';

const moves = [
  { ply: 1, san: 'e4', uci: 'e2e4', classification: { label: 'best', cpl: 0, isBest: true } },
  { ply: 2, san: 'e5', uci: 'e7e5', classification: null },
  { ply: 3, san: 'Nf3', uci: 'g1f3', classification: { label: 'blunder', cpl: 300, isBest: false } },
];

describe('MoveList', () => {
  it('renders numbered SAN with a badge for classified moves and marks the current ply', () => {
    const { getByTestId, container } = render(MoveList, { props: { moveList: moves, currentPly: 2, onNavigate: () => {} } });
    expect([...container.querySelectorAll('.num')].map((n) => n.textContent)).toEqual(['1.', '2.']);
    expect(getByTestId('move-1').textContent).toContain('e4');
    expect(getByTestId('move-1').querySelector('svg')).not.toBeNull();   // best badge
    expect(getByTestId('move-2').querySelector('svg')).toBeNull();       // unclassified
    expect(getByTestId('move-2').classList.contains('current')).toBe(true);
    expect(getByTestId('move-2').getAttribute('aria-current')).toBe('true');
    expect(getByTestId('move-3').classList.contains('current')).toBe(false);
    expect(getByTestId('move-3').getAttribute('aria-current')).toBeNull();
  });
  it('navigates to a clicked move', async () => {
    const onNavigate = vi.fn();
    const { getByTestId } = render(MoveList, { props: { moveList: moves, currentPly: 3, onNavigate } });
    await fireEvent.click(getByTestId('move-1'));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});
