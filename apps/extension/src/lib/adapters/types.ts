/** A position read straight from a host page's DOM. FEN is fully assembled
 *  (side-to-move baked into the 2nd field), ready for the Orchestrator's set_fen. */
export interface AdapterPosition {
  fen: string;
  /** Which side is shown at the bottom of the host board — a display hint for the panel. */
  orientation: 'white' | 'black';
  /** Side to move; already reflected inside `fen`. */
  turn: 'w' | 'b';
}

/** One implementation per known site. The only site-specific code in the extension. */
export interface SiteAdapter {
  readonly site: 'chesscom' | 'lichess';
  /** True when this adapter can read `url`'s page. */
  matches(url: string): boolean;
  /** Parse the current DOM into a position, or null if no readable board / illegal parse. */
  readPosition(): AdapterPosition | null;
  /** The board container to read/observe, or null when this page has none (yet). The
   *  driver compares identities across DOM churn to notice a late render / a new game. */
  boardElement(): Element | null;
  /** Fire `onChange` on each settled mutation of `board`; returns an unsubscribe fn. */
  observe(board: Element, onChange: () => void): () => void;
  /** Optional: true while the user is mid-interaction (a piece selected / being dragged,
   *  its move hints shown). The board position is unchanged during a selection, and on
   *  chess.com the selection highlight is DOM-identical to the last-move highlight — so
   *  the driver skips updates while this is true, keeping the last (correct) position and
   *  turn instead of mis-reading the turn from the polluted highlights. */
  interacting?(): boolean;
}
