declare module 'stockfish' {
  function initEngine(variant?: string): Promise<any>;
  export default initEngine;
}
