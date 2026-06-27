import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from '../App.svelte';

// jsdom WebSocket may throw on an invalid URL (about:blank → "ws:///ws").
// Stub it as a silent no-op so onMount's connect() doesn't throw.
beforeAll(() => {
  vi.stubGlobal('WebSocket', class {
    constructor(_url: string) {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
    readyState = 0;
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
  });
});

describe('App shell', () => {
  it('mounts without throwing and renders the board', () => {
    render(App);
    expect(screen.getByTestId('board')).toBeTruthy();
  });

  it('renders the analysis card with EngineHeader', () => {
    render(App);
    // EngineHeader renders <span class="txt">Analysis</span> unconditionally
    expect(screen.getByText('Analysis')).toBeTruthy();
  });

  it('renders the ChessMenthol brand from Header', () => {
    render(App);
    // Header renders <h1>Chess<i>Menthol</i></h1>; h1 textContent is "ChessMenthol"
    expect(screen.getByRole('heading', { name: /chessMenthol/i })).toBeTruthy();
  });
});

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
