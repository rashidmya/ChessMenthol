/**
 * src/tests/tracker.test.ts
 *
 * Vitest port of tests/vision/test_tracker.py (the parity spec).
 * Omits test_tracker_grab_full_desktop_and_set_region_delegate — that is
 * lib/capture.ts's concern; the Tracker no longer owns the capturer.
 *
 * Mapping from Python → TS shapes:
 *   - FakeClassifier takes a FEN string; uses pieceCodeAt(posFromFen(fen), sq)
 *   - chess.WHITE/BLACK → true/false (setSideOverride parameter)
 *   - ap.side_to_move == chess.BLACK → ap.sideToMove === 'black'
 *   - ap.board.board_fen() == board.board_fen() → ap.fen.split(' ')[0] === placement
 *   - ap.move == chess.Move.from_uci('e2e4') → ap.move === 'e2e4'
 *   - ap.low_confidence → ap.lowConfidence
 */

import { describe, it, expect } from 'vitest';
import { Tracker } from '../vision/tracker';
import type { ClassifierLike } from '../vision/tracker';
import type { SquareLabel } from '../vision/position';
import type { SquareImage } from '../vision/types';
import type { RgbaImage } from '../lib/capture';
import { posFromFen, pieceCodeAt, fenOf, playUci } from '../core/chess';
import type { SquareName } from '../core/chess';
import { squareName } from '../vision/types';
import type { Orientation } from '../vision/types';
import { renderBoard } from './visionFixtures';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ─── FakeClassifier ──────────────────────────────────────────────────────────

/**
 * Returns the TRUE label for each crop based on its .square name and a known FEN.
 * Mirrors Python's FakeClassifier: SquareLabel(board.piece_at(parse_square(c.square)), 1.0).
 */
class FakeClassifier implements ClassifierLike {
  constructor(private fen: string) {}

  async classify(crops: SquareImage[]): Promise<SquareLabel[]> {
    const pos = posFromFen(this.fen);
    return crops.map((c) => ({
      piece: pieceCodeAt(pos, c.square as SquareName),
      confidence: 1.0,
    }));
  }
}

/**
 * Returns true labels from a SEQUENCE of FENs — each classify() call advances
 * to the next FEN. Mirrors Python's SeqClassifier; used by the move-inference
 * and reset() tests.
 */
class SeqClassifier implements ClassifierLike {
  private i = 0;
  constructor(private fens: string[]) {}
  async classify(crops: SquareImage[]): Promise<SquareLabel[]> {
    const fen = this.fens[Math.min(this.i, this.fens.length - 1)];
    this.i++;
    const pos = posFromFen(fen);
    return crops.map((c) => ({
      piece: pieceCodeAt(pos, c.square as SquareName),
      confidence: 1.0,
    }));
  }
}

/**
 * Simulates a board physically rendered in `orientation` — the piece shown at a
 * given geometric cell is the true piece of that cell under `orientation`. The
 * crops handed to classify() are named in white_bottom (the geometric naming
 * convention cropSquares uses), so we invert that name back to (col,row) and
 * look up the true square under the physical orientation. Used to exercise
 * auto-orientation without a user override.
 */
class OrientedFakeClassifier implements ClassifierLike {
  constructor(private fen: string, private orientation: Orientation) {}
  async classify(crops: SquareImage[]): Promise<SquareLabel[]> {
    const pos = posFromFen(this.fen);
    return crops.map((c) => {
      const col = c.square.charCodeAt(0) - 'a'.charCodeAt(0);
      const row = 8 - Number(c.square[1]);
      const trueName = squareName(col, row, this.orientation);
      return { piece: pieceCodeAt(pos, trueName as SquareName), confidence: 1.0 };
    });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Collect all occupied square names from a FEN. */
function occupiedSquares(fen: string): string[] {
  const pos = posFromFen(fen);
  const out: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const name = squareName(col, row, 'white_bottom');
      if (pieceCodeAt(pos, name as SquareName) !== null) out.push(name);
    }
  }
  return out;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Tracker', () => {
  it('reproduces a known mid-game position', async () => {
    // r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
    // square=32 (not 48): a 32-piece mid-game board at sq=48 drops detect
    // confidence to ~0.29, just below the 0.3 gate; sq=32 gives ~0.34.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const occupied = occupiedSquares(fen);
    const { image } = renderBoard({ square: 32, margin: 24, pieces: occupied });
    const tracker = new Tracker(new FakeClassifier(fen));
    const ap = await tracker.detectPosition(image);
    expect(ap).not.toBeNull();
    expect(ap!.isLegal).toBe(true);
    // placement FEN must match the source board
    expect(ap!.fen.split(' ')[0]).toBe(fen.split(' ')[0]);
  });

  it('returns null when no board is detected (noise image)', async () => {
    // LCG noise — deterministic, no Math.random; mirrors detect.test.ts noise case
    let s = 1;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const n = 300;
    const data = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : Math.floor(rnd() * 256);
    const image: RgbaImage = { data, width: n, height: n };
    const tracker = new Tracker(new FakeClassifier(START_FEN));
    expect(await tracker.detectPosition(image)).toBeNull();
  });

  it('honours a side override (black)', async () => {
    // Python: tracker.set_side_override(chess.BLACK) → ap.side_to_move == chess.BLACK
    // TS:     tracker.setSideOverride(false)         → ap.sideToMove === 'black'
    const occupied = occupiedSquares(START_FEN);
    // start position at square=48 is fine for confidence (pieces only on ranks 1-2 / 7-8)
    const { image } = renderBoard({ square: 48, margin: 24, pieces: occupied });
    const tracker = new Tracker(new FakeClassifier(START_FEN));
    tracker.setSideOverride(false); // false = black
    const ap = await tracker.detectPosition(image);
    expect(ap).not.toBeNull();
    expect(ap!.sideToMove).toBe('black');
  });

