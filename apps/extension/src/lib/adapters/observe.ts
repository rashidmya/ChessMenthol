/** Watch a board subtree; coalesce mutation bursts into one debounced onChange.
 *  Returns an unsubscribe that disconnects the observer and cancels pending fires. */
export function observeBoard(board: Element, onChange: () => void, debounceMs = 120): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const mo = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, debounceMs);
  });
  mo.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  return () => { if (timer) clearTimeout(timer); mo.disconnect(); };
}
