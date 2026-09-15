import type { SiteAdapter } from './adapters/types';
import type { PositionMessage, AdapterStatusMessage, NoPositionReply } from './messages';

type Out = PositionMessage | AdapterStatusMessage;

export interface ContentDriver {
  /** Tear down the board observer and the page-level watcher. */
  stop(): void;
  /** Synchronous answer to the panel's position-request: the position now on the
   *  board (or the last clean one while a piece is selected), else no-position. */
  readNow(): PositionMessage | NoPositionReply;
}

/**
 * Drive one site adapter for the lifetime of the page.
 *
 * chess.com / lichess are SPAs: the board renders after the content script runs and is
 * re-created per game, so the board element cannot be looked up once. A cheap
 * childList+subtree observer on `root` (document.body) re-runs `attach()` at most once
 * per `settleMs` while the DOM is mutating (a throttle, not a debounce — a busy page
 * can't starve it); `attach()` compares `adapter.boardElement()` by identity with the
 * board currently observed and, when it differs, moves the per-board observer over and
 * pushes that board's first read (the FEN dedupe is reset so a new game whose position
 * equals the old one still gets announced).
 *
 * Per-board behaviour is unchanged: read on every settled mutation, dedupe by FEN, skip
 * reads mid-interaction, announce adapter-status on unreadable<->readable transitions.
 */
export function runContentDriver(
  adapter: SiteAdapter,
  send: (m: Out) => void,
  root: Node = document.body,
  settleMs = 250,
): ContentDriver {
  let lastFen: string | null = null;
  let lastMsg: PositionMessage | null = null;
  let adapterOk = true; // start optimistic; only announce a *problem* or its recovery
  let observed: Element | null = null;
  let stopBoard: (() => void) | null = null;

  const read = (): PositionMessage | null => {
    const pos = adapter.readPosition();
    return pos ? { kind: 'position', site: adapter.site, ...pos } : null;
  };

  const emit = () => {
    // A piece being selected/dragged is a transient interaction, not a new position —
    // skip so a selection highlight (DOM-identical to the last move on chess.com) can't
    // pollute the read. When the interaction ends, the next mutation reads cleanly.
    if (adapter.interacting?.()) return;
    const msg = read();
    if (!msg) {
      if (observed && adapterOk) { adapterOk = false; send({ kind: 'adapter-status', site: adapter.site, ok: false }); }
      return;
    }
    if (!adapterOk) { adapterOk = true; send({ kind: 'adapter-status', site: adapter.site, ok: true }); }
    if (msg.fen === lastFen) return;
    lastFen = msg.fen; lastMsg = msg;
    send(msg);
  };

  const attach = () => {
    const el = adapter.boardElement();
    if (el === observed) return;
    stopBoard?.(); stopBoard = null;
    observed = el;
    lastFen = null; lastMsg = null; // a (re)appeared board's first read is always pushed; nothing from the old board is reusable
    if (el) { stopBoard = adapter.observe(el, emit); emit(); }
  };

  attach();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const rootMo = new MutationObserver(() => {
    if (timer) return; // at most one attach() per settleMs — a busy page can't starve it
    timer = setTimeout(() => { timer = null; attach(); }, settleMs);
  });
  rootMo.observe(root, { childList: true, subtree: true });

  return {
    stop() { if (timer) clearTimeout(timer); rootMo.disconnect(); stopBoard?.(); stopBoard = null; },
    readNow() {
      if (adapter.interacting?.() && lastMsg) return lastMsg;
      const msg = read();
      if (msg) { lastFen = msg.fen; lastMsg = msg; return msg; }
      return { kind: 'no-position', boardPresent: adapter.boardElement() !== null };
    },
  };
}