  it('honours an orientation override (black_bottom)', async () => {
    const occupied = occupiedSquares(START_FEN);
    const { image } = renderBoard({ square: 32, margin: 24, pieces: occupied });
    const tracker = new Tracker(new FakeClassifier(START_FEN));
    tracker.setOrientationOverride('black_bottom');
    const ap = await tracker.detectPosition(image);
    expect(ap).not.toBeNull();
    expect(ap!.orientation).toBe('black_bottom');
  });

  it('auto-detects black_bottom orientation from the piece layout (no override)', async () => {
    // A board captured from Black's perspective (black pieces at the bottom).
    // Without a user override the tracker must recover orientation from the
    // pieces; a mis-detection assembles a 180°-rotated FEN → "plays backwards".
    const occupied = occupiedSquares(START_FEN);
    const { image } = renderBoard({ square: 48, margin: 24, pieces: occupied });
    const tracker = new Tracker(new OrientedFakeClassifier(START_FEN, 'black_bottom'));
    const ap = await tracker.detectPosition(image);
    expect(ap).not.toBeNull();
    expect(ap!.orientation).toBe('black_bottom');
    // Placement must be the true start position, not its 180° rotation.
    expect(ap!.fen.split(' ')[0]).toBe(START_FEN.split(' ')[0]);
  });

  it('infers e2e4 across two frames (SeqClassifier)', async () => {
    const startPos = posFromFen(START_FEN);
    const afterPos = playUci(startPos, 'e2e4');
    const afterFen = fenOf(afterPos);

    const occStart = occupiedSquares(START_FEN);
    const occAfter = occupiedSquares(afterFen);

    const { image: imgStart } = renderBoard({ square: 32, margin: 24, pieces: occStart });
    const { image: imgAfter } = renderBoard({ square: 32, margin: 24, pieces: occAfter });

    const tracker = new Tracker(new SeqClassifier([START_FEN, afterFen]));
    await tracker.detectPosition(imgStart);            // sets prevFen
    const ap = await tracker.detectPosition(imgAfter); // infers e2e4
    expect(ap).not.toBeNull();
    expect(ap!.move).toBe('e2e4');
  });

  it('propagates a low-confidence square (e2)', async () => {
    /**
     * LowConfClassifier mirrors Python's LowConfClassifier: sq 'e2' gets
     * confidence 0.2 (below the 0.5 threshold), all others get 1.0.
     */
    class LowConfClassifier implements ClassifierLike {
      constructor(private fen: string) {}
      async classify(crops: SquareImage[]): Promise<SquareLabel[]> {
        const pos = posFromFen(this.fen);
        return crops.map((c) => ({
          piece: pieceCodeAt(pos, c.square as SquareName),
          confidence: c.square === 'e2' ? 0.2 : 1.0,
        }));
      }
    }

    const occupied = occupiedSquares(START_FEN);
    const { image } = renderBoard({ square: 32, margin: 24, pieces: occupied });
    const tracker = new Tracker(new LowConfClassifier(START_FEN));
    const ap = await tracker.detectPosition(image);
    expect(ap).not.toBeNull();
    expect(ap!.lowConfidence).toContain('e2');
  });

  it('resolves orientation from coordinate labels when the layout is too sparse to guess', async () => {
    // Two kings only -> guessOrientation returns null; the black_bottom coord labels
    // must decide it via OCR.
    const fen = '8/8/8/8/4k3/8/8/4K3 w - - 0 1';
    const occupied = occupiedSquares(fen);
    const { image } = renderBoard({ square: 48, margin: 24, pieces: occupied, coords: 'black_bottom' });
    const tracker = new Tracker(new FakeClassifier(fen));
    const ap = await tracker.detectPosition(image);
    expect(ap).not.toBeNull();
    expect(ap!.orientation).toBe('black_bottom');
  });

  it('a manual override beats coordinate-label OCR', async () => {
    const occupied = occupiedSquares(START_FEN);
    const { image } = renderBoard({ square: 48, margin: 24, pieces: occupied, coords: 'black_bottom' });
    const tracker = new Tracker(new FakeClassifier(START_FEN));
    tracker.setOrientationOverride('white_bottom'); // user forces White
    const ap = await tracker.detectPosition(image);
    expect(ap!.orientation).toBe('white_bottom'); // override wins over OCR's black_bottom
  });

  it('reset() clears prevFen (no move inferred after reset)', async () => {
    // Not in test_tracker.py but guards the reset() contract.
    const occupied = occupiedSquares(START_FEN);
    const { image: imgStart } = renderBoard({ square: 32, margin: 24, pieces: occupied });
    const afterPos = playUci(posFromFen(START_FEN), 'e2e4');
    const afterFen = fenOf(afterPos);
    const occAfter = occupiedSquares(afterFen);
    const { image: imgAfter } = renderBoard({ square: 32, margin: 24, pieces: occAfter });

    // seq: call 1 → start, call 2 → after, call 3 → after (for the post-reset attempt)
    const tracker = new Tracker(new SeqClassifier([START_FEN, afterFen, afterFen]));
    await tracker.detectPosition(imgStart);            // sets prevFen = startFen
    tracker.reset();                                   // clears prevFen
    const ap = await tracker.detectPosition(imgAfter); // no prevFen → move = null
    expect(ap).not.toBeNull();
    expect(ap!.move).toBeNull();
  });
});
