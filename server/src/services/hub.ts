/**
 * Tiny bridge so REST handlers can push live updates (inventory, rewards, teleports)
 * to connected game clients without importing Socket.IO directly.
 */
type Sender = (userId: number, event: string, data: unknown) => void;
type ClassSender = (classId: number, event: string, data: unknown) => void;

let sendToUser: Sender = () => {};
let sendToClass: ClassSender = () => {};
let kickUser: (userId: number) => void = () => {};
let resetWorldFn: (worldId: number) => void = () => {};
let updateLookFn: (userId: number) => void = () => {};
let chatConfigFn: (classId: number) => void = () => {};

export const hub = {
  register(s: { toUser: Sender; toClass: ClassSender; kick: (userId: number) => void; resetWorld: (worldId: number) => void; updateLook: (userId: number) => void; chatConfig: (classId: number) => void }) {
    sendToUser = s.toUser; sendToClass = s.toClass; kickUser = s.kick; resetWorldFn = s.resetWorld; updateLookFn = s.updateLook; chatConfigFn = s.chatConfig;
  },
  /** Send every connected player in a world a fresh (per-viewer filtered) copy of all edits. */
  resetWorld(worldId: number) { resetWorldFn(worldId); },
  /** Re-broadcast a player's cosmetics / level to everyone who can see them. */
  updateLook(userId: number) { updateLookFn(userId); },
  chatConfig(classId: number) { chatConfigFn(classId); },
  toUser(userId: number, event: string, data: unknown) { sendToUser(userId, event, data); },
  toClass(classId: number, event: string, data: unknown) { sendToClass(classId, event, data); },
  kick(userId: number) { kickUser(userId); }
};
