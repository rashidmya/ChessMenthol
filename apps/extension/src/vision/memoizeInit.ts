/** Memoize an async initializer, but FORGET a failed attempt so the next call retries.
 *  Caching the rejection would turn a one-off load failure (e.g. a transient model
 *  fetch) into "every capture fails until the panel is reopened". */
export function memoizeInit<T>(init: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = init().catch((err) => { cached = null; throw err; });
    }
    return cached;
  };
}
