// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import {
  CLASSES,
  INPUT_SIZE,
  classToPiece,
  pieceToClass,
  preprocess,
  postprocess,
  resizeBilinear,
  PieceClassifier,
  ortRunner,
  type InferenceLike,
} from '../vision/pieces';
import { loadFixturePng } from './visionFixtures';

describe('pieces — pure', () => {
  it('class order + INPUT_SIZE', () => {
    expect([...CLASSES]).toEqual(['bB', 'bK', 'bN', 'bP', 'bQ', 'bR', 'wB', 'wK', 'wN', 'wP', 'wQ', 'wR', 'xx']);
    expect(INPUT_SIZE).toBe(32);
  });
  it('class<->piece bijection', () => {
    expect(classToPiece(CLASSES.indexOf('xx'))).toBeNull();
    expect(classToPiece(CLASSES.indexOf('wP'))).toBe('wP');
    for (let i = 0; i < CLASSES.length; i++) expect(pieceToClass(classToPiece(i))).toBe(i);
  });
  it('preprocess: NCHW shape, /255 normalization', () => {
    const black = Array.from({ length: 5 }, () => ({ data: new Uint8ClampedArray(40 * 40 * 4), width: 40, height: 40 }));
    expect(preprocess(black).length).toBe(5 * 3 * INPUT_SIZE * INPUT_SIZE);
    const whitePx = new Uint8ClampedArray(32 * 32 * 4).fill(255);
    expect(Math.abs(Math.max(...preprocess([{ data: whitePx, width: 32, height: 32 }])) - 1.0)).toBeLessThan(1e-3);
  });
  it('postprocess: argmax + softmax confidence', () => {
    const logits = new Float32Array(2 * 13).fill(-10);
    logits[CLASSES.indexOf('wP')] = 10;
    logits[13 + CLASSES.indexOf('xx')] = 10;
    const labels = postprocess(logits, 2);
    expect(labels[0].piece).toBe('wP');
    expect(labels[1].piece).toBeNull();
    expect(labels[0].confidence).toBeGreaterThan(0.99);
  });
  it('resizeBilinear keeps a flat colour flat', () => {
    const src = { data: new Uint8ClampedArray(40 * 40 * 4).fill(123), width: 40, height: 40 };
    const out = resizeBilinear(src, 32);
    expect(out.width).toBe(32);
    expect(out.data[0]).toBe(123);
  });
});

const MODEL = fileURLToPath(new URL('../../models/pieces.onnx', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/vision/pieces', import.meta.url));
const maybe = existsSync(MODEL) ? describe : describe.skip;

maybe('pieces — committed model classifies real crops (>=95%)', () => {
  it('classifies the committed piece fixtures', async () => {
    const session = await ort.InferenceSession.create(MODEL);
    // ort's InferenceSession.run returns a wider union than InferenceLike's
    // narrowed { data: Float32Array }; cast across the runtime boundary.
    const clf = new PieceClassifier(ortRunner(session as unknown as InferenceLike, ort.Tensor));
    const types = readdirSync(FIX);
    const crops = [], expected: string[] = [];
    for (const t of types) for (const f of readdirSync(`${FIX}/${t}`)) {
      crops.push({ square: 'a1', image: loadFixturePng(`pieces/${t}/${f}`) });
      expected.push(t);
    }
    const labels = await clf.classify(crops);
    const correct = labels.filter((l, i) => CLASSES[pieceToClass(l.piece)] === expected[i]).length;
    expect(correct / crops.length).toBeGreaterThanOrEqual(0.95);
  }, 30_000);
});
