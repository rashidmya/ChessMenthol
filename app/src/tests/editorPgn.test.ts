import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EditPanel from '../components/EditPanel.svelte';
import { makePositionPgn } from '../core/pgn';

describe('EditPanel PGN box', () => {
  it('shows the SetUp/FEN PGN for the given position', () => {
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    const { getByTestId } = render(EditPanel, { props: { fen, pgn: makePositionPgn(fen) } });
    const box = getByTestId('edit-pgn') as HTMLTextAreaElement;
    expect(box.value).toContain('[SetUp "1"]');
    expect(box.value).toContain(`[FEN "${fen}"]`);
  });
});
