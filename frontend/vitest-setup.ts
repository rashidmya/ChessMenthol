import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver; Svelte's bind:clientWidth uses it internally.
// Stub it as a no-op so tests that don't care about measured widths (width stays 0) still pass.
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
