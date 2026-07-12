import { describe, it, expect } from 'vitest';
import { squareCorner } from '../lib/squareCorner';

describe('squareCorner (white at bottom)', () => {
  it('a8 (top-left square) → top-right corner (12.5, 0)', () => {
    expect(squareCorner('a8', 'white')).toEqual({ leftPct: 12.5, topPct: 0 });
  });
  it('h1 (bottom-right square) → top-right corner (100, 87.5)', () => {
    expect(squareCorner('h1', 'white')).toEqual({ leftPct: 100, topPct: 87.5 });
  });
  it('e5 → (62.5, 37.5)', () => {
    expect(squareCorner('e5', 'white')).toEqual({ leftPct: 62.5, topPct: 37.5 });
  });
  it('h8 (top-right square) → top-right corner (100, 0)', () => {
    expect(squareCorner('h8', 'white')).toEqual({ leftPct: 100, topPct: 0 });
  });
});

describe('squareCorner (black at bottom)', () => {
  it('flips files and ranks: a8 → (100, 87.5)', () => {
    expect(squareCorner('a8', 'black')).toEqual({ leftPct: 100, topPct: 87.5 });
  });
  it('h1 → (12.5, 0)', () => {
    expect(squareCorner('h1', 'black')).toEqual({ leftPct: 12.5, topPct: 0 });
  });
  it('e5 → (50, 50)', () => {
    expect(squareCorner('e5', 'black')).toEqual({ leftPct: 50, topPct: 50 });
  });
});
