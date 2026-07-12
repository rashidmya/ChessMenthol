import { describe, it, expect } from 'vitest';
// A *value* import (not `import type`): esbuild elides unused type-only imports,
// so a type import would pass even with NO vitest config — vacuous. A real value
// import forces vitest to actually resolve `@core` at runtime.
import { moveToUci } from '@chessmenthol/core/lib/board';

describe('harness', () => {
  it('resolves the @core alias to reused runtime code', () => {
    expect(moveToUci('e2', 'e4')).toBe('e2e4');
    expect(moveToUci('e7', 'e8', 'q')).toBe('e7e8q');
  });
});
