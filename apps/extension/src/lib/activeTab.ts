import { isPositionMessage, type PositionMessage, type PositionRequest } from './messages';

/** The slice of the WebExtension API the panel needs for tab affinity. Every member is
 *  optional so the panel degrades to "no affinity" in a plain browser tab / jsdom. */
export interface TabsApi {
  windows?: {
    getCurrent(): Promise<{ id?: number }>;
    onFocusChanged?: Listenable<(windowId: number) => void>;
    WINDOW_ID_NONE?: number;
  };
  tabs?: {
    query(q: { active: true; windowId?: number; currentWindow?: boolean }): Promise<{ id?: number }[]>;
    sendMessage(tabId: number, msg: PositionRequest): Promise<unknown>;
    onActivated?: Listenable<(info: { tabId: number; windowId: number }) => void>;
  };
}
interface Listenable<F> { addListener(cb: F): void; removeListener(cb: F): void }

/** runtime.onMessage's sender, reduced to what affinity needs. */
export interface SenderLike { tab?: { active?: boolean; windowId?: number } }

/** The window this panel/sidebar belongs to, or null when unknowable. */
export async function getMyWindowId(api: TabsApi): Promise<number | null> {
  try { return (await api.windows?.getCurrent())?.id ?? null; } catch { return null; }
}

/** Ask the active tab (of `windowId`, else the current window) for its board position.
 *  null = no supported content script there, no board, or any failure. */
export async function requestPosition(api: TabsApi, windowId: number | null): Promise<PositionMessage | null> {
  if (!api.tabs) return null;
  try {
    const tabs = await api.tabs.query(windowId === null ? { active: true, currentWindow: true } : { active: true, windowId });
    const id = tabs[0]?.id;
    if (id === undefined) return null;
    const reply = await api.tabs.sendMessage(id, { kind: 'position-request' });
    return isPositionMessage(reply as PositionMessage) ? (reply as PositionMessage) : null;
  } catch { return null; }
}

/** Accept a pushed message only from the active tab of the panel's window. With no
 *  window id (affinity unavailable) accept everything rather than go deaf. */
export function isFromActiveTab(sender: SenderLike | undefined, windowId: number | null): boolean {
  if (windowId === null) return true;
  return !!sender?.tab?.active && sender.tab.windowId === windowId;
}

/** Call `cb` when the active tab of `windowId` changes or that window regains focus. */
export function onActiveTabChanged(api: TabsApi, windowId: number, cb: () => void): () => void {
  const onAct = (info: { tabId: number; windowId: number }) => { if (info.windowId === windowId) cb(); };
  const onFocus = (id: number) => { if (id === windowId) cb(); };
  api.tabs?.onActivated?.addListener(onAct);
  api.windows?.onFocusChanged?.addListener(onFocus);
  return () => {
    api.tabs?.onActivated?.removeListener(onAct);
    api.windows?.onFocusChanged?.removeListener(onFocus);
  };
}
