import { writable } from 'svelte/store';
import type { Command, ServerFrame, StateFrame, RegionShotFrame } from './types';

export const state = writable<StateFrame | null>(null);
export const lastError = writable<string | null>(null);
export const connected = writable(false);
export const errorSeq = writable(0);
export const regionShot = writable<RegionShotFrame | null>(null);

let socket: WebSocket | null = null;
let queue: Command[] = [];

export function applyFrame(frame: ServerFrame): void {
  if (frame.type === 'state') state.set(frame);
  else if (frame.type === 'region_shot') regionShot.set(frame);
  else if (frame.type === 'error') {
    lastError.set(frame.message);
    errorSeq.update((n) => n + 1);
  }
}

function defaultUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect(url: string = defaultUrl()): WebSocket {
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    connected.set(true);
    for (const cmd of queue) socket!.send(JSON.stringify(cmd));
    queue = [];
  });
  socket.addEventListener('close', () => connected.set(false));
  socket.addEventListener('message', (ev) => applyFrame(JSON.parse(ev.data)));
  return socket;
}

export function send(cmd: Command): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
  else queue.push(cmd);
}
