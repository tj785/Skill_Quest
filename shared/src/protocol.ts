/** Real-time (Socket.IO) message shapes between the game client and server. */
import type { Look } from './extras.js';

export interface PlayerState {
  id: number; // user id
  name: string;
  x: number; y: number; z: number;
  yaw: number;
  color: string;
  role: 'student' | 'teacher' | 'admin';
  level: number;
  look?: Look;
}

export interface BlockEdit { x: number; y: number; z: number; b: number; /** false = waiting for teacher approval (only the builder and teachers see it) */ pending?: boolean; }
export interface ChatMessage { id: number; userId: number; name: string; role: string; text: string; at: string; }

export interface ServerToClient {
  welcome: (d: { you: PlayerState; players: PlayerState[]; seed: number; edits: BlockEdit[]; worldId: number }) => void;
  playerJoined: (p: PlayerState) => void;
  playerLeft: (d: { id: number }) => void;
  playerMoved: (d: { id: number; x: number; y: number; z: number; yaw: number }) => void;
  blockChanged: (e: BlockEdit & { by: number }) => void;
  blocksReset: (d: { edits: BlockEdit[] }) => void;
  blockBatch: (d: { edits: BlockEdit[] }) => void;
  playerUpdated: (p: { id: number; look: Look; level: number }) => void;
  chat: (m: ChatMessage) => void;
  chatHidden: (d: { id: number }) => void;
  chatConfig: (d: { mode: string; muted: boolean }) => void;
  questUpdate: () => void;
  inventory: (d: { items: Record<number, number> }) => void;
  toast: (d: { kind: 'info' | 'error' | 'reward'; text: string }) => void;
  teleport: (d: { x: number; y: number; z: number }) => void;
  frozen: (d: { frozen: boolean }) => void;
  progress: (d: { xp: number; level: number; coins: number }) => void;
}

export interface ClientToServer {
  move: (d: { x: number; y: number; z: number; yaw: number }) => void;
  place: (d: { x: number; y: number; z: number; b: number }, ack: (r: { ok: boolean; error?: string }) => void) => void;
  remove: (d: { x: number; y: number; z: number }, ack: (r: { ok: boolean; error?: string }) => void) => void;
  chat: (d: { text: string }, ack: (r: { ok: boolean; error?: string }) => void) => void;
}
