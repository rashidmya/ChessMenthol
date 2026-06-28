import type { Chess } from './chess';

/** Looks up whether a move is a known opening-book move. */
export interface BookLookup {
  containsMove(pos: Chess, uci: string): boolean;
}

/** Null book: nothing is ever a book move (the parity default). */
export class NoBook implements BookLookup {
  containsMove(_pos: Chess, _uci: string): boolean {
    return false;
  }
}

// PolyglotBook (reading a .bin Polyglot opening book) is deferred — not on the
// Phase 1b parity path, which uses NoBook (empty book) as in the Python default.
