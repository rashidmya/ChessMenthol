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
  /** Fire `onChange` on each settled board mutation; returns an unsubscribe fn. */
  observe(onChange: () => void): () => void;
  /** Cheap check: is this site's board container in the DOM at all? Distinguishes
   *  "not a chess page" (false) from "board present but unreadable" (true + null read). */
  boardPresent(): boolean;
  /** Optional: true while the user is mid-interaction (a piece selected / being dragged,
   *  its move hints shown). The board position is unchanged during a selection, and on
   *  chess.com the selection highlight is DOM-identical to the last-move highlight — so
   *  the driver skips updates while this is true, keeping the last (correct) position and
   *  turn instead of mis-reading the turn from the polluted highlights. */
  interacting?(): boolean;
}
