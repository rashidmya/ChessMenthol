/**
 * vision/tracker.ts — single-frame pipeline (classifier-injected).
 *
 * Faithful TS port of the original Python chessmenthol/vision/tracker.py (removed in the Svelte+Tauri migration) MINUS the capturer.
 * Capture lives in `lib/capture.ts`; this module only receives an RgbaImage.
 *
 * Pipeline: detectPosition(image)
 *   detect(image)
 *   → cropSquares(image, location)
 *   → classifier.classify(crops)              [async — ONNX in prod]
 *   → bridge: recover the geometric grid with location.orientationHint
 *   → resolve orientation (override ?? hint ?? guess ?? 'white_bottom')
 *   → resolve side (_resolveSide: two-pass provisional assemble + guessSideToMove)
 *   → assemble(grid, { orientation, white: side, prevFen })
 *   → update prevFen when legal; return AssembledPosition.
 *
 * prevFen is a STRING (the assembled.fen from the previous legal frame).
 * Move inference happens inside assemble via inferMove — we just thread prevFen.
 */

import { detect, cropSquares } from './detect';
import { assemble, guessOrientation, guessSideToMove } from './position';
import type { AssembledPosition, SquareLabel } from './position';
import { squareName } from './types';
import type { Orientation, RgbaImage, SquareImage, BoardLocation } from './types';

// ─── ClassifierLike ──────────────────────────────────────────────────────────

/** Minimal interface for an async piece classifier. Satisfied by PieceClassifier
 *  (onnxruntime-backed) and the FakeClassifier used in tests. */
export interface ClassifierLike {
  classify(crops: SquareImage[]): Promise<SquareLabel[]>;
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

export class Tracker {
  /** FEN string of the previous legal frame, or null if no frame has been seen. */
  private prevFen: string | null = null;

  /** null = auto-detect; true = white; false = black. */
  private sideOverride: boolean | null = null;

  /** null = use hint / guess. */
  private orientationOverride: Orientation | null = null;

  constructor(private readonly classifier: ClassifierLike) {}

  setSideOverride(white: boolean | null): void {
    this.sideOverride = white;
  }

  setOrientationOverride(o: Orientation | null): void {
    this.orientationOverride = o;
  }

  /** Clear prevFen so the next frame cannot infer a move from this frame. */
  reset(): void {
    this.prevFen = null;
  }

  /**
   * Detect the board in `image` and return the assembled position, or null if
   * no board is found. Updates prevFen when the assembled position is legal.
   */
  async detectPosition(image: RgbaImage): Promise<AssembledPosition | null> {
    const location = detect(image);
    if (location === null) return null;

    const crops = cropSquares(image, location);
    const labels = await this.classifier.classify(crops);

    // Bridge: recover the geometric grid using the SAME orientation hint that
    // cropSquares used to name the crops. An override applied later flips the
    // chess mapping without re-cropping.
    const labelByName = new Map<string, SquareLabel>();
    for (let i = 0; i < crops.length; i++) {
      labelByName.set(crops[i].square, labels[i]);
    }

    const grid: SquareLabel[][] = [];
    for (let row = 0; row < 8; row++) {
      const gridRow: SquareLabel[] = [];
      for (let col = 0; col < 8; col++) {
        const name = squareName(col, row, location.orientationHint);
        // Fall back to empty+zero-confidence if a square is somehow missing.
        gridRow.push(labelByName.get(name) ?? { piece: null, confidence: 0 });
      }
      grid.push(gridRow);
    }

    const orientation: Orientation =
      this.orientationOverride ??
      location.orientationHint ??
      guessOrientation(grid) ??
      'white_bottom';

    const white = this._resolveSide(grid, orientation, location);
    const assembled = assemble(grid, { orientation, white, prevFen: this.prevFen });

    // Advance prevFen only on legal frames: an illegal detection (noise /
    // misclassification) must not corrupt the cross-frame move-inference baseline.
    if (assembled.isLegal) {
      this.prevFen = assembled.fen;
    }

    return assembled;
  }

  // ─── _resolveSide ──────────────────────────────────────────────────────────

  /**
   * Mirror of Python's _resolve_side.
   *
   * If there is a user override, use it directly.
   * Otherwise do a two-pass provisional assemble (white-to-move) to get a
   * legal board, then ask guessSideToMove. Falls back to white when the
   * provisional board is illegal (no board).
   *
   * Two passes are needed because `assemble` requires a `white` side-to-move
   * argument to build a legal board, but the side cannot be known without a
   * legal board first; the provisional pass assumes white to obtain one, then
   * guessSideToMove corrects it.
   *
   * Returns true = white, false = black.
   */
  private _resolveSide(
    grid: SquareLabel[][],
    orientation: Orientation,
    location: BoardLocation,
  ): boolean {
    if (this.sideOverride !== null) {
      return this.sideOverride;
    }

    const provisional = assemble(grid, {
      orientation,
      white: true,
      prevFen: this.prevFen,
    });

    if (!provisional.isLegal) {
      return true; // default: white
    }

    const side = guessSideToMove(provisional.fen, {
      prevFen: this.prevFen,
      move: provisional.move,
      highlightSquares: location.highlightSquares,
    });

    return side === 'white';
  }
}
